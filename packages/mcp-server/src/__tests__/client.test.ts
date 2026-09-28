import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SpanlensApiError, SpanlensClient, describeError } from '../client.js'

/**
 * Build an error response exactly the way apps/server/src/app.ts `onError`
 * serialises a thrown ApiError:
 *
 *   { error: { code, message, ...(details ? { details } : {}), requestId } }
 *
 * `requestId` is always present (null only when the requestId middleware
 * did not run). Keep this in sync with that handler: the v0.2.1 client
 * cast `error` to a string and turned every failure into "[object Object]",
 * and the flat-shape mock this file used back then hid it (C17.3).
 */
function serverErrorResponse(
  status: number,
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
    requestId: string | null
  },
): Response {
  const { details, ...rest } = error
  const body = {
    error: {
      code: rest.code,
      message: rest.message,
      ...(details ? { details } : {}),
      requestId: rest.requestId,
    },
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

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
    expect(url).toBe('https://api.spanlens.io/api/v1/stats/overview')
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

  describe('error envelope parsing', () => {
    const REQUEST_ID = '0b9c2f4e-6a1d-4c3b-9e8f-7a6b5c4d3e2f'

    test('current server shape: message, code and requestId survive (C17.3)', async () => {
      // What authApiKey throws for an unknown key, serialised by app.ts onError.
      fetchMock.mockResolvedValueOnce(
        serverErrorResponse(401, { code: 'UNAUTHORIZED', message: 'Invalid API key', requestId: REQUEST_ID }),
      )
      const client = new SpanlensClient({ apiKey: 'k' })
      const err = await client.get('/api/v1/me/key-info').catch((e: unknown) => e)

      expect(err).toBeInstanceOf(SpanlensApiError)
      expect(err).toMatchObject({
        name: 'SpanlensApiError',
        message: 'Invalid API key',
        status: 401,
        code: 'UNAUTHORIZED',
        requestId: REQUEST_ID,
      })
      expect((err as Error).message).not.toContain('[object Object]')
    })

    test('current server shape: details are preserved (rate limit)', async () => {
      fetchMock.mockResolvedValueOnce(
        serverErrorResponse(429, {
          code: 'RATE_LIMIT',
          message: 'API rate limit exceeded: 300 requests/min. Retry after 60 seconds.',
          details: { limit: 300, window: '60s' },
          requestId: REQUEST_ID,
        }),
      )
      const client = new SpanlensClient({ apiKey: 'k' })
      await expect(client.get('/api/v1/stats/models')).rejects.toMatchObject({
        status: 429,
        code: 'RATE_LIMIT',
        details: { limit: 300, window: '60s' },
        requestId: REQUEST_ID,
      })
    })

    test('current server shape: a null requestId stays null', async () => {
      fetchMock.mockResolvedValueOnce(
        serverErrorResponse(500, { code: 'INTERNAL_ERROR', message: 'Unexpected error', requestId: null }),
      )
      const client = new SpanlensClient({ apiKey: 'k' })
      await expect(client.get('/api/v1/traces')).rejects.toMatchObject({
        message: 'Unexpected error',
        status: 500,
        code: 'INTERNAL_ERROR',
        requestId: null,
      })
    })

    test('legacy flat shape { error: string, code } still parses', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: 'Public API key cannot perform writes', code: 'PUBLIC_KEY_WRITE_FORBIDDEN' }),
          { status: 403, headers: { 'content-type': 'application/json' } },
        ),
      )
      const client = new SpanlensClient({ apiKey: 'k' })
      await expect(client.get('/x')).rejects.toMatchObject({
        name: 'SpanlensApiError',
        message: 'Public API key cannot perform writes',
        status: 403,
        code: 'PUBLIC_KEY_WRITE_FORBIDDEN',
        requestId: null,
      })
    })

    test('JSON body with no recognisable error falls back to the status', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ unexpected: true }), { status: 404 }),
      )
      const client = new SpanlensClient({ apiKey: 'k' })
      await expect(client.get('/x')).rejects.toMatchObject({
        message: 'Spanlens API 404',
        status: 404,
        code: undefined,
        requestId: null,
      })
    })

    test('non-JSON body keeps the status in the message', async () => {
      fetchMock.mockResolvedValueOnce(new Response('<html>Bad Gateway</html>', { status: 502 }))
      const client = new SpanlensClient({ apiKey: 'k' })
      await expect(client.get('/x')).rejects.toMatchObject({
        message: 'Spanlens API 502 (response not JSON)',
        status: 502,
      })
    })

    test('2xx with success=false uses the envelope message, not [object Object]', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Trace not found', requestId: REQUEST_ID } }),
          { status: 200 },
        ),
      )
      const client = new SpanlensClient({ apiKey: 'k' })
      await expect(client.get('/x')).rejects.toMatchObject({
        message: 'Trace not found',
        code: 'NOT_FOUND',
        requestId: REQUEST_ID,
      })
    })
  })

  describe('describeError', () => {
    test('names status, code and requestId for API errors', () => {
      const err = new SpanlensApiError('Invalid API key', 401, 'UNAUTHORIZED', { requestId: 'req-1' })
      expect(describeError(err)).toBe('Invalid API key (HTTP 401, UNAUTHORIZED, requestId req-1)')
    })

    test('omits what the server did not send', () => {
      expect(describeError(new SpanlensApiError('Spanlens API 404', 404))).toBe('Spanlens API 404 (HTTP 404)')
    })

    test('falls back to the plain message for other errors', () => {
      expect(describeError(new Error('boom'))).toBe('boom')
      expect(describeError('raw')).toBe('raw')
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
