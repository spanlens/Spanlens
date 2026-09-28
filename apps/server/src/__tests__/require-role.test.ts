import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Hono } from 'hono'
import type { JwtContext, OrgRole } from '../middleware/authJwt.js'
import { installOnError } from './helpers/install-on-error.js'

// requireRole trusts the (possibly cached) role from authJwt for reads, but
// re-reads org_members for writes. The tests stub authJwt by pre-setting the
// context from headers, and stub the org_members lookup with the real
// supabase-js contract: failures RESOLVE with `{ data: null, error }`.

const membership = vi.hoisted(() => ({
  // Role currently stored in org_members for (o1, u1). null = not a member.
  role: null as string | null,
  // When set, the lookup resolves with this error instead of data.
  error: null as { message: string } | null,
  lookups: 0,
}))

vi.mock('../lib/db.js', () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => {
      membership.lookups += 1
      if (membership.error) return { data: null, error: membership.error }
      return { data: membership.role ? { role: membership.role } : null, error: null }
    },
  }
  return { supabaseAdmin: { from: () => chain } }
})

const { requireRole } = await import('../middleware/requireRole.js')

function buildApp(allowed: OrgRole[]) {
  const app = new Hono<JwtContext>()
  app.use('*', async (c, next) => {
    const role = c.req.header('x-test-role') as OrgRole | undefined
    c.set('role', role ?? null)
    if (c.req.header('x-test-no-user') !== '1') c.set('userId', 'u1')
    c.set('orgId', 'o1')
    return next()
  })
  app.post('/write', requireRole(...allowed), (c) => c.json({ ok: true, role: c.get('role') }))
  app.patch('/write', requireRole(...allowed), (c) => c.json({ ok: true, role: c.get('role') }))
  app.get('/read', requireRole(...allowed), (c) => c.json({ ok: true, role: c.get('role') }))
  installOnError(app)
  return app
}

/** Cached role (from the stubbed authJwt) and DB role agree. */
function request(app: Hono<JwtContext>, role: OrgRole | null, method = 'POST', path = '/write') {
  membership.role = role
  return app.request(path, {
    method,
    headers: role ? { 'x-test-role': role } : {},
  })
}

beforeEach(() => {
  membership.role = null
  membership.error = null
  membership.lookups = 0
})

describe('requireRole middleware: allow list', () => {
  test('passes when role is in allow list', async () => {
    const res = await request(buildApp(['admin', 'editor']), 'editor')
    expect(res.status).toBe(200)
  })

  test('rejects when role is below allow list (viewer on edit endpoint)', async () => {
    const res = await request(buildApp(['admin', 'editor']), 'viewer')
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('FORBIDDEN')
    expect(body.error.message).toMatch(/Forbidden/)
  })

  test('rejects editor on admin-only endpoint', async () => {
    const res = await request(buildApp(['admin']), 'editor')
    expect(res.status).toBe(403)
  })

  test('rejects when role is missing (unjoined user)', async () => {
    const res = await request(buildApp(['admin', 'editor', 'viewer']), null)
    expect(res.status).toBe(403)
  })

  test('admin passes admin-only gate', async () => {
    const res = await request(buildApp(['admin']), 'admin')
    expect(res.status).toBe(200)
  })
})

describe('requireRole middleware: writes re-verify against org_members', () => {
  test('cached admin who was demoted in the DB is rejected on a write', async () => {
    membership.role = 'viewer'
    const res = await buildApp(['admin']).request('/write', {
      method: 'PATCH',
      headers: { 'x-test-role': 'admin' },
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { details: { actual: string | null } } }
    expect(body.error.details.actual).toBe('viewer')
    expect(membership.lookups).toBe(1)
  })

  test('cached admin who was removed from the org is rejected on a write', async () => {
    membership.role = null
    const res = await buildApp(['admin']).request('/write', {
      method: 'POST',
      headers: { 'x-test-role': 'admin' },
    })
    expect(res.status).toBe(403)
  })

  test('cached viewer who was promoted in the DB can write, and the handler sees the fresh role', async () => {
    membership.role = 'admin'
    const res = await buildApp(['admin']).request('/write', {
      method: 'POST',
      headers: { 'x-test-role': 'viewer' },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, role: 'admin' })
  })

  test('a failed membership lookup fails closed with 500, not a pass', async () => {
    membership.error = { message: 'connection reset' }
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const res = await buildApp(['admin']).request('/write', {
      method: 'POST',
      headers: { 'x-test-role': 'admin' },
    })
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('INTERNAL_ERROR')
    errSpy.mockRestore()
  })

  test('no user in context (API-key path) is rejected without a DB lookup', async () => {
    const res = await buildApp(['admin']).request('/write', {
      method: 'POST',
      headers: { 'x-test-role': 'admin', 'x-test-no-user': '1' },
    })
    expect(res.status).toBe(403)
    expect(membership.lookups).toBe(0)
  })
})

describe('requireRole middleware: reads keep using the cached role', () => {
  test('GET does not hit org_members', async () => {
    membership.role = 'viewer'
    const res = await buildApp(['admin']).request('/read', {
      method: 'GET',
      headers: { 'x-test-role': 'admin' },
    })
    expect(res.status).toBe(200)
    expect(membership.lookups).toBe(0)
  })
})
