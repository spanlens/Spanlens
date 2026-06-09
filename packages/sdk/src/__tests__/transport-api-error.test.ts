import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTransport, SpanlensApiError } from '../transport.js'

/**
 * Notes on fetch mocking pattern:
 * - vi.spyOn(globalThis, 'fetch') does NOT intercept in Node test env
 *   because the SDK reaches the global fetch directly. Use vi.stubGlobal
 *   instead, matching the existing pattern in client.test.ts.
 * - vi.fn().mockImplementation returns a fresh Response per call so the
 *   body is readable on every call (a shared Response throws "body
 *   already used" on the second .text() and trips the retry path).
 */

/**
 * Sprint 7 R-15 + R-20 SDK contract: transport unwraps the server's
 * standard ApiErrorEnvelope into a typed SpanlensApiError when the
 * caller runs with silent=false. Backwards-compatible: if the server
 * (or an upstream proxy) returns a non-envelope 4xx body, the SDK falls
 * back to its previous generic Error path so existing handlers keep
 * working.
 */

const ENVELOPE_BODY = JSON.stringify({
  error: {
    code: 'PUBLIC_KEY_WRITE_FORBIDDEN',
    message: 'Public scope keys cannot use proxy, ingest, or OTLP endpoints',
    details: { scope: 'public' },
    requestId: '018f5dcb-1234-7890-9abc-def012345678',
  },
})

const GENERIC_400_BODY = '<html>nginx 400 from a CDN in front of Spanlens</html>'

describe('SDK transport: ApiErrorEnvelope unwrapping', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('throws SpanlensApiError with code, status, message, details, requestId when silent=false', async () => {
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(ENVELOPE_BODY, {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    const transport = createTransport({
      apiKey: 'sl_live_test',
      silent: false,
    })
    let thrown: unknown
    try {
      await transport.post('/ingest/events', { event_type: 'span' })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(SpanlensApiError)
    const typed = thrown as SpanlensApiError
    expect(typed.code).toBe('PUBLIC_KEY_WRITE_FORBIDDEN')
    expect(typed.status).toBe(403)
    expect(typed.message).toBe(
      'Public scope keys cannot use proxy, ingest, or OTLP endpoints',
    )
    expect(typed.details).toEqual({ scope: 'public' })
    expect(typed.requestId).toBe('018f5dcb-1234-7890-9abc-def012345678')
  })

  it('falls back to generic Error when the 4xx body is not the standard envelope', async () => {
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(GENERIC_400_BODY, {
          status: 400,
          headers: { 'content-type': 'text/html' },
        }),
      ),
    )
    const transport = createTransport({
      apiKey: 'sl_live_test',
      silent: false,
    })
    let thrown: unknown
    try {
      await transport.post('/ingest/events', {})
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).not.toBeInstanceOf(SpanlensApiError)
    const generic = thrown as Error
    expect(generic.message).toContain('400')
    expect(generic.message).toContain('nginx')
  })

  it('still swallows errors and returns null when silent=true (default), but invokes onError with the typed exception', async () => {
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(new Response(ENVELOPE_BODY, { status: 403 })),
    )
    const onError = vi.fn()
    const transport = createTransport({
      apiKey: 'sl_live_test',
      silent: true,
      onError,
    })
    const result = await transport.post('/ingest/events', {})
    expect(result).toBeNull()
    expect(onError).toHaveBeenCalledTimes(1)
    const [reportedErr] = onError.mock.calls[0] as [unknown, string]
    expect(reportedErr).toBeInstanceOf(SpanlensApiError)
    expect((reportedErr as SpanlensApiError).code).toBe('PUBLIC_KEY_WRITE_FORBIDDEN')
  })

  it('does NOT throw SpanlensApiError on 5xx (those go through retry path)', async () => {
    // Three failing 5xx responses (one per retry attempt) so the loop
    // exhausts and reports the final generic Error.
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(ENVELOPE_BODY, { status: 503 })),
    )
    const transport = createTransport({
      apiKey: 'sl_live_test',
      silent: false,
    })
    let thrown: unknown
    try {
      await transport.post('/ingest/events', {})
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(Error)
    // 5xx path keeps the generic Error shape so the retry/backoff
    // behaviour stays observable through a consistent message format.
    expect(thrown).not.toBeInstanceOf(SpanlensApiError)
  })
})
