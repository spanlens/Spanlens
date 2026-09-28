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

import { calculateCost, type Provider } from './cost.js'
import { parseOpenAIResponse, type ParsedUsage, type ServiceTier } from '../parsers/openai.js'
import { parseAnthropicResponse } from '../parsers/anthropic.js'
import { parseGeminiResponse } from '../parsers/gemini.js'

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

/**
 * Token usage of a replay response, normalized by the SAME parsers the proxy
 * uses (parsers/openai.ts, anthropic.ts, gemini.ts), so a replayed call is
 * priced exactly like the original: cached input at the cache rates, the
 * served service tier, Anthropic cache tokens counted into promptTokens, and
 * Gemini reasoning tokens folded into completionTokens.
 */
export interface ReplayUsage {
  /** Gross input tokens, cached portions included. */
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** Subset of promptTokens served from a prompt cache. */
  cacheReadTokens: number
  /** Subset of promptTokens that created a cache entry (Anthropic). */
  cacheWriteTokens: number
  serviceTier: ServiceTier | undefined
  /** Model the provider reports serving (often a dated variant); '' if absent. */
  model: string
  /** Billed USD the provider reported itself (OpenRouter `usage.cost`). */
  reportedCostUsd: number | null
}

function toReplayUsage(parsed: ParsedUsage, reportedCostUsd: number | null): ReplayUsage {
  return {
    promptTokens: parsed.promptTokens,
    completionTokens: parsed.completionTokens,
    totalTokens: parsed.totalTokens,
    cacheReadTokens: parsed.cacheReadTokens ?? 0,
    cacheWriteTokens: parsed.cacheWriteTokens ?? 0,
    serviceTier: parsed.serviceTier,
    model: parsed.model,
    reportedCostUsd,
  }
}

/** OpenRouter's own `usage.cost` (USD), the same field proxy/openrouter.ts prefers. */
function openRouterReportedCost(resBody: Record<string, unknown>): number | null {
  const usage = resBody['usage']
  if (typeof usage !== 'object' || usage === null) return null
  const cost = (usage as Record<string, unknown>)['cost']
  return typeof cost === 'number' && Number.isFinite(cost) ? cost : null
}

/**
 * Extract token usage from a non-streaming replay response. Returns null when
 * the provider reported no usage we can read, which the caller records as an
 * unknown cost rather than a $0 one.
 */
export function parseReplayUsage(provider: string, resBody: Record<string, unknown>): ReplayUsage | null {
  if (provider === 'anthropic') {
    const parsed = parseAnthropicResponse(resBody)
    return parsed ? toReplayUsage(parsed, null) : null
  }
  if (provider === 'gemini') {
    const parsed = parseGeminiResponse(resBody)
    return parsed ? toReplayUsage(parsed, null) : null
  }
  if (isOpenAiCompatReplayProvider(provider)) {
    // Replay always calls /v1/chat/completions, so the Chat Completions schema.
    const parsed = parseOpenAIResponse(resBody, 'chat')
    if (!parsed) return null
    return toReplayUsage(parsed, provider === 'openrouter' ? openRouterReportedCost(resBody) : null)
  }
  return null
}

/** Zero usage, for pricing a failed attempt the way the proxy does. */
export const EMPTY_REPLAY_USAGE: ReplayUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  serviceTier: undefined,
  model: '',
  reportedCostUsd: null,
}

/** Drop a vendor prefix (`anthropic/claude-...` to `claude-...`). */
function stripVendorPrefix(modelId: string): string {
  const idx = modelId.indexOf('/')
  return idx === -1 ? modelId : modelId.slice(idx + 1)
}

/**
 * Cost of a replayed call, in the same preference order the proxy uses
 * (proxy/openrouter.ts and proxy/stream-logger.ts for OpenRouter):
 *   1. the provider's own billed amount (OpenRouter `usage.cost`),
 *   2. the local price table for the full model id,
 *   3. OpenRouter only: the vendor-stripped id,
 *   4. null (unpriced model).
 */
export function replayCostUsd(provider: string, model: string, usage: ReplayUsage): number | null {
  if (usage.reportedCostUsd !== null) return usage.reportedCostUsd
  const tokens = {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    serviceTier: usage.serviceTier,
  }
  const direct = calculateCost(provider as Provider, model, tokens)
  if (direct || provider !== 'openrouter') return direct?.totalCost ?? null
  return calculateCost('openrouter', stripVendorPrefix(model), tokens)?.totalCost ?? null
}

/**
 * Whole-call deadline for a replay, in ms. Same env var and default as the
 * proxy's UPSTREAM_TIMEOUT_MS (proxy/shared/upstream-fetch.ts). Replay is
 * non-streaming, so the provider only answers once generation is done and one
 * budget for headers plus body matches what the proxy allows. Read per call so
 * a config change needs no module reload.
 */
export function replayTimeoutMs(): number {
  const parsed = parseInt(process.env['UPSTREAM_TIMEOUT_MS'] ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 35_000
}

export type ReplayFetchOutcome =
  | { kind: 'response'; status: number; ok: boolean; bodyText: string; latencyMs: number }
  | { kind: 'timeout'; latencyMs: number; timeoutMs: number }
  | { kind: 'network'; latencyMs: number; message: string }

/**
 * POST the replay body with one deadline covering both the response headers
 * and the body read. Aborting the fetch signal also errors a body that is
 * still streaming, so a provider that sends headers and then stalls cannot
 * hold the request open. Never throws: the caller logs every outcome.
 */
export async function fetchReplayUpstream(
  upstream: ReplayUpstream,
  body: string,
  timeoutMs: number,
): Promise<ReplayFetchOutcome> {
  const startMs = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(upstream.url, {
      method: 'POST',
      headers: upstream.headers,
      body,
      signal: controller.signal,
    })
    const bodyText = await res.text()
    return { kind: 'response', status: res.status, ok: res.ok, bodyText, latencyMs: Date.now() - startMs }
  } catch (err) {
    const latencyMs = Date.now() - startMs
    if (controller.signal.aborted) return { kind: 'timeout', latencyMs, timeoutMs }
    return { kind: 'network', latencyMs, message: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timer)
  }
}
