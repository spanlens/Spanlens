/**
 * Regression tests for the client-disconnect path of the shared stream pumps.
 *
 * WHY these run against a REAL Hono app instead of mocks: the original #388
 * disconnect fix wrapped `honoStream.write()` in try/catch — dead code,
 * because hono's `StreamingApi.write()` swallows writer errors internally and
 * never rejects. Mock-based tests (stream-logger-cost.test.ts) asserted
 * behavior GIVEN a truncated flag and missed that the flag could never be set.
 * These tests exercise hono's actual StreamingApi/TransformStream semantics:
 * cancelling the response body reader (what api/index.ts does when the Node
 * socket closes) must abort the pump, cancel the UPSTREAM reader, and still
 * log the partial row with truncated=true.
 */

import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { runLineBufferedStreamPump, runChunkAccumulatedStreamPump } from './stream-pump.js'

const encoder = new TextEncoder()

/**
 * Upstream stub: emits one chunk immediately, then keeps the stream open
 * (as a long LLM generation would) until cancelled. Exposes whether the
 * proxy cancelled it — the resource-release assertion at the heart of the
 * disconnect fix.
 */
function makeHangingUpstream(firstChunk: string) {
  let cancelled = false
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
      c.enqueue(encoder.encode(firstChunk))
    },
    cancel() {
      cancelled = true
    },
  })
  return {
    response: new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    wasCancelled: () => cancelled,
    finish: () => controller.close(),
  }
}

function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const tick = () => {
      if (check()) return resolve()
      if (Date.now() - startedAt > timeoutMs) return reject(new Error('waitFor timed out'))
      setTimeout(tick, 10)
    }
    tick()
  })
}

describe('runLineBufferedStreamPump — client disconnect (real hono StreamingApi)', () => {
  it('cancelling the downstream response body cancels the upstream and logs truncated=true', async () => {
    const upstream = makeHangingUpstream('data: {"partial":1}\n\n')
    const onComplete = vi.fn().mockResolvedValue(undefined)

    const app = new Hono()
    app.get('/s', (c) =>
      runLineBufferedStreamPump({
        c,
        upstreamRes: upstream.response,
        handlerStartMs: Date.now(),
        provider: 'openai',
        onComplete,
      }),
    )

    const res = await app.request('/s')
    expect(res.body).toBeTruthy()
    const reader = res.body!.getReader()

    // Receive the first forwarded chunk, then abandon the response — the
    // exact thing api/index.ts does on the Node socket 'close' event.
    const first = await reader.read()
    expect(first.done).toBe(false)
    await reader.cancel()

    await waitFor(() => onComplete.mock.calls.length > 0)

    // The upstream LLM connection must be released promptly — not held until
    // the 290s deadline (the #388 regression this test pins down).
    expect(upstream.wasCancelled()).toBe(true)
    const [lines, truncated] = onComplete.mock.calls[0] as [string[], boolean]
    expect(truncated).toBe(true)
    // The partial chunk that made it out is still captured for the log row.
    expect(lines.join('\n')).toContain('"partial":1')
  })

  it('normal completion logs truncated=false and does not cancel upstream mid-flight', async () => {
    const upstream = makeHangingUpstream('data: {"ok":1}\n\n')
    const onComplete = vi.fn().mockResolvedValue(undefined)

    const app = new Hono()
    app.get('/s', (c) =>
      runLineBufferedStreamPump({
        c,
        upstreamRes: upstream.response,
        handlerStartMs: Date.now(),
        provider: 'openai',
        onComplete,
      }),
    )

    const res = await app.request('/s')
    const reader = res.body!.getReader()
    await reader.read() // first chunk delivered
    upstream.finish() // upstream ends cleanly
    // Drain to completion like a healthy client.
    for (;;) {
      const { done } = await reader.read()
      if (done) break
    }

    await waitFor(() => onComplete.mock.calls.length > 0)
    const [lines, truncated] = onComplete.mock.calls[0] as [string[], boolean]
    expect(truncated).toBe(false)
    expect(lines.join('\n')).toContain('"ok":1')
  })
})

describe('runChunkAccumulatedStreamPump — client disconnect (real hono StreamingApi)', () => {
  it('cancelling the downstream response body cancels the upstream and logs truncated=true', async () => {
    const upstream = makeHangingUpstream('data: {"gemini":1}\n')
    const onComplete = vi.fn().mockResolvedValue(undefined)

    const app = new Hono()
    app.get('/g', (c) =>
      runChunkAccumulatedStreamPump({
        c,
        upstreamRes: upstream.response,
        handlerStartMs: Date.now(),
        provider: 'gemini',
        onComplete,
      }),
    )

    const res = await app.request('/g')
    const reader = res.body!.getReader()
    const first = await reader.read()
    expect(first.done).toBe(false)
    await reader.cancel()

    await waitFor(() => onComplete.mock.calls.length > 0)

    expect(upstream.wasCancelled()).toBe(true)
    const [buffer, truncated] = onComplete.mock.calls[0] as [string, boolean]
    expect(truncated).toBe(true)
    expect(buffer).toContain('"gemini":1')
  })
})
