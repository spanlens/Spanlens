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
    // Auto-capture return value as output unless it's a stream (not serialisable).
    // If the user already called span.end() manually inside fn (e.g. streaming),
    // SpanHandle.end() will send a supplementary output-only PATCH.
    const isStream =
      result != null &&
      typeof result === 'object' &&
      (Symbol.asyncIterator in (result as object) || Symbol.iterator in (result as object))
    await span.end({ status: 'completed', output: isStream ? undefined : result })
    return result
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    await span.end({ status: 'error', errorMessage })
    throw err
  }
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

type Usage = 'openai' | 'anthropic' | 'gemini' | 'ollama'

const PROMPT_VERSION_HEADER = 'x-spanlens-prompt-version'
const LOG_BODY_HEADER = 'x-spanlens-log-body'

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
  providerOverride: string | undefined
} {
  if (typeof nameOrOptions === 'string') {
    return {
      spanOptions: { name: nameOrOptions, spanType: 'llm' },
      promptVersion: undefined,
      logBody: undefined,
      providerOverride: undefined,
    }
  }
  const { promptVersion, logBody, provider: providerOverride, ...rest } = nameOrOptions
  return {
    spanOptions: { ...rest, spanType: 'llm' },
    promptVersion,
    logBody,
    providerOverride,
  }
}

async function observeProvider<T>(
  provider: Usage,
  parent: TraceHandle | SpanHandle,
  nameOrOptions: string | ProviderObserveOptions,
  fn: (headers: Record<string, string>) => Promise<T>,
): Promise<T> {
  const { spanOptions, promptVersion, logBody, providerOverride } = splitArgs(nameOrOptions)

  const span =
    'span' in parent && typeof parent.span === 'function'
      ? parent.span(spanOptions)
      : (parent as SpanHandle).child(spanOptions)

  const headers: Record<string, string> = { ...span.traceHeaders() }
  if (promptVersion) headers[PROMPT_VERSION_HEADER] = promptVersion
  if (logBody) headers[LOG_BODY_HEADER] = logBody

  try {
    const result = await fn(headers)

    // Auto-parse usage from the provider response shape.
    // Ollama uses OpenAI's response schema (it exposes an /v1 OpenAI-compat
    // surface) so the OpenAI parser works as-is — only the provider tag differs.
    const parsed =
      provider === 'openai' || provider === 'ollama'
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

    // Capture the full response as output unless it's a stream (not serializable)
    const isStream = result != null &&
      typeof result === 'object' &&
      (Symbol.asyncIterator in (result as object) || Symbol.iterator in (result as object))
    const output = isStream ? undefined : result

    await span.end({ status: 'completed', output, ...enriched })
    return result
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    await span.end({ status: 'error', errorMessage })
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
