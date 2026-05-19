import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SpanlensClient } from '../client.js'
import {
  makeBufferingTransport,
  shouldSample,
  validateSampleRate,
} from '../sampler.js'
import type { Transport } from '../transport.js'

// ─────────────────────────────────────────────────────────────────────────────
// P3.8 sampling tests.
//
// Three layers:
//   1. Pure helpers (validateSampleRate, shouldSample) — boundary + invalid
//      input semantics.
//   2. BufferingTransport — drop-by-default + flushBuffered preserves order
//      + buffer cap caps memory.
//   3. End-to-end via SpanlensClient — fetchMock observes whether ingest
//      traffic goes out for sampled-in / sampled-out / sampled-out+error
//      traces. This is the contract users care about.
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. Pure helpers ──────────────────────────────────────────────────────────

describe('validateSampleRate', () => {
  it('returns 1.0 when undefined / null (default = no sampling)', () => {
    expect(validateSampleRate(undefined)).toBe(1.0)
    expect(validateSampleRate(null)).toBe(1.0)
  })

  it('accepts valid numbers in [0, 1]', () => {
    expect(validateSampleRate(0)).toBe(0)
    expect(validateSampleRate(0.1)).toBe(0.1)
    expect(validateSampleRate(0.5)).toBe(0.5)
    expect(validateSampleRate(1)).toBe(1)
  })

  it('throws on out-of-range numbers', () => {
    expect(() => validateSampleRate(-0.1)).toThrow(/sampleRate must be a number in \[0, 1\]/)
    expect(() => validateSampleRate(1.5)).toThrow(/sampleRate must be a number/)
  })

  it('throws on non-number types (string / object / NaN)', () => {
    expect(() => validateSampleRate('0.5' as unknown)).toThrow()
    expect(() => validateSampleRate({} as unknown)).toThrow()
    expect(() => validateSampleRate(NaN)).toThrow()
  })
})

