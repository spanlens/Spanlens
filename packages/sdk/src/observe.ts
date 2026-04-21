import type { SpanHandle } from './span.js'
import type { TraceHandle } from './trace.js'
import type { SpanOptions } from './types.js'
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
    // span.end is idempotent — user may have called it manually inside fn
    await span.end({ status: 'completed' })
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

type Usage = 'openai' | 'anthropic' | 'gemini'

function spanOptionsFromArg(
  nameOrOptions: string | Omit<SpanOptions, 'spanType'>,
): SpanOptions {
  if (typeof nameOrOptions === 'string') {
    return { name: nameOrOptions, spanType: 'llm' }
  }
  return { ...nameOrOptions, spanType: 'llm' }
}

async function observeProvider<T>(
  provider: Usage,
  parent: TraceHandle | SpanHandle,
  nameOrOptions: string | Omit<SpanOptions, 'spanType'>,
  fn: (headers: Record<string, string>) => Promise<T>,
): Promise<T> {
  const span =
    'span' in parent && typeof parent.span === 'function'
      ? parent.span(spanOptionsFromArg(nameOrOptions))
      : (parent as SpanHandle).child(spanOptionsFromArg(nameOrOptions))

  const headers = span.traceHeaders()

  try {
    const result = await fn(headers)

    // Auto-parse usage from the provider response shape
    const parsed =
      provider === 'openai'
        ? parseOpenAIUsage(result)
        : provider === 'anthropic'
          ? parseAnthropicUsage(result)
          : parseGeminiUsage(result)

    await span.end({ status: 'completed', ...parsed })
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
  nameOrOptions: string | Omit<SpanOptions, 'spanType'>,
  fn: (headers: Record<string, string>) => Promise<T>,
): Promise<T> {
  return observeProvider('openai', parent, nameOrOptions, fn)
}

/** Anthropic variant — parses `input_tokens` / `output_tokens` into the span. */
export function observeAnthropic<T>(
  parent: TraceHandle | SpanHandle,
  nameOrOptions: string | Omit<SpanOptions, 'spanType'>,
  fn: (headers: Record<string, string>) => Promise<T>,
): Promise<T> {
  return observeProvider('anthropic', parent, nameOrOptions, fn)
}

/** Gemini variant — parses `usageMetadata` into the span. */
export function observeGemini<T>(
  parent: TraceHandle | SpanHandle,
  nameOrOptions: string | Omit<SpanOptions, 'spanType'>,
  fn: (headers: Record<string, string>) => Promise<T>,
): Promise<T> {
  return observeProvider('gemini', parent, nameOrOptions, fn)
}
