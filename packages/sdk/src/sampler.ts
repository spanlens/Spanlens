/**
 * Trace sampling — opt-in cost / volume control for the agent-tracing layer.
 *
 * Why per-trace and not per-span:
 *   A trace is the unit of value (one user request, one agent run). Sampling
 *   half the spans within a trace leaves dashboards showing inconsistent,
 *   ragged trees. Sampling whole traces keeps each surviving trace fully
 *   coherent and statistically scalable.
 *
 * Why tail-based for errors:
 *   Error traces are the most valuable signal for debugging. We always want
 *   100% of them, even when `sampleRate=0.01`. The sampler defers ingest
 *   POSTs/PATCHes for sampled-out traces and replays them only if the trace
 *   ends with `status: 'error'` — otherwise they're dropped.
 *
 * What this does NOT affect:
 *   Spanlens-proxy request logs (`requests` in ClickHouse) are unaffected.
 *   Every `/proxy/*` call is still recorded for cost / quota / anomaly use.
 *   `sampleRate` only controls the OTLP-equivalent `/ingest/*` trace + span
 *   ingestion layer.
 */

import type { Transport } from './transport.js'

/**
 * Cap on buffered ops per sampled-out trace. Bounds worst-case memory if a
 * long-running trace never ends (e.g. user forgot to call `trace.end()`).
 *
 * 1000 = ~50 spans (each span is ~1 POST + 1 PATCH) ×  20-deep nesting,
 * which is comfortably above realistic agent traces. Hitting this cap means
 * the trace's replay (on error) will be partial — preferable to OOM.
 */
const MAX_BUFFER_SIZE = 1000

export interface BufferingTransport extends Transport {
  /**
   * Replay every buffered op against the real transport, preserving FIFO
   * order. Used by `TraceHandle.end()` when the trace was sampled-out but
   * resolved with `status: 'error'`.
   *
   * After this call the buffer is cleared and the transport keeps buffering
   * subsequent ops (the only expected post-flush call is the trace's own
   * end-PATCH, which the caller routes directly to the real transport).
   */
  flushBuffered(): Promise<void>
}

/**
 * Validates a sample rate. Throws if the value is malformed — we'd rather
 * fail at SDK construction than silently drop 100% of traces because the
 * user passed `'0.1'` (string) by accident.
 */
export function validateSampleRate(value: unknown): number {
  if (value === undefined || value === null) return 1.0
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0 || value > 1) {
    throw new Error(
      `[spanlens] sampleRate must be a number in [0, 1] — got ${JSON.stringify(value)}`,
    )
  }
  return value
}

/**
 * Decide whether to sample a single trace. Pure function so tests can inject
 * a deterministic RNG.
 *
 * `sampleRate=1` (default) always returns true — short-circuits the RNG call.
 * `sampleRate=0` always returns false.
 */
export function shouldSample(sampleRate: number, rng: () => number = Math.random): boolean {
  if (sampleRate >= 1) return true
  if (sampleRate <= 0) return false
  return rng() < sampleRate
}

/**
 * Wraps `real` so that POST/PATCH calls are queued in memory instead of
 * being sent. Used for traces that lost the sampling coin-flip; the queue
 * is either replayed (on error) or dropped (on success) when the trace ends.
 *
 * The returned transport satisfies the same `Transport` interface so
 * `createTrace` / `createSpan` don't need to know about sampling at all —
 * they just see "a transport that resolves fast." This is what keeps the
 * sampling concern isolated from the ingest hot path.
 */
export function makeBufferingTransport(real: Transport): BufferingTransport {
  const buffer: Array<{ method: 'post' | 'patch'; path: string; body: unknown }> = []
  let overflowed = false

  const push = (method: 'post' | 'patch', path: string, body: unknown): void => {
    if (buffer.length < MAX_BUFFER_SIZE) {
      buffer.push({ method, path, body })
    } else {
      overflowed = true
    }
  }

  return {
    post(path, body) {
      push('post', path, body)
      return Promise.resolve(null)
    },
    patch(path, body) {
      push('patch', path, body)
      return Promise.resolve(null)
    },
    flush() {
      // Defer to the real transport's flush. Buffered ops are NOT flushed by
      // this method (it's just for in-flight network calls) — `flushBuffered`
      // is the explicit replay entry point.
      return real.flush()
    },
    async flushBuffered() {
      // Replay serially so trace POST commits before any span POST hits the
      // server's ownership check. The same ordering invariant the real
      // transport relies on via `_creationPromise` chains in trace.ts/span.ts.
      let chain: Promise<unknown> = Promise.resolve(null)
      for (const op of buffer) {
        chain = chain.then(() => real[op.method](op.path, op.body))
      }
      await chain
      buffer.length = 0
      // Note: `overflowed` is left as-is for observability (a getter could
      // be added if the SDK ever surfaces "trace truncated" warnings).
      void overflowed
    },
  }
}