describe('shouldSample', () => {
  it('returns true for sampleRate=1 without calling rng', () => {
    const rng = vi.fn(() => 0.99)
    expect(shouldSample(1, rng)).toBe(true)
    expect(rng).not.toHaveBeenCalled()
  })

  it('returns false for sampleRate=0 without calling rng', () => {
    const rng = vi.fn(() => 0)
    expect(shouldSample(0, rng)).toBe(false)
    expect(rng).not.toHaveBeenCalled()
  })

  it('compares rng output against the rate (strict less-than)', () => {
    expect(shouldSample(0.5, () => 0.4)).toBe(true)
    expect(shouldSample(0.5, () => 0.6)).toBe(false)
    // Boundary — rng() === sampleRate should be DROP (rng is < check)
    expect(shouldSample(0.5, () => 0.5)).toBe(false)
  })

  it('over a large draw produces approximately the configured rate', () => {
    let seed = 0
    const rng = () => {
      // Linear congruential generator — deterministic, uniform [0,1).
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    let sampled = 0
    const N = 10_000
    for (let i = 0; i < N; i++) {
      if (shouldSample(0.1, rng)) sampled++
    }
    // 10% ± 2% absolute (loose bound for deterministic LCG).
    expect(sampled / N).toBeGreaterThan(0.08)
    expect(sampled / N).toBeLessThan(0.12)
  })
})

// ── 2. BufferingTransport ────────────────────────────────────────────────────

function makeFakeTransport(): Transport & { calls: Array<{ method: string; path: string; body: unknown }> } {
  const calls: Array<{ method: string; path: string; body: unknown }> = []
  return {
    calls,
    async post(path, body) { calls.push({ method: 'post', path, body }); return null },
    async patch(path, body) { calls.push({ method: 'patch', path, body }); return null },
    async flush() { /* no-op */ },
  }
}

describe('makeBufferingTransport', () => {
  it('does not forward POST/PATCH to the real transport when buffering', async () => {
    const real = makeFakeTransport()
    const buf = makeBufferingTransport(real)

    await buf.post('/p1', { a: 1 })
    await buf.patch('/p2', { b: 2 })

    expect(real.calls).toEqual([])
  })

  it('flushBuffered replays buffered ops in FIFO order on the real transport', async () => {
    const real = makeFakeTransport()
    const buf = makeBufferingTransport(real)

    await buf.post('/ingest/traces', { id: 't' })
    await buf.post('/ingest/traces/t/spans', { id: 's1' })
    await buf.patch('/ingest/spans/s1', { ended_at: 'x' })

    await buf.flushBuffered()

    expect(real.calls).toEqual([
      { method: 'post', path: '/ingest/traces', body: { id: 't' } },
      { method: 'post', path: '/ingest/traces/t/spans', body: { id: 's1' } },
      { method: 'patch', path: '/ingest/spans/s1', body: { ended_at: 'x' } },
    ])
  })

  it('caps the buffer to bound memory in long-running traces', async () => {
    const real = makeFakeTransport()
    const buf = makeBufferingTransport(real)

    // Push 2000 ops — first 1000 should buffer, rest dropped.
    for (let i = 0; i < 2000; i++) {
      await buf.post(`/p${i}`, { i })
    }
    await buf.flushBuffered()

    expect(real.calls.length).toBe(1000)
    expect(real.calls[0]).toMatchObject({ path: '/p0' })
    expect(real.calls[999]).toMatchObject({ path: '/p999' })
  })

  it('flush() delegates to the real transport', async () => {
    const flushSpy = vi.fn().mockResolvedValue(undefined)
    const real: Transport = {
      post: async () => null,
      patch: async () => null,
      flush: flushSpy,
    }
    const buf = makeBufferingTransport(real)
    await buf.flush()
    expect(flushSpy).toHaveBeenCalledOnce()
  })
})

// ── 3. End-to-end via SpanlensClient + fetchMock ─────────────────────────────

describe('SpanlensClient — sampling', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let mathRandomSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 201 })),
    )
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (mathRandomSpy) mathRandomSpy.mockRestore()
  })

  function pinRandom(value: number) {
    mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(value)
  }

  it('throws at construction when sampleRate is invalid', () => {
    expect(() => new SpanlensClient({ apiKey: 'k', sampleRate: -0.1 })).toThrow(
      /sampleRate must be a number in \[0, 1\]/,
    )
    expect(() => new SpanlensClient({ apiKey: 'k', sampleRate: 1.5 })).toThrow()
  })

  it('default sampleRate=1.0 → all traces ingested (back-compat)', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })
    const span = trace.span({ name: 's' })
    await span.end({ totalTokens: 10 })
    await trace.end({ status: 'completed' })

    const paths = fetchMock.mock.calls.map(([url]) => new URL(url as string).pathname)
    expect(paths).toContain('/ingest/traces')
    expect(paths.some((p) => p.endsWith('/spans'))).toBe(true)
    expect(paths).toContain(`/ingest/spans/${span.spanId}`)
    expect(paths).toContain(`/ingest/traces/${trace.traceId}`)
  })

  it('sampleRate=0 + status=completed → ZERO ingest traffic (full drop)', async () => {
    pinRandom(0.5)
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x', sampleRate: 0 })
    const trace = client.startTrace({ name: 't' })
    const span = trace.span({ name: 's' })
    await span.end({ totalTokens: 10 })
    await trace.end({ status: 'completed' })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sampleRate=0 + status=error → buffered ops replayed (tail-based bypass)', async () => {
    pinRandom(0.5)
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x', sampleRate: 0 })
    const trace = client.startTrace({ name: 't' })
    const span = trace.span({ name: 'llm', spanType: 'llm' })
    await span.end({ totalTokens: 42 })
    await trace.end({ status: 'error', errorMessage: 'boom' })

    // Expect the full sequence to land on the wire:
    //   POST /ingest/traces (creation, was buffered)
    //   POST /ingest/traces/:id/spans (creation, was buffered)
    //   PATCH /ingest/spans/:id (end, was buffered)
    //   PATCH /ingest/traces/:id (end, error — sent directly post-flush)
    const calls = fetchMock.mock.calls.map(([url, init]) => ({
      method: (init as RequestInit).method,
      path: new URL(url as string).pathname,
    }))
    expect(calls).toContainEqual({ method: 'POST', path: '/ingest/traces' })
    expect(calls).toContainEqual({ method: 'POST', path: `/ingest/traces/${trace.traceId}/spans` })
    expect(calls).toContainEqual({ method: 'PATCH', path: `/ingest/spans/${span.spanId}` })
    expect(calls).toContainEqual({ method: 'PATCH', path: `/ingest/traces/${trace.traceId}` })

    // The trace end PATCH must arrive AFTER the buffered span POST/PATCH
    // (preserves the same ordering invariants the server's ownership checks
    // rely on).
    const tracePatchIdx = calls.findIndex(
      (c) => c.method === 'PATCH' && c.path === `/ingest/traces/${trace.traceId}`,
    )
    const spanPostIdx = calls.findIndex(
      (c) => c.method === 'POST' && c.path === `/ingest/traces/${trace.traceId}/spans`,
    )
    expect(spanPostIdx).toBeLessThan(tracePatchIdx)
  })

  it('sampleRate=1.0 + status=error → identical to pre-P3.8 (no buffering)', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x', sampleRate: 1.0 })
    const trace = client.startTrace({ name: 't' })
    const span = trace.span({ name: 's' })
    await span.end()
    await trace.end({ status: 'error', errorMessage: 'x' })

    // Standard 4-call sequence — no replay needed because nothing was buffered.
    const methods = fetchMock.mock.calls.map(([, init]) => (init as RequestInit).method)
    expect(methods.filter((m) => m === 'POST').length).toBeGreaterThanOrEqual(2)
    expect(methods.filter((m) => m === 'PATCH').length).toBeGreaterThanOrEqual(2)
  })

  it('sampling decision is sticky across all spans in a trace', async () => {
    // First call to Math.random returns 0.5 (sampled out at rate=0.1).
    // Subsequent calls (if any leak into span paths) would be ignored, but the
    // decision should be locked in at startTrace().
    pinRandom(0.5)
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x', sampleRate: 0.1 })
    const trace = client.startTrace({ name: 't' })
    // Create many spans — none should hit the wire.
    for (let i = 0; i < 20; i++) {
      const s = trace.span({ name: `s${i}` })
      await s.end()
    }
    await trace.end({ status: 'completed' })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('separate traces get independent sampling decisions', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x', sampleRate: 0.5 })

    pinRandom(0.1) // sampled IN (0.1 < 0.5)
    const traceA = client.startTrace({ name: 'a' })

    if (mathRandomSpy) mathRandomSpy.mockRestore()
    pinRandom(0.9) // sampled OUT (0.9 < 0.5 is false)
    const traceB = client.startTrace({ name: 'b' })

    await traceA.end({ status: 'completed' })
    await traceB.end({ status: 'completed' })

    const paths = fetchMock.mock.calls.map(([url]) => new URL(url as string).pathname)
    // A's POST + PATCH should be present; B's should not.
    expect(paths).toContain('/ingest/traces')
    expect(paths).toContain(`/ingest/traces/${traceA.traceId}`)
    expect(paths).not.toContain(`/ingest/traces/${traceB.traceId}`)
  })
})
