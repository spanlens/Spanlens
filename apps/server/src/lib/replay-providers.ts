/**
 * Provider routing for the request-replay endpoints in `api/requests.ts`:
 *
 *   POST /api/v1/requests/:id/replay      — builds a curl-ready proxy path
 *   POST /api/v1/requests/:id/replay/run  — calls the provider API directly
 *
 * The server proxies 10 providers (see `proxy/`). Seven of them speak the
 * OpenAI chat-completions dialect end to end (request body, response body,
 * `usage` object): openai itself plus mistral, openrouter, groq, deepseek,
 * xai, and cohere (via its `/compatibility` layer — that is the surface our
 * proxy logs, so stored request bodies are already OpenAI-shaped). Those all
 * reuse the OpenAI replay path with their own upstream base URL.
 *
 * anthropic and gemini have their own request/usage shapes and are handled
 * explicitly. azure is the one provider replay-run does NOT support: its
 * upstream base URL is per-key (`provider_keys.provider_metadata.resource_url`)
 * and uses `api-key` auth — callers get a clear error naming the supported
 * providers instead of a generic validation failure.
 *
 * Upstream bases mirror the env overrides honoured by the proxy modules
 * (`MISTRAL_API_BASE`, ...) so a self-hosted deployment that points its proxy
 * at a mirror replays against the same host. Resolved at call time (not
 * module load) so tests and runtime env changes behave predictably.
 */

/** Providers whose chat-completions surface is OpenAI-compatible. */
const OPENAI_COMPAT_UPSTREAMS: Record<string, { envVar: string; defaultBase: string }> = {
  openai: { envVar: 'OPENAI_API_BASE', defaultBase: 'https://api.openai.com' },
  mistral: { envVar: 'MISTRAL_API_BASE', defaultBase: 'https://api.mistral.ai' },
  openrouter: { envVar: 'OPENROUTER_API_BASE', defaultBase: 'https://openrouter.ai/api' },
  groq: { envVar: 'GROQ_API_BASE', defaultBase: 'https://api.groq.com/openai' },
  deepseek: { envVar: 'DEEPSEEK_API_BASE', defaultBase: 'https://api.deepseek.com' },
  xai: { envVar: 'XAI_API_BASE', defaultBase: 'https://api.x.ai' },
  cohere: { envVar: 'COHERE_API_BASE', defaultBase: 'https://api.cohere.ai/compatibility' },
} as const

export const REPLAY_RUN_SUPPORTED_PROVIDERS = [
  'openai',
  'anthropic',
  'gemini',
  'mistral',
  'openrouter',
  'groq',
  'deepseek',
  'xai',
  'cohere',
] as const

export function isOpenAiCompatReplayProvider(provider: string): boolean {
  return provider in OPENAI_COMPAT_UPSTREAMS
}

function resolveCompatBase(provider: string): string {
  const entry = OPENAI_COMPAT_UPSTREAMS[provider]
  if (!entry) throw new Error(`Not an OpenAI-compatible replay provider: ${provider}`)
  // Same trailing-/v1 strip as the proxy modules — guards against an operator
  // setting FOO_API_BASE with a redundant /v1.
  return (process.env[entry.envVar] ?? entry.defaultBase).replace(/\/v1\/?$/, '')
}

function geminiModelPath(model: string): string {
  return model.startsWith('models/') ? model : `models/${model}`
}

/**
 * Spanlens proxy path for the curl snippet returned by POST /:id/replay.
 * Per-provider base paths match the public docs (`apps/web/app/docs/proxy/page.tsx`):
 * OpenAI-compatible providers mount at `/proxy/<p>/v1`, azure mounts at
 * `/proxy/azure` (the OpenAI SDK appends `/chat/completions` itself), gemini
 * encodes the model in the URL. Unknown providers fall back to the bare
 * proxy mount so the snippet at least points at the right router.
 */
export function buildReplayProxyPath(provider: string, model: string): string {
  if (provider === 'anthropic') return '/proxy/anthropic/v1/messages'
  if (provider === 'gemini') return `/proxy/gemini/v1beta/${geminiModelPath(model)}:generateContent`
  if (provider === 'azure') return '/proxy/azure/chat/completions'
  if (isOpenAiCompatReplayProvider(provider)) return `/proxy/${provider}/v1/chat/completions`
  return `/proxy/${provider}`
}

export interface ReplayUpstream {
  url: string
  headers: Record<string, string>
}

/**
 * Upstream endpoint + auth headers for POST /:id/replay/run.
 * Returns null for providers replay-run cannot support (azure — per-key
 * resource URL — and anything unknown); the caller surfaces a clear error
 * listing REPLAY_RUN_SUPPORTED_PROVIDERS.
 *
 * SECURITY: the plaintext provider key goes straight into the returned
 * headers (or the gemini query param, which is how Google authenticates) and
 * must never be logged.
 */
export function buildReplayUpstream(
  provider: string,
  model: string,
  providerKeyPlaintext: string,
): ReplayUpstream | null {
  if (provider === 'anthropic') {
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'x-api-key': providerKeyPlaintext,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
    }
  }
  if (provider === 'gemini') {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/${geminiModelPath(model)}:generateContent?key=${providerKeyPlaintext}`,
      headers: { 'Content-Type': 'application/json' },
    }
  }
  if (isOpenAiCompatReplayProvider(provider)) {
    return {
      url: `${resolveCompatBase(provider)}/v1/chat/completions`,
      headers: {
        Authorization: `Bearer ${providerKeyPlaintext}`,
        'Content-Type': 'application/json',
      },
    }
  }
  return null
}

export interface ReplayUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/**
 * Extract token usage from a non-streaming replay response.
 * OpenAI-compatible providers all report the OpenAI `usage` object.
 */
export function parseReplayUsage(provider: string, resBody: Record<string, unknown>): ReplayUsage {
  if (provider === 'anthropic') {
    const u = resBody['usage'] as Record<string, number> | undefined
    const promptTokens = u?.['input_tokens'] ?? 0
    const completionTokens = u?.['output_tokens'] ?? 0
    return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens }
  }
  if (provider === 'gemini') {
    const u = resBody['usageMetadata'] as Record<string, number> | undefined
    const promptTokens = u?.['promptTokenCount'] ?? 0
    // Gemini 2.5+/3 thinking models report reasoning tokens in
    // thoughtsTokenCount, which Google bills at the OUTPUT rate and which
    // candidatesTokenCount excludes — fold them into completion tokens so cost
    // isn't under-reported (see parsers/gemini.ts). totalTokenCount already
    // includes thoughts, so prompt + completion stays consistent with total.
    const completionTokens = (u?.['candidatesTokenCount'] ?? 0) + (u?.['thoughtsTokenCount'] ?? 0)
    const totalTokens = u?.['totalTokenCount'] ?? promptTokens + completionTokens
    return { promptTokens, completionTokens, totalTokens }
  }
  if (isOpenAiCompatReplayProvider(provider)) {
    const u = resBody['usage'] as Record<string, number> | undefined
    return {
      promptTokens: u?.['prompt_tokens'] ?? 0,
      completionTokens: u?.['completion_tokens'] ?? 0,
      totalTokens: u?.['total_tokens'] ?? 0,
    }
  }
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
}
