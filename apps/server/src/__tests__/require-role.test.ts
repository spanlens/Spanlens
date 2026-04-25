import { describe, expect, test } from 'vitest'
import { Hono } from 'hono'
import { requireRole } from '../middleware/requireRole.js'
import type { JwtContext, OrgRole } from '../middleware/authJwt.js'

// Build a minimal app that stubs authJwt by pre-setting role via header,
// then gates a handler with requireRole. This isolates the middleware under
// test from the real Supabase call without any mocking framework.
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
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Insufficient permission')
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
