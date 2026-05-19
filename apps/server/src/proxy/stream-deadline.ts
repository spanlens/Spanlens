// ─────────────────────────────────────────────────────────────────────────────
// Stream deadline helper — graceful timeout for proxy streaming responses.
//
// THE PROBLEM
// -----------
// Spanlens runs on Vercel Pro with a 300-second function ceiling. If a
// streaming proxy request still hasn't drained the upstream body when we hit
// that wall, Vercel kills the function — the client sees a connection reset,
// the row never reaches ClickHouse, and the customer's bill silently absorbs
// the tokens without any UI evidence that anything went wrong.
//
// THE SOLUTION
// ------------
// We give the pump loop a deadline of `STREAM_DEADLINE_MS` (default 290 000ms
// — 10s under the Vercel limit). When it fires, we:
//   1. stop reading from the upstream (cancel the reader),
//   2. fall out of the pump,
//   3. let the proxy log the partial response with `truncated: true`.
//
// The 10-second buffer covers the fire-and-forget `logRequestAsync` chain
// (ClickHouse insert + optional security alert email) drained through
// `waitUntil` — it must finish before Vercel reaps the instance, or the row
// gets dropped (CLAUDE.md gotcha #8).
//
// Tunable via the `STREAM_DEADLINE_MS` env var, mostly for tests and for
// downstream operators on different Vercel plans (Hobby caps at 60s, in
// which case 50000 is appropriate).
//
// CLIENT SIGNAL
// -------------
// We DO NOT inject a custom SSE event on truncation. Reasons:
//   - Each upstream uses a different SSE dialect (OpenAI `data:` + `[DONE]`,
//     Anthropic typed events, Gemini newline-JSON). A custom event safe in
//     all three doesn't exist.
//   - SDK parsers would treat our event as a malformed chunk and error out,
//     which is worse than the natural connection-close they already handle.
// Truncation is observable through:
//   - Connection close before `[DONE]` (OpenAI) / `message_stop` (Anthropic)
//   - The dashboard's truncated badge / `truncated` filter
//   - A future `X-Spanlens-Truncated: true` response header (requires hot
//     reflection of trailing headers; not implemented yet)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Total handler budget in milliseconds, including pre-fetch overhead. Default
 * 290 000ms leaves a 10s grace window under Vercel Pro's 300s ceiling for
 * `waitUntil` to drain the log/alert chain.
 */
export const STREAM_DEADLINE_MS = parseInt(
  process.env['STREAM_DEADLINE_MS'] ?? '290000',
  10,
)

export interface StreamDeadline {
  /** Absolute ms-since-epoch when the handler MUST surrender control. */
  deadlineAtMs: number
}

export function makeStreamDeadline(handlerStartMs: number, budgetMs = STREAM_DEADLINE_MS): StreamDeadline {
  return { deadlineAtMs: handlerStartMs + budgetMs }
}

export type ReadOutcome<T> =
  | { kind: 'chunk'; value: T }
  | { kind: 'done' }
  | { kind: 'timeout' }
  | { kind: 'error'; error: unknown }

/**
 * Race a single `reader.read()` against the remaining deadline budget.
 *
 *   • `chunk`: bytes arrived; proxy forwards to client, continues pumping.
 *   • `done`: stream ended cleanly; proxy exits the loop normally.
 *   • `timeout`: deadline reached; proxy cancels the reader and logs `truncated`.
 *   • `error`: read threw (network reset, malformed stream); proxy logs the
 *     error and exits — same code path as timeout but the cause differs.
 *
 * The timeout timer is always cleared before this function returns, so leaked
 * timers can't keep the function instance alive after the response finishes
 * (which would leak Node memory across Vercel cold starts).
 */
export async function readWithDeadline<T>(
  reader: ReadableStreamDefaultReader<T>,
  deadline: StreamDeadline,
): Promise<ReadOutcome<T>> {
  const remaining = deadline.deadlineAtMs - Date.now()
  if (remaining <= 0) return { kind: 'timeout' }

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<ReadOutcome<T>>((resolve) => {
    timeoutId = setTimeout(() => resolve({ kind: 'timeout' }), remaining)
  })

  const readPromise: Promise<ReadOutcome<T>> = reader.read().then(
    (r) => (r.done ? { kind: 'done' as const } : { kind: 'chunk' as const, value: r.value }),
    (error: unknown) => ({ kind: 'error' as const, error }),
  )

  try {
    return await Promise.race([readPromise, timeoutPromise])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

/**
 * Cancel the upstream reader without throwing. Used when the deadline fires
 * or an error short-circuits the pump — we still want to drop the upstream
 * socket so its TCP buffer doesn't keep the function instance pinned.
 */
export async function cancelReaderSilently<T>(reader: ReadableStreamDefaultReader<T>): Promise<void> {
  try {
    await reader.cancel()
  } catch {
    /* upstream already closed or aborted — nothing to do */
  }
}
