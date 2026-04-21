import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SpanlensClient } from '../client.js'
import { observe } from '../observe.js'

describe('SpanlensClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 201 }),
    )
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('throws when apiKey is missing', () => {
    expect(() => new SpanlensClient({ apiKey: '' })).toThrow(/apiKey is required/)
  })

  it('startTrace POSTs to /ingest/traces with Bearer token', async () => {
    const client = new SpanlensClient({ apiKey: 'sl_live_test', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 'test-trace', metadata: { foo: 'bar' } })

    expect(trace.traceId).toMatch(/^[0-9a-f-]{36}$/)
    expect(trace.name).toBe('test-trace')

    // fire-and-forget — wait a tick
    await new Promise((r) => setTimeout(r, 10))

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://x/ingest/traces')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer sl_live_test')

    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.name).toBe('test-trace')
    expect(body.id).toBe(trace.traceId)
    expect(body.metadata).toEqual({ foo: 'bar' })
  })

  it('trace.span creates span with POST /ingest/traces/:id/spans', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })
    const span = trace.span({ name: 'llm-call', spanType: 'llm', input: { q: 'hi' } })

    expect(span.spanId).toMatch(/^[0-9a-f-]{36}$/)
    expect(span.traceId).toBe(trace.traceId)
    expect(span.spanType).toBe('llm')

    await new Promise((r) => setTimeout(r, 10))

    // First call = trace POST, second = span POST
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toBe(`http://x/ingest/traces/${trace.traceId}/spans`)
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.span_type).toBe('llm')
    expect(body.input).toEqual({ q: 'hi' })
  })

  it('span.end PATCHes /ingest/spans/:id with tokens and cost', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })
    const span = trace.span({ name: 'llm' })

    await span.end({
      totalTokens: 150,
      promptTokens: 100,
      completionTokens: 50,
      costUsd: 0.0023,
      requestId: 'req-123',
    })

    const patchCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        typeof url === 'string' &&
        url.includes(`/ingest/spans/${span.spanId}`) &&
        (init as RequestInit).method === 'PATCH',
    )
    expect(patchCall).toBeDefined()
    const body = JSON.parse((patchCall![1] as RequestInit).body as string) as Record<string, unknown>
    expect(body.status).toBe('completed')
    expect(body.total_tokens).toBe(150)
    expect(body.cost_usd).toBe(0.0023)
    expect(body.request_id).toBe('req-123')
    expect(body.ended_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('span.end is idempotent', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const span = client.startTrace({ name: 't' }).span({ name: 's' })
    await span.end()
    await span.end()
    const patchCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit).method === 'PATCH',
    )
    expect(patchCalls.length).toBe(1)
  })

  it('span.child nests with parent_span_id', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })
    const parent = trace.span({ name: 'parent' })
    const child = parent.child({ name: 'child' })

    expect(child.parentSpanId).toBe(parent.spanId)

    await new Promise((r) => setTimeout(r, 10))
    const childPost = fetchMock.mock.calls.find(
      ([url, init]) =>
        typeof url === 'string' &&
        url.includes('/spans') &&
        (init as RequestInit).method === 'POST' &&
        JSON.parse((init as RequestInit).body as string).name === 'child',
    )
    expect(childPost).toBeDefined()
    const body = JSON.parse((childPost![1] as RequestInit).body as string) as Record<string, unknown>
    expect(body.parent_span_id).toBe(parent.spanId)
  })

  it('trace.end PATCHes /ingest/traces/:id', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })
    await trace.end({ status: 'completed' })

    const patchCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        typeof url === 'string' &&
        url === `http://x/ingest/traces/${trace.traceId}` &&
        (init as RequestInit).method === 'PATCH',
    )
    expect(patchCall).toBeDefined()
  })

  it('silently swallows network errors by default', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })

    // must not throw
    const trace = client.startTrace({ name: 'offline' })
    expect(trace.traceId).toBeDefined()
    await new Promise((r) => setTimeout(r, 10))
  })

  it('calls onError hook when provided', async () => {
    const onError = vi.fn()
    fetchMock.mockRejectedValueOnce(new Error('boom'))
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x', onError })
    client.startTrace({ name: 'x' })
    await new Promise((r) => setTimeout(r, 10))
    expect(onError).toHaveBeenCalled()
    const [err, ctx] = onError.mock.calls[0] as [Error, string]
    expect(err).toBeInstanceOf(Error)
    expect(ctx).toContain('POST /ingest/traces')
  })

  it('silent:false rethrows errors from awaited calls', async () => {
    // All fetch calls fail — both the background POST and the awaited PATCH
    fetchMock.mockRejectedValue(new Error('boom'))
    const client = new SpanlensClient({
      apiKey: 'k',
      baseUrl: 'http://x',
      silent: false,
    })
    const trace = client.startTrace({ name: 't' })
    // trace.end awaits transport.patch — with silent:false this rethrows
    await expect(trace.end()).rejects.toThrow()
  })
})

describe('observe()', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('runs fn and auto-ends span on success', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    const result = await observe(trace, { name: 'work', spanType: 'custom' }, async () => {
      return 42
    })

    expect(result).toBe(42)
  })

  it('marks span as error and rethrows on failure', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    await expect(
      observe(trace, { name: 'work' }, async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    // Check that a PATCH with status:error was sent
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    const errorPatch = fetchMock.mock.calls.find(([, init]) => {
      const ri = init as RequestInit | undefined
      if (!ri || ri.method !== 'PATCH') return false
      const body = JSON.parse(ri.body as string) as Record<string, unknown>
      return body.status === 'error'
    })
    expect(errorPatch).toBeDefined()
  })

  it('supports nested spans via SpanHandle.child', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    await observe(trace, { name: 'outer' }, async (outer) => {
      await observe(outer, { name: 'inner' }, async () => 'ok')
    })
  })
})
