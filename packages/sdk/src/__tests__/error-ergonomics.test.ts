import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import {
  createTransport,
  SpanlensApiError,
  SpanlensTransportError,
} from '../transport.js'
import { SpanlensClient, _resetKeyFormatWarningsForTests } from '../client.js'

/**
 * UX-retention batch 2: actionable SDK errors + observability of drops.
 *
 * Covers three things:
 * 1. The transport emits a deduped, grep-friendly `[spanlens]` console.warn
 *    with actionable guidance for the common integration failures
 *    (401 bad key, 403 public key on a write endpoint, 429 quota).
 * 2. onError fires on every dropped delivery even in silent mode, with a
 *    typed SpanlensTransportError (status, code, message, endpoint).
 * 3. SpanlensClient warns at construction when the apiKey prefix cannot
 *    work for ingest, without ever printing the key itself.
 *
 * fetch mocking follows the transport-api-error.test.ts pattern:
 * vi.stubGlobal + a fresh Response per call.
 */

function envelope(code: string, message: string): string {
  return JSON.stringify({ error: { code, message, requestId: null } })
}

describe('transport: actionable error messages (silent mode)', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let warnSpy: MockInstance

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('401: warns once with the three checks and the quick-start link, never throws', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(envelope('UNAUTHORIZED', 'Invalid API key'), { status: 401 }),
      ),
    )
    const onError = vi.fn()
    const transport = createTransport({ apiKey: 'sl_live_test', onError })

    const result = await transport.post('/ingest/traces', { name: 't' })
    expect(result).toBeNull() // silent default: user code never crashes

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const msg = warnSpy.mock.calls[0]?.[0] as string
    expect(msg).toContain('[spanlens]')
    expect(msg).toContain('401')
    expect(msg).toContain('SPANLENS_API_KEY')
    expect(msg).toContain('revoked')
    expect(msg).toContain('whitespace')
    expect(msg).toContain('https://www.spanlens.io/docs/quick-start')

    // Deduped: a second failing call does not warn again...
    await transport.post('/ingest/traces', { name: 't2' })
    expect(warnSpy).toHaveBeenCalledTimes(1)
    // ...but onError still fires once per dropped delivery.
    expect(onError).toHaveBeenCalledTimes(2)
  })

  it('401: onError receives a typed error with status, code, message, endpoint', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(envelope('UNAUTHORIZED', 'Invalid API key'), { status: 401 }),
      ),
    )
    const onError = vi.fn()
    const transport = createTransport({ apiKey: 'sl_live_test', onError })
    await transport.post('/ingest/traces', {})

    const [err, ctx] = onError.mock.calls[0] as [unknown, string]
    expect(err).toBeInstanceOf(SpanlensTransportError)
    expect(err).toBeInstanceOf(SpanlensApiError)
    const typed = err as SpanlensApiError
    expect(typed.status).toBe(401)
    expect(typed.code).toBe('UNAUTHORIZED')
    expect(typed.message).toBe('Invalid API key')
    expect(typed.endpoint).toBe('POST /ingest/traces')
    expect(ctx).toBe('POST /ingest/traces')
  })

  it('401 without the standard envelope still warns and yields a SpanlensTransportError', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response('unauthorized', { status: 401 })),
    )
    const onError = vi.fn()
    const transport = createTransport({ apiKey: 'sl_live_test', onError })
    await transport.post('/ingest/traces', {})

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0] as string).toContain('SPANLENS_API_KEY')

    const [err] = onError.mock.calls[0] as [unknown, string]
    expect(err).toBeInstanceOf(SpanlensTransportError)
    expect(err).not.toBeInstanceOf(SpanlensApiError)
    const typed = err as SpanlensTransportError
    expect(typed.status).toBe(401)
    expect(typed.code).toBe('HTTP_401')
    expect(typed.endpoint).toBe('POST /ingest/traces')
  })

  it('403 PUBLIC_KEY_WRITE_FORBIDDEN: explains public keys are read-only, links docs', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(
          envelope(
            'PUBLIC_KEY_WRITE_FORBIDDEN',
            'Public scope keys cannot use proxy, ingest, or OTLP endpoints',
          ),
          { status: 403 },
        ),
      ),
    )
    const onError = vi.fn()
    const transport = createTransport({ apiKey: 'sl_live_pub_x', onError })
    await transport.post('/ingest/events', {})

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const msg = warnSpy.mock.calls[0]?.[0] as string
    expect(msg).toContain('PUBLIC_KEY_WRITE_FORBIDDEN')
    expect(msg).toContain('read-only')
    expect(msg).toContain('sl_live_')
    expect(msg).toContain('https://www.spanlens.io/docs/quick-start')

    const [err] = onError.mock.calls[0] as [unknown, string]
    expect((err as SpanlensApiError).code).toBe('PUBLIC_KEY_WRITE_FORBIDDEN')
    expect((err as SpanlensApiError).status).toBe(403)
  })

  it('plain 403 FORBIDDEN (not public-key) does not emit the public-key hint', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(envelope('FORBIDDEN', 'Forbidden'), { status: 403 })),
    )
    const transport = createTransport({ apiKey: 'sl_live_test' })
    await transport.post('/ingest/events', {})
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('429 RATE_LIMIT: says quota or rate limit was hit and links pricing + billing', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(envelope('RATE_LIMIT', 'Monthly request quota exceeded'), {
          status: 429,
        }),
      ),
    )
    const onError = vi.fn()
    const transport = createTransport({ apiKey: 'sl_live_test', onError })
    const result = await transport.post('/ingest/traces', {})
    expect(result).toBeNull()

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const msg = warnSpy.mock.calls[0]?.[0] as string
    expect(msg).toContain('429')
    expect(msg.toLowerCase()).toContain('quota')
    expect(msg).toContain('https://www.spanlens.io/pricing')
    expect(msg).toContain('https://www.spanlens.io/billing')

    const [err] = onError.mock.calls[0] as [unknown, string]
    expect(err).toBeInstanceOf(SpanlensApiError)
    expect((err as SpanlensApiError).status).toBe(429)
    expect((err as SpanlensApiError).code).toBe('RATE_LIMIT')
    expect((err as SpanlensApiError).endpoint).toBe('POST /ingest/traces')
  })

  it('silent:false throws the same typed error it reported to onError', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(envelope('UNAUTHORIZED', 'Invalid API key'), { status: 401 }),
      ),
    )
    const onError = vi.fn()
    const transport = createTransport({
      apiKey: 'sl_live_test',
      silent: false,
      onError,
    })
    let thrown: unknown
    try {
      await transport.post('/ingest/traces', {})
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(SpanlensTransportError)
    expect(onError.mock.calls[0]?.[0]).toBe(thrown)
  })

  it('network errors in silent mode keep the raw error in onError (unchanged behavior)', async () => {
    const boom = new TypeError('fetch failed')
    fetchMock.mockImplementation(() => Promise.reject(boom))
    const onError = vi.fn()
    const transport = createTransport({ apiKey: 'sl_live_test', onError })
    const result = await transport.post('/ingest/traces', {})
    expect(result).toBeNull()
    // Retried 3 times, onError fires on each occurrence, raw error passthrough.
    expect(onError).toHaveBeenCalledTimes(3)
    expect(onError.mock.calls[0]?.[0]).toBe(boom)
    // No actionable console hint for network failures.
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

describe('SpanlensClient: apiKey format warnings at construction', () => {
  let warnSpy: MockInstance

  beforeEach(() => {
    _resetKeyFormatWarningsForTests()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(new Response('{}', { status: 200 })),
      ),
    )
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('warns once for a public key (sl_live_pub_*) and never prints the key body', () => {
    new SpanlensClient({ apiKey: 'sl_live_pub_abc123def456' })
    expect(warnSpy).toHaveBeenCalledTimes(1)
    const msg = warnSpy.mock.calls[0]?.[0] as string
    expect(msg).toContain('[spanlens]')
    expect(msg).toContain('read-only')
    expect(msg).toContain('403')
    expect(msg).toContain('PUBLIC_KEY_WRITE_FORBIDDEN')
    expect(msg).not.toContain('abc123def456')

    // Once per process: a second client does not warn again.
    new SpanlensClient({ apiKey: 'sl_live_pub_abc123def456' })
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('warns once when the key does not look like a Spanlens key, without echoing the value', () => {
    new SpanlensClient({ apiKey: 'sk-proj-supersecretvalue' })
    expect(warnSpy).toHaveBeenCalledTimes(1)
    const msg = warnSpy.mock.calls[0]?.[0] as string
    expect(msg).toContain('does not look like a Spanlens key')
    expect(msg).toContain('sl_live_')
    // Nothing derived from the key value appears in the log, not even a
    // masked prefix (CodeQL js/clear-text-logging flags any tainted substring).
    expect(msg).not.toContain('sk-pr')
    expect(msg).not.toContain('supersecretvalue')

    new SpanlensClient({ apiKey: 'sk-proj-supersecretvalue' })
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('never echoes short keys either', () => {
    new SpanlensClient({ apiKey: 'abcdefg' })
    const msg = warnSpy.mock.calls[0]?.[0] as string
    expect(msg).toContain('does not look like a Spanlens key')
    expect(msg).not.toContain('abcdefg')
  })

  it('does not warn for a normal full key', () => {
    new SpanlensClient({ apiKey: 'sl_live_0123456789abcdef' })
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
