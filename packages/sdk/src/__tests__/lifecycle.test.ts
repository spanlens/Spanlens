/**
 * Span / trace lifecycle against a SLOW ingest server.
 *
 * Two contracts are pinned here:
 *
 *   1. `client.flush()` drains every end() the caller scheduled, including
 *      fire-and-forget ones (`span.end()` without await, the LlamaIndex
 *      integration) whose PATCH is chained behind a creation POST. The old
 *      flush copied the pending set once and returned while those PATCHes
 *      were still queued, so serverless handlers froze with spans 'running'.
 *
 *   2. Observability never sits on the caller's return path. `observe()` and
 *      the provider helpers return as soon as the callback settles, and
 *      `ended_at` is stamped when end() is called, not after the ingest round
 *      trips finish. A slow Spanlens server used to add every RTT to the
 *      caller's latency AND to the recorded span duration.
 *
 * The fetch stub below honours `init.signal` the way real fetch does, so
 * transport timeouts behave exactly as in production.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { SpanlensClient } from '../client.js'
import { observe, observeOpenAI } from '../observe.js'
import { registerSpanlensCallbacks } from '../integrations/llamaindex.js'

interface RecordedCall {
  method: string
  path: string
  body: Record<string, unknown>
  done: boolean
}

/** fetch stub that answers after `delayMs` (never, when `delayMs` is Infinity). */
function stubSlowFetch(delayMs: number) {
  const calls: RecordedCall[] = []
  const fetchMock = vi.fn((url: string, init: RequestInit) => {
    const rec: RecordedCall = {
      method: init.method ?? 'GET',
      path: new URL(url).pathname,
      body: init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {},
      done: false,
    }
    calls.push(rec)
    return new Promise<Response>((resolve, reject) => {
      const timer = Number.isFinite(delayMs)
        ? setTimeout(() => {
            rec.done = true
            resolve(new Response('{}', { status: 200 }))
          }, delayMs)
        : undefined
      init.signal?.addEventListener('abort', () => {
        if (timer) clearTimeout(timer)
        reject(new DOMException('The operation was aborted.', 'AbortError'))
      })
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return {
    calls,
    done: (method: string, path: string) =>
      calls.some((c) => c.method === method && c.path === path && c.done),
    find: (method: string, path: string) =>
      calls.find((c) => c.method === method && c.path === path),
  }
}

function makeClient(extra: Partial<ConstructorParameters<typeof SpanlensClient>[0]> = {}) {
  return new SpanlensClient({ apiKey: 'sl_live_test', baseUrl: 'http://x', ...extra })
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function msBetween(a: unknown, b: unknown): number {
  return new Date(String(b)).getTime() - new Date(String(a)).getTime()
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ── C13.1: flush() drains everything that was scheduled ─────────────────────

describe('client.flush()', () => {
  it('waits for fire-and-forget end() calls whose PATCH is chained behind creation POSTs', async () => {
    const net = stubSlowFetch(30)
    const client = makeClient()
    const trace = client.startTrace({ name: 't' })
    const span = trace.span({ name: 's' })

    void span.end({ totalTokens: 3 })
    void trace.end({ status: 'completed' })
    await client.flush()

    expect(net.done('POST', '/ingest/traces')).toBe(true)
    expect(net.done('POST', `/ingest/traces/${trace.traceId}/spans`)).toBe(true)
    expect(net.done('PATCH', `/ingest/spans/${span.spanId}`)).toBe(true)
    expect(net.done('PATCH', `/ingest/traces/${trace.traceId}`)).toBe(true)
  })

  it('waits for fire-and-forget end() issued after the creation POSTs already settled', async () => {
    const net = stubSlowFetch(20)
    const client = makeClient()
    const trace = client.startTrace({ name: 't' })
    const span = trace.span({ name: 's' })
    await client.flush()

    void span.end()
    void trace.end()
    await client.flush()

    expect(net.done('PATCH', `/ingest/spans/${span.spanId}`)).toBe(true)
    expect(net.done('PATCH', `/ingest/traces/${trace.traceId}`)).toBe(true)
  })

  it('drains the fire-and-forget ends of the LlamaIndex integration', async () => {
    const net = stubSlowFetch(20)
    const client = makeClient()
    const listeners = new Map<string, (payload: unknown) => void>()
    registerSpanlensCallbacks(
      {
        callbackManager: {
          on: (event, handler) => listeners.set(event, handler),
          off: (event) => listeners.delete(event),
        },
      },
      { client },
    )

    listeners.get('llm-start')?.({ detail: { id: 'call-1', messages: [] } })
    listeners.get('llm-end')?.({
      detail: { id: 'call-1', response: { raw: { usage: { input_tokens: 1, output_tokens: 2 } } } },
    })
    await client.flush()

    const spanPatch = net.calls.find((c) => c.method === 'PATCH' && c.path.startsWith('/ingest/spans/'))
    const tracePatch = net.calls.find(
      (c) => c.method === 'PATCH' && c.path.startsWith('/ingest/traces/'),
    )
    expect(spanPatch?.done).toBe(true)
    expect(tracePatch?.done).toBe(true)
  })

  it('stops waiting at flush({ timeoutMs }) when the ingest server stalls', async () => {
    stubSlowFetch(Infinity)
    const client = makeClient({ timeoutMs: 400 })
    const trace = client.startTrace({ name: 't' })
    void trace.end()

    const t0 = Date.now()
    await client.flush({ timeoutMs: 40 })
    expect(Date.now() - t0).toBeLessThan(300)
  })
})

// ── C13.2: end() stamps time at call, observe() never waits on ingest ───────

describe('ended_at and the caller return path', () => {
  it('span.end() stamps ended_at at call time, not after the creation POST lands', async () => {
    const net = stubSlowFetch(120)
    const client = makeClient()
    const trace = client.startTrace({ name: 't' })
    const span = trace.span({ name: 's' })

    void span.end()
    await client.flush()

    const patch = net.find('PATCH', `/ingest/spans/${span.spanId}`)
    const post = net.find('POST', `/ingest/traces/${trace.traceId}/spans`)
    expect(msBetween(post?.body['started_at'], patch?.body['ended_at'])).toBeLessThan(80)
  })

  it('trace.end() stamps ended_at at call time', async () => {
    const net = stubSlowFetch(120)
    const client = makeClient()
    const trace = client.startTrace({ name: 't' })

    void trace.end()
    await client.flush()

    const patch = net.find('PATCH', `/ingest/traces/${trace.traceId}`)
    const post = net.find('POST', '/ingest/traces')
    expect(msBetween(post?.body['started_at'], patch?.body['ended_at'])).toBeLessThan(80)
  })

  it('observe() resolves without waiting for the ingest round trips', async () => {
    const net = stubSlowFetch(150)
    const client = makeClient()
    const trace = client.startTrace({ name: 't' })

    const t0 = Date.now()
    const result = await observe(trace, { name: 'work' }, async () => 'answer')
    const elapsed = Date.now() - t0

    expect(result).toBe('answer')
    expect(elapsed).toBeLessThan(100)

    await client.flush()
    const patch = net.calls.find((c) => c.method === 'PATCH' && c.path.startsWith('/ingest/spans/'))
    expect(patch?.done).toBe(true)
    expect(patch?.body['output']).toBe('answer')
    expect(patch?.body['status']).toBe('completed')
  })

  it('observeOpenAI() resolves without waiting for the ingest round trips', async () => {
    const net = stubSlowFetch(150)
    const client = makeClient()
    const trace = client.startTrace({ name: 't' })

    const t0 = Date.now()
    await observeOpenAI(trace, 'call', async () => ({
      model: 'gpt-4o-mini',
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    }))
    expect(Date.now() - t0).toBeLessThan(100)

    await client.flush()
    const patch = net.calls.find((c) => c.method === 'PATCH' && c.path.startsWith('/ingest/spans/'))
    expect(patch?.done).toBe(true)
    expect(patch?.body['total_tokens']).toBe(3)
  })

  it('observe() error path rethrows immediately and still delivers the error PATCH', async () => {
    const net = stubSlowFetch(150)
    const client = makeClient()
    const trace = client.startTrace({ name: 't' })

    const t0 = Date.now()
    await expect(
      observe(trace, { name: 'boom' }, async () => {
        throw new Error('kaput')
      }),
    ).rejects.toThrow('kaput')
    expect(Date.now() - t0).toBeLessThan(100)

    await client.flush()
    const patch = net.calls.find((c) => c.method === 'PATCH' && c.path.startsWith('/ingest/spans/'))
    expect(patch?.done).toBe(true)
    expect(patch?.body['status']).toBe('error')
    expect(patch?.body['error_message']).toBe('kaput')
  })

  it('observe({ awaitIngest: true }) opts back into waiting for delivery', async () => {
    const net = stubSlowFetch(60)
    const client = makeClient()
    const trace = client.startTrace({ name: 't' })

    await observe(trace, { name: 'work', awaitIngest: true }, async () => 1)

    const patch = net.calls.find((c) => c.method === 'PATCH' && c.path.startsWith('/ingest/spans/'))
    expect(patch?.done).toBe(true)
  })

  it('a stalled ingest server under silent:false never surfaces as an unhandled rejection', async () => {
    stubSlowFetch(Infinity)
    const client = makeClient({ silent: false, timeoutMs: 30 })
    const trace = client.startTrace({ name: 't' })

    await expect(observe(trace, { name: 'work' }, async () => 'ok')).resolves.toBe('ok')
    await client.flush()
    // Give any stray rejection a chance to surface; vitest fails the run on one.
    await sleep(20)
  })
})

// ── Sampling: fire-and-forget span ends are still replayed on error ─────────

describe('sampled-out traces', () => {
  it('replays a span ended without await when the trace ends with an error', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const net = stubSlowFetch(5)
    const client = makeClient({ sampleRate: 0 })
    const trace = client.startTrace({ name: 't' })
    const span = trace.span({ name: 's' })

    void span.end({ totalTokens: 9 })
    await trace.end({ status: 'error', errorMessage: 'boom' })
    await client.flush()

    expect(net.done('PATCH', `/ingest/spans/${span.spanId}`)).toBe(true)
    expect(net.done('PATCH', `/ingest/traces/${trace.traceId}`)).toBe(true)
  })
})
