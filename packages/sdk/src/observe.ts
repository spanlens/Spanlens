import type { SpanHandle } from './span.js'
import type { TraceHandle } from './trace.js'
import type { LogBodyMode, SpanOptions } from './types.js'
import { parseOpenAIUsage, parseAnthropicUsage, parseGeminiUsage } from './parsers.js'

/**
 * Wrap an async function in a span — ensures `span.end()` is called
 * even when the function throws. The span status is set to 'error'
 * and `error_message` is captured from the thrown error.
 *
 * @example
 * const result = await observe(trace, { name: 'call_openai', spanType: 'llm' }, async (span) => {
 *   const res = await openai.chat.completions.create({...})
 *   span.end({ totalTokens: res.usage.total_tokens, costUsd: ... })
 *   return res
 * })
 *
 * // With automatic end():
 * const result = await observe(trace, { name: 'vector_search', spanType: 'retrieval' }, async () => {
 *   return vectorStore.query(...)
 * })
 */
export async function observe<T>(
  parent: TraceHandle | SpanHandle,
  options: SpanOptions,
  fn: (span: SpanHandle) => Promise<T>,
): Promise<T> {
  const span =
    'span' in parent && typeof parent.span === 'function'
      ? parent.span(options)
      : (parent as SpanHandle).child(options)

  try {
    const result = await fn(span)
    // Auto-capture return value as output unless it's a genuine stream (not
    // serialisable). If the user already called span.end() manually inside fn
    // (e.g. streaming), SpanHandle.end() will send a supplementary output-only PATCH.
    const isStream = isStreamLike(result)
    await span.end({ status: 'completed', output: isStream ? undefined : result })
    return result
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    // Do not let a failing span.end() mask the user's original error — swallow
    // the end() rejection so `throw err` always runs and propagates unchanged.
    await span.end({ status: 'error', errorMessage }).catch(() => {})
    throw err
  }
}

/**
 * True only for genuine streams whose contents are NOT safely serialisable as
 * span output: async iterables (async generators) and ReadableStream-likes.
 *
 * Plain sync-iterable containers (arrays, Map, Set, etc.) are explicitly
 * EXCLUDED — they are serialisable return values (e.g. a retrieval result
 * array) and must be captured as output, not silently dropped as "a stream".
 */
function isStreamLike(result: unknown): boolean {
  if (result == null || typeof result !== 'object') return false
  // Arrays and other plain sync-iterable containers are serialisable output.
  if (Array.isArray(result)) return false
  const obj = result as Record<PropertyKey, unknown>
  // Async iterables (async generators) are real streams.
  if (Symbol.asyncIterator in obj) return true
  // ReadableStream (Web Streams) — direct instance or duck-typed.
  if (typeof ReadableStream !== 'undefined' && result instanceof ReadableStream) return true
  if (typeof obj['getReader'] === 'function' || typeof obj['tee'] === 'function') return true
  return false
}

// ── Provider-specific auto-instrumentation helpers ─────────────
//
// These take a callback that receives tracing headers, run it inside a span,
// auto-parse usage from the returned LLM response, and end the span.
//
// Usage pattern:
//   const res = await observeOpenAI(trace, 'summarize', (headers) =>
//     openai.chat.completions.create({ ... }, { headers })
//   )

type Usage =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'ollama'
  | 'groq'
  | 'deepseek'
  | 'xai'
  | 'cohere'

// OpenAI-compatible providers whose responses carry the standard OpenAI
// `usage` shape (prompt_tokens / completion_tokens) — parsed by parseOpenAIUsage.
const OPENAI_SHAPED = new Set<Usage>([
  'openai', 'ollama', 'groq', 'deepseek', 'xai', 'cohere',
])

const PROMPT_VERSION_HEADER = 'x-spanlens-prompt-version'
const LOG_BODY_HEADER = 'x-spanlens-log-body'
const CACHE_HEADER = 'x-spanlens-cache'
/** Server caps any requested cache TTL at this many seconds (24h). */
const CACHE_MAX_TTL_SECONDS = 86400

/**
 * Serialize the `cache` observe option into the `x-spanlens-cache` header
 * value, or `null` when it is not a valid directive. Mirrors the `withCache`
 * helpers and the server (`apps/server/src/lib/proxy-cache.ts`): `true` maps to
 * `'true'`, a positive integer is clamped to CACHE_MAX_TTL_SECONDS, and any
 * other value emits no header.
 */
function cacheHeaderValue(ttl: number | true | undefined): string | null {
  if (ttl === undefined) return null
  if (ttl === true) return 'true'
  if (typeof ttl !== 'number' || !Number.isInteger(ttl) || ttl <= 0) return null
  return String(Math.min(ttl, CACHE_MAX_TTL_SECONDS))
}

