import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, isApiError } from '../lib/errors.js'
import { requestId, type RequestIdContext } from '../middleware/requestId.js'

// Sentry side-effects must be mocked so a thrown unknown error does not
// attempt a real network capture during the test run.
vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
}))

/**
 * Mirror of the onError + requestId wiring in app.ts. Recreating it here
 * (rather than importing app.ts) keeps the test surface small and
 * decoupled from the dozens of router-level mocks app.ts would pull in.
 * If the wiring in app.ts changes shape, this test should change too.
 */
async function buildApp(): Promise<Hono<RequestIdContext>> {
  const { captureException } = await import('@sentry/node')
  const app = new Hono<RequestIdContext>()
  app.use('*', requestId)

  app.get('/throw-api-error', () => {
    throw new ApiError('PUBLIC_KEY_WRITE_FORBIDDEN')
  })
  app.get('/throw-api-error-with-details', () => {
    throw ApiError.from('VALIDATION_FAILED', { field: 'ttl' })
  })
  app.get('/throw-unknown', () => {
    throw new Error('database connection refused')
  })

  app.onError((err, c) => {
    const id = c.get('requestId') ?? null
    if (isApiError(err)) {
      return c.json(
        {
          error: {
            code: err.code,
            message: err.message,
            ...(err.details ? { details: err.details } : {}),
            requestId: id,
          },
        },
        err.status as ContentfulStatusCode,
      )
    }
    captureException(err, { tags: { request_id: id ?? 'unknown' } })
    return c.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Unexpected error', requestId: id } },
      500,
    )
  })

  return app
}

describe('global onError + requestId integration', () => {
  it('serialises ApiError to the standard envelope and echoes the requestId', async () => {
    const app = await buildApp()
    const res = await app.request('/throw-api-error')
    expect(res.status).toBe(403)
    const body = (await res.json()) as {
      error: { code: string; message: string; requestId: string }
    }
    expect(body.error.code).toBe('PUBLIC_KEY_WRITE_FORBIDDEN')
    expect(body.error.message).toMatch(/Public scope keys cannot/i)
    expect(body.error.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    // Same id surfaces in the response header so clients can correlate
    // without parsing the JSON body.
    expect(res.headers.get('X-Request-ID')).toBe(body.error.requestId)
  })

  it('includes details on the envelope when ApiError.from was used', async () => {
    const app = await buildApp()
    const res = await app.request('/throw-api-error-with-details')
    expect(res.status).toBe(400)
    const body = (await res.json()) as {
      error: { code: string; details?: Record<string, unknown> }
    }
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details).toEqual({ field: 'ttl' })
  })

  it('maps an unknown thrown error to a 500 INTERNAL_ERROR and captures to Sentry', async () => {
    const { captureException } = await import('@sentry/node')
    const app = await buildApp()
    const res = await app.request('/throw-unknown')
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: { code: string; requestId: string } }
    expect(body.error.code).toBe('INTERNAL_ERROR')
    expect(body.error.requestId).toBeTruthy()
    // The original error reached Sentry tagged with the same request id.
    expect(captureException).toHaveBeenCalledTimes(1)
    const [thrown, opts] = (captureException as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0] as [Error, { tags: { request_id: string } }]
    expect(thrown.message).toBe('database connection refused')
    expect(opts.tags.request_id).toBe(body.error.requestId)
  })

  it('preserves a client-supplied X-Request-ID through the error path', async () => {
    const app = await buildApp()
    const incoming = '018f5dcb-1234-7890-9abc-def012345678'
    const res = await app.request('/throw-api-error', {
      headers: { 'X-Request-ID': incoming },
    })
    const body = (await res.json()) as { error: { requestId: string } }
    expect(body.error.requestId).toBe(incoming)
    expect(res.headers.get('X-Request-ID')).toBe(incoming)
  })
})
