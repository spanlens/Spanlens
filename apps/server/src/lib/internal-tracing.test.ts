import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// We isolate the module under test so we can flip `process.env` and
// re-import to exercise both the "disabled" and "enabled" branches in
// the same test file. Vitest's `vi.resetModules()` makes that cheap.

describe('internal-tracing — disabled (no env)', () => {
  beforeEach(() => {
    delete process.env['SPANLENS_INTERNAL_BASE_URL']
    delete process.env['SPANLENS_INTERNAL_API_KEY']
    vi.resetModules()
  })

  it('startInternalTrace returns a stub handle that does not throw', async () => {
    const mod = await import('./internal-tracing.js')
    const trace = mod.startInternalTrace('foo')
    expect(trace).toBeDefined()
    expect(await trace.creationPromise).toBeNull()
    trace.end() // no-op
  })

  it('startSpan on a disabled trace also stubs', async () => {
    const mod = await import('./internal-tracing.js')
    const trace = mod.startInternalTrace('foo')
    const span = trace.startSpan('judge', { spanType: 'llm' })
    expect(await span.creationPromise).toBeNull()
    span.end({ status: 'completed' })
  })

  it('internalTracingEnabled() returns false', async () => {
    const mod = await import('./internal-tracing.js')
    expect(mod.internalTracingEnabled()).toBe(false)
  })
})

describe('internal-tracing — enabled (env present)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    process.env['SPANLENS_INTERNAL_BASE_URL'] = 'https://example.test'
    process.env['SPANLENS_INTERNAL_API_KEY'] = 'sl_live_test'
    fetchMock = vi.fn()
    // The lib reads `fetch` from the global scope; vi.stubGlobal makes
    // the swap testable and unwinds automatically in afterEach.
    vi.stubGlobal('fetch', fetchMock)
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env['SPANLENS_INTERNAL_BASE_URL']
    delete process.env['SPANLENS_INTERNAL_API_KEY']
  })

  it('POSTs to /ingest/traces with the right shape', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: { id: 'trc_1' } }), { status: 201 }),
    )
    const mod = await import('./internal-tracing.js')
    const trace = mod.startInternalTrace('eval_run', { evaluator_id: 'evl_1' })
    const id = await trace.creationPromise
    expect(id).toBe('trc_1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const call = fetchMock.mock.calls[0]
    if (!call) throw new Error('fetch was not called')
    const [url, init] = call as [string, RequestInit]
    expect(url).toBe('https://example.test/ingest/traces')
    const initHeaders = init.headers as Record<string, string>
    expect(initHeaders['Authorization']).toBe('Bearer sl_live_test')
    const body = JSON.parse(init.body as string)
    expect(body.name).toBe('eval_run')
    expect(body.metadata).toEqual({ evaluator_id: 'evl_1' })
    expect(typeof body.started_at).toBe('string')
  })

  it('returns null id when the POST fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }))
    const mod = await import('./internal-tracing.js')
    const trace = mod.startInternalTrace('eval_run')
    expect(await trace.creationPromise).toBeNull()
  })

  it('returns null id when fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'))
    const mod = await import('./internal-tracing.js')
    const trace = mod.startInternalTrace('eval_run')
    expect(await trace.creationPromise).toBeNull()
  })

  it('chains span creation behind trace creation', async () => {
    let resolveTrace!: (v: Response) => void
    const traceCreate = new Promise<Response>((resolve) => { resolveTrace = resolve })
    fetchMock
      .mockImplementationOnce(() => traceCreate)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { id: 'spn_1' } }), { status: 201 }),
      )

    const mod = await import('./internal-tracing.js')
    const trace = mod.startInternalTrace('t')
    const span = trace.startSpan('s', { spanType: 'llm' })

    // Resolve the trace POST only after we've kicked off span creation.
    // This proves span POST waits on the trace id rather than racing.
    resolveTrace(
      new Response(JSON.stringify({ success: true, data: { id: 'trc_1' } }), { status: 201 }),
    )

    const spanId = await span.creationPromise
    expect(spanId).toBe('spn_1')

    // Two POSTs total — trace then span.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const spanCall = fetchMock.mock.calls[1]
    if (!spanCall) throw new Error('span fetch not called')
    const [spanUrl, spanInit] = spanCall as [string, RequestInit]
    expect(spanUrl).toBe('https://example.test/ingest/traces/trc_1/spans')
    const spanBody = JSON.parse(spanInit.body as string)
    expect(spanBody.name).toBe('s')
    expect(spanBody.span_type).toBe('llm')
  })

  it('end() PATCHes the trace once creation resolves', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: { id: 'trc_42' } }), { status: 201 }),
    )
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }))

    const mod = await import('./internal-tracing.js')
    const trace = mod.startInternalTrace('t')
    await trace.creationPromise // ensure trace POST settles
    trace.end({ status: 'completed', metadata: { ok: true } })

    // Give the background end() PATCH a tick to fire.
    await new Promise((r) => setTimeout(r, 5))

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const endCall = fetchMock.mock.calls[1]
    if (!endCall) throw new Error('end PATCH not called')
    const [url, init] = endCall as [string, RequestInit]
    expect(url).toBe('https://example.test/ingest/traces/trc_42')
    expect(init.method).toBe('PATCH')
    const body = JSON.parse(init.body as string)
    expect(body.status).toBe('completed')
    expect(body.ended_at).toBeTypeOf('string')
    expect(body.metadata).toEqual({ ok: true })
  })

  it('does NOT throw when end() called after a failed creation', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }))
    const mod = await import('./internal-tracing.js')
    const trace = mod.startInternalTrace('t')
    expect(() => trace.end({ status: 'error', errorMessage: 'boom' })).not.toThrow()
    // No PATCH should be sent because creation returned null.
    await new Promise((r) => setTimeout(r, 5))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