/** Provider-observe options — narrower than SpanOptions; adds optional promptVersion + logBody. */
export type ProviderObserveOptions = Omit<SpanOptions, 'spanType'> & {
  /** Tag the logged request with a Spanlens prompt version (name@version, name@latest, or UUID). */
  promptVersion?: string
  /**
   * Control how much of this call is persisted by Spanlens.
   * Defaults to whatever the server has for `full` (the prompts and responses are saved).
   * Override to `'meta'` or `'none'` for stricter data minimization — see LogBodyMode docs.
   */
  logBody?: LogBodyMode
  /**
   * Opt this single call into the Spanlens proxy response cache. `true` uses the
   * default TTL (1 hour); a positive integer sets the TTL in seconds, capped at
   * 86400 (24h) server-side. Non-streaming 200 JSON responses only. Maps 1:1 to
   * the `withCache()` helper. See the proxy caching docs for the full rules.
   */
  cache?: number | true
  /**
   * Override the provider tag on this span's metadata. Useful when calling an
   * OpenAI-compatible endpoint that isn't actually OpenAI (Ollama, vLLM,
   * LM Studio, Together, Groq, etc.). Defaults to the provider implied by the
   * `observe<Provider>` helper used.
   *
   * For Ollama specifically, prefer the dedicated `observeOllama()` helper —
   * this option is the escape hatch for everything else.
   */
  provider?: string
}

function splitArgs(
  nameOrOptions: string | ProviderObserveOptions,
): {
  spanOptions: SpanOptions
  promptVersion: string | undefined
  logBody: LogBodyMode | undefined
  cache: number | true | undefined
  providerOverride: string | undefined
} {
  if (typeof nameOrOptions === 'string') {
    return {
      spanOptions: { name: nameOrOptions, spanType: 'llm' },
      promptVersion: undefined,
      logBody: undefined,
      cache: undefined,
      providerOverride: undefined,
    }
  }
  const { promptVersion, logBody, cache, provider: providerOverride, ...rest } = nameOrOptions
  return {
    spanOptions: { ...rest, spanType: 'llm' },
    promptVersion,
    logBody,
    cache,
    providerOverride,
  }
}

async function observeProvider<T>(
  provider: Usage,
  parent: TraceHandle | SpanHandle,
  nameOrOptions: string | ProviderObserveOptions,
  fn: (headers: Record<string, string>) => Promise<T>,
): Promise<T> {
  const { spanOptions, promptVersion, logBody, cache, providerOverride } = splitArgs(nameOrOptions)

  const span =
    'span' in parent && typeof parent.span === 'function'
      ? parent.span(spanOptions)
      : (parent as SpanHandle).child(spanOptions)

  const headers: Record<string, string> = { ...span.traceHeaders() }
  if (promptVersion) headers[PROMPT_VERSION_HEADER] = promptVersion
  if (logBody) headers[LOG_BODY_HEADER] = logBody
  const cacheValue = cacheHeaderValue(cache)
  if (cacheValue != null) headers[CACHE_HEADER] = cacheValue

  try {
    const result = await fn(headers)

    // Auto-parse usage from the provider response shape.
    // OpenAI-compatible providers (Ollama, Groq, DeepSeek, xAI, Cohere) expose
    // an OpenAI-shaped `usage` field, so the OpenAI parser works as-is — only
    // the provider tag differs.
    const parsed =
      OPENAI_SHAPED.has(provider)
        ? parseOpenAIUsage(result)
        : provider === 'anthropic'
          ? parseAnthropicUsage(result)
          : parseGeminiUsage(result)

    // Stamp the provider tag onto the span metadata. The explicit override
    // (e.g. observeOpenAI(..., { provider: 'vllm' })) wins over the default,
    // which is the wrapper name (openai/anthropic/gemini/ollama).
    const providerTag = providerOverride ?? provider
    const metadataWithProvider = {
      ...(parsed.metadata ?? {}),
      provider: providerTag,
    }
    const enriched = { ...parsed, metadata: metadataWithProvider }

    // Capture the full response as output unless it's a genuine stream (not serializable)
    const output = isStreamLike(result) ? undefined : result

    await span.end({ status: 'completed', output, ...enriched })
    return result
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    // Do not let a failing span.end() mask the user's original error — swallow
    // the end() rejection so `throw err` always runs and propagates unchanged.
    await span.end({ status: 'error', errorMessage }).catch(() => {})
    throw err
  }
}

