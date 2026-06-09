import { describe, expect, test } from 'vitest'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { requireRole } from '../middleware/requireRole.js'
import type { JwtContext, OrgRole } from '../middleware/authJwt.js'
import { isApiError } from '../lib/errors.js'

// Build a minimal app that stubs authJwt by pre-setting role via header,
// then gates a handler with requireRole. This isolates the middleware under
// test from the real Supabase call without any mocking framework.
//
// Sprint 7 R-15 + R-20 update: requireRole now throws ApiError instead of
// returning c.json directly. Mount the same onError serialiser the real
// app.ts uses so the assertions still target the rendered HTTP response
// rather than an uncaught throw (which would surface as a 500).
function buildApp(allowed: OrgRole[]) {
  const app = new Hono<JwtContext>()
  app.use('*', async (c, next) => {
    const role = c.req.header('x-test-role') as OrgRole | null
    c.set('role', role ?? null)
    c.set('userId', 'u1')
    c.set('orgId', 'o1')
    return next()
  })
  app.post('/write', requireRole(...allowed), (c) => c.json({ ok: true }))
  app.onError((err, c) => {
    if (isApiError(err)) {
      return c.json(
        { error: { code: err.code, message: err.message } },
        err.status as ContentfulStatusCode,
      )
    }
    throw err
  })
  return app
}

describe('requireRole middleware', () => {
  test('passes when role is in allow list', async () => {
    const app = buildApp(['admin', 'editor'])
    const res = await app.request('/write', {
      method: 'POST',
      headers: { 'x-test-role': 'editor' },
    })
    expect(res.status).toBe(200)
  })

  test('rejects when role is below allow list (viewer on edit endpoint)', async () => {
    const app = buildApp(['admin', 'editor'])
    const res = await app.request('/write', {
      method: 'POST',
      headers: { 'x-test-role': 'viewer' },
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('FORBIDDEN')
    expect(body.error.message).toMatch(/Forbidden/)
  })

  test('rejects editor on admin-only endpoint', async () => {
    const app = buildApp(['admin'])
    const res = await app.request('/write', {
      method: 'POST',
      headers: { 'x-test-role': 'editor' },
    })
    expect(res.status).toBe(403)
  })

  test('rejects when role is missing (unjoined user)', async () => {
    const app = buildApp(['admin', 'editor', 'viewer'])
    const res = await app.request('/write', { method: 'POST' })
    expect(res.status).toBe(403)
  })

  test('admin passes admin-only gate', async () => {
    const app = buildApp(['admin'])
    const res = await app.request('/write', {
      method: 'POST',
      headers: { 'x-test-role': 'admin' },
    })
    expect(res.status).toBe(200)
  })
})
