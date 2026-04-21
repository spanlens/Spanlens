import type { SpanHandle } from './span.js'
import type { TraceHandle } from './trace.js'
import type { SpanOptions } from './types.js'

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