/**
 * Observe an OpenAI call. Auto-injects `x-trace-id` + `x-span-id` headers
 * into the callback, auto-parses `usage` from the response, auto-ends the span.
 *
 * @example
 *   const res = await observeOpenAI(trace, 'answer', (headers) =>
 *     openai.chat.completions.create({ model: 'gpt-4o', messages }, { headers })
 *   )
 *   // span now has promptTokens/completionTokens/totalTokens + model in metadata
 */
export function observeOpenAI<T>(
  parent: TraceHandle | SpanHandle,
  nameOrOptions: string | ProviderObserveOptions,
  fn: (headers: Record<string, string>) => Promise<T>,
): Promise<T> {
  return observeProvider('openai', parent, nameOrOptions, fn)
}

/** Anthropic variant — parses `input_tokens` / `output_tokens` into the span. */
export function observeAnthropic<T>(
  parent: TraceHandle | SpanHandle,
  nameOrOptions: string | ProviderObserveOptions,
  fn: (headers: Record<string, string>) => Promise<T>,
): Promise<T> {
  return observeProvider('anthropic', parent, nameOrOptions, fn)
}

/** Gemini variant — parses `usageMetadata` into the span. */
export function observeGemini<T>(
  parent: TraceHandle | SpanHandle,
  nameOrOptions: string | ProviderObserveOptions,
  fn: (headers: Record<string, string>) => Promise<T>,
): Promise<T> {
  return observeProvider('gemini', parent, nameOrOptions, fn)
}

/**
 * Ollama variant — for **self-hosted** local LLMs through Ollama's
 * OpenAI-compatible endpoint (`http://localhost:11434/v1`). The trace is
 * tagged `provider: 'ollama'` so the dashboard surfaces it correctly even
 * though the response shape is identical to OpenAI's.
 *
 * Cost is left as null (self-hosted compute = no per-token charge that
 * Spanlens can compute) and the dashboard renders a "Self-hosted" badge
 * in the cost column.
 *
 * @example
 *   import OpenAI from 'openai'
 *   import { observeOllama } from '@spanlens/sdk'
 *
 *   const ollama = new OpenAI({
 *     baseURL: 'http://localhost:11434/v1',
 *     apiKey: 'ollama', // ignored by local Ollama; required by the SDK
 *   })
 *
 *   const res = await observeOllama(trace, 'chat', (headers) =>
 *     ollama.chat.completions.create({
 *       model: 'llama3.2',
 *       messages: [{ role: 'user', content: 'Hello' }],
 *     }, { headers })
 *   )
 *
 * For other OpenAI-compatible self-hosted runtimes (vLLM, LM Studio, etc.)
 * use `observeOpenAI(..., { provider: 'vllm' })` with the provider override.
 */
export function observeOllama<T>(
  parent: TraceHandle | SpanHandle,
  nameOrOptions: string | ProviderObserveOptions,
  fn: (headers: Record<string, string>) => Promise<T>,
): Promise<T> {
  return observeProvider('ollama', parent, nameOrOptions, fn)
}

/**
 * Groq variant — Groq's API is OpenAI-compatible, so `usage` is parsed with
 * the OpenAI parser and the span is tagged `provider: 'groq'`. Prefer the
 * dedicated `createGroq()` client from `@spanlens/sdk/groq`.
 */
export function observeGroq<T>(
  parent: TraceHandle | SpanHandle,
  nameOrOptions: string | ProviderObserveOptions,
  fn: (headers: Record<string, string>) => Promise<T>,
): Promise<T> {
  return observeProvider('groq', parent, nameOrOptions, fn)
}

/** DeepSeek variant — OpenAI-compatible `usage`, span tagged `provider: 'deepseek'`. */
export function observeDeepSeek<T>(
  parent: TraceHandle | SpanHandle,
  nameOrOptions: string | ProviderObserveOptions,
  fn: (headers: Record<string, string>) => Promise<T>,
): Promise<T> {
  return observeProvider('deepseek', parent, nameOrOptions, fn)
}

/** xAI (Grok) variant — OpenAI-compatible `usage`, span tagged `provider: 'xai'`. */
export function observeXai<T>(
  parent: TraceHandle | SpanHandle,
  nameOrOptions: string | ProviderObserveOptions,
  fn: (headers: Record<string, string>) => Promise<T>,
): Promise<T> {
  return observeProvider('xai', parent, nameOrOptions, fn)
}

/** Cohere variant — OpenAI-compatible `usage`, span tagged `provider: 'cohere'`. */
export function observeCohere<T>(
  parent: TraceHandle | SpanHandle,
  nameOrOptions: string | ProviderObserveOptions,
  fn: (headers: Record<string, string>) => Promise<T>,
): Promise<T> {
  return observeProvider('cohere', parent, nameOrOptions, fn)
}
