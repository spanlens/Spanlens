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
import { runLineBufferedStreamPump, runChunkAccumulatedStreamPump, type StreamEnd } from './stream-pump.js'
import { STREAM_DEADLINE_MS } from '../stream-deadline.js'

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
    /** The provider's connection dies mid-stream (undici surfaces a TypeError). */
    fail: (err: unknown) => controller.error(err),
  }
}

/** Reads the downstream body to its end, as a healthy client would. */
async function drain(res: Response): Promise<string> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return text
    text += decoder.decode(value, { stream: true })
  }
}

/** A socket reset the way undici reports it: TypeError('terminated') with a coded cause. */
function socketReset(): TypeError {
  return new TypeError('terminated', { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) })
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
        requestStartMs: Date.now(),
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
    const [lines, truncated, end] = onComplete.mock.calls[0] as [string[], boolean, StreamEnd]
    expect(truncated).toBe(true)
    // The client chose to leave: incomplete, but not an error on anyone's side.
    expect(end).toEqual({ reason: 'client_disconnect', errorMessage: null })
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
        requestStartMs: Date.now(),
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
    const [lines, truncated, end] = onComplete.mock.calls[0] as [string[], boolean, StreamEnd]
    expect(truncated).toBe(false)
    expect(end).toEqual({ reason: 'complete', errorMessage: null })
    expect(lines.join('\n')).toContain('"ok":1')
  })
})

describe('runLineBufferedStreamPump — the provider drops the stream mid-flight (C9.1)', () => {
  it('logs the partial row as incomplete with an error message, not as a clean 200', async () => {
    const upstream = makeHangingUpstream('data: {"partial":1}\n\n')
    const onComplete = vi.fn().mockResolvedValue(undefined)

    const app = new Hono()
    app.get('/s', (c) =>
      runLineBufferedStreamPump({
        c,
        upstreamRes: upstream.response,
        requestStartMs: Date.now(),
        provider: 'openai',
        onComplete,
      }),
    )

    const res = await app.request('/s')
    const reader = res.body!.getReader()
    await reader.read() // first chunk delivered
    upstream.fail(socketReset())
    for (;;) {
      const { done } = await reader.read()
      if (done) break
    }

    await waitFor(() => onComplete.mock.calls.length > 0)
    const [lines, truncated, end] = onComplete.mock.calls[0] as [string[], boolean, StreamEnd]
    // Headers already went out as 200, so the row keeps that status; the
    // truncated flag and the message are what mark it incomplete.
    expect(res.status).toBe(200)
    expect(truncated).toBe(true)
    expect(end.reason).toBe('upstream_error')
    expect(end.errorMessage).toMatch(/^Upstream stream interrupted before completion/)
    expect(end.errorMessage).toContain('UND_ERR_SOCKET')
    expect(lines.join('\n')).toContain('"partial":1')
  })

  it('the stream deadline is reported as its own reason', async () => {
    const upstream = makeHangingUpstream('data: {"partial":1}\n\n')
    const onComplete = vi.fn().mockResolvedValue(undefined)

    const app = new Hono()
    app.get('/s', (c) =>
      runLineBufferedStreamPump({
        c,
        upstreamRes: upstream.response,
        // Arrived one budget ago: the deadline has already passed.
        requestStartMs: Date.now() - STREAM_DEADLINE_MS - 1,
        provider: 'openai',
        onComplete,
      }),
    )

    const res = await app.request('/s')
    await drain(res)

    await waitFor(() => onComplete.mock.calls.length > 0)
    const [, truncated, end] = onComplete.mock.calls[0] as [string[], boolean, StreamEnd]
    expect(truncated).toBe(true)
    expect(end.reason).toBe('deadline')
    expect(end.errorMessage).toContain(`${STREAM_DEADLINE_MS}ms`)
    expect(upstream.wasCancelled()).toBe(true)
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
        requestStartMs: Date.now(),
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
    const [buffer, truncated, end] = onComplete.mock.calls[0] as [string, boolean, StreamEnd]
    expect(truncated).toBe(true)
    expect(end.reason).toBe('client_disconnect')
    expect(buffer).toContain('"gemini":1')
  })

  it('the provider dropping the stream is logged as incomplete (C9.1)', async () => {
    const upstream = makeHangingUpstream('data: {"gemini":1}\n')
    const onComplete = vi.fn().mockResolvedValue(undefined)

    const app = new Hono()
    app.get('/g', (c) =>
      runChunkAccumulatedStreamPump({
        c,
        upstreamRes: upstream.response,
        requestStartMs: Date.now(),
        provider: 'gemini',
        onComplete,
      }),
    )

    const res = await app.request('/g')
    const reader = res.body!.getReader()
    await reader.read()
    upstream.fail(socketReset())
    for (;;) {
      const { done } = await reader.read()
      if (done) break
    }

    await waitFor(() => onComplete.mock.calls.length > 0)
    const [buffer, truncated, end] = onComplete.mock.calls[0] as [string, boolean, StreamEnd]
    expect(truncated).toBe(true)
    expect(end.reason).toBe('upstream_error')
    expect(end.errorMessage).toMatch(/^Upstream stream interrupted before completion/)
    expect(buffer).toContain('"gemini":1')
  })

  it('a clean end reports complete', async () => {
    const upstream = makeHangingUpstream('data: {"gemini":1}\n')
    const onComplete = vi.fn().mockResolvedValue(undefined)

    const app = new Hono()
    app.get('/g', (c) =>
      runChunkAccumulatedStreamPump({
        c,
        upstreamRes: upstream.response,
        requestStartMs: Date.now(),
        provider: 'gemini',
        onComplete,
      }),
    )

    const res = await app.request('/g')
    upstream.finish()
    await drain(res)

    await waitFor(() => onComplete.mock.calls.length > 0)
    const [, truncated, end] = onComplete.mock.calls[0] as [string, boolean, StreamEnd]
    expect(truncated).toBe(false)
    expect(end).toEqual({ reason: 'complete', errorMessage: null })
  })
})
