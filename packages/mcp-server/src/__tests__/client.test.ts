import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SpanlensApiError, SpanlensClient } from '../client.js'

/**
 * Sanity tests for the REST client wrapper. These mock `fetch` globally so we
 * don't need a live Spanlens server — the goal is to lock down the envelope
 * unwrapping and error mapping, since both are the contract the MCP tools
 * rely on.
 */
describe('SpanlensClient', () => {
  const origFetch = globalThis.fetch
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })
  afterEach(() => {
    globalThis.fetch = origFetch
  })

  test('rejects empty apiKey at construction', () => {
    expect(() => new SpanlensClient({ apiKey: '' })).toThrow(/required/i)
    expect(() => new SpanlensClient({ apiKey: '   ' })).toThrow(/required/i)
  })

  test('get() unwraps the envelope data on success', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: { hello: 'world' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const client = new SpanlensClient({ apiKey: 'sl_live_pub_test1234567890ab' })
    const out = await client.get<{ hello: string }>('/api/v1/stats/overview')
    expect(out).toEqual({ hello: 'world' })

    // Verify Authorization header + URL composition.
    const url = fetchMock.mock.calls[0]?.[0] as string
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(url).toBe('https://server.spanlens.io/api/v1/stats/overview')
    expect(
      (init.headers as Record<string, string>)['Authorization'],
    ).toBe('Bearer sl_live_pub_test1234567890ab')
  })

  test('get() encodes query params, dropping undefined/null/empty', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }),
    )
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://localhost:3001' })
    await client.get('/api/v1/requests', {
      limit: 20,
      model: 'gpt-4o',
      provider: undefined,
      status: '',
    })
    const url = fetchMock.mock.calls[0]?.[0] as string
    expect(url).toContain('limit=20')
    expect(url).toContain('model=gpt-4o')
    expect(url).not.toContain('provider=')
    expect(url).not.toContain('status=')
  })

  test('get() throws SpanlensApiError with code on non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: 'Public API key cannot perform writes', code: 'PUBLIC_KEY_WRITE_FORBIDDEN' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      ),
    )
    const client = new SpanlensClient({ apiKey: 'k' })
    await expect(client.get('/x')).rejects.toMatchObject({
      name: 'SpanlensApiError',
      status: 403,
      code: 'PUBLIC_KEY_WRITE_FORBIDDEN',
    })
  })

  test('keyInfo() hits /api/v1/me/key-info', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: { projectId: null, projectName: null, providers: [], scope: 'public' },
        }),
        { status: 200 },
      ),
    )
    const client = new SpanlensClient({ apiKey: 'k' })
    const info = await client.keyInfo()
    expect(info.scope).toBe('public')
    expect((fetchMock.mock.calls[0]?.[0] as string)).toContain('/api/v1/me/key-info')
  })

  test('SpanlensApiError carries status + code', () => {
    const err = new SpanlensApiError('nope', 401, 'BAD_KEY')
    expect(err.name).toBe('SpanlensApiError')
    expect(err.status).toBe(401)
    expect(err.code).toBe('BAD_KEY')
  })
})
