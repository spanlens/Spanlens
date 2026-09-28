import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Hono } from 'hono'
import type { JwtContext } from '../middleware/authJwt.js'
import type { InMemoryDb } from './helpers/in-memory-supabase.js'
import { installOnError } from './helpers/install-on-error.js'

/**
 * Regression tests for the authJwt 60s process-local cache going stale
 * (XVERIFY 2026-09-28, C1.1 + C1.2).
 *
 *   C1.1  A brand-new user's "no membership yet" result was cached like any
 *         other entry, and bootstrap's own authJwt pass re-cached it right
 *         before the membership INSERT. /organizations/me then answered 404
 *         for up to 60s after the workspace was created.
 *
 *   C1.2  requireRole only read the cached role, so a demoted or removed
 *         admin kept admin WRITE access for up to 60s. Inside that window
 *         they could re-promote themselves and keep admin forever.
 *
 * Everything below runs the real authJwt, requireRole, organizationsRouter
 * and membersRouter over an in-memory supabase fake, with Date faked so the
 * cache TTL is driven explicitly.
 */

const users = vi.hoisted(
  () => new Map<string, { id: string; email: string }>(),
)

vi.mock('../lib/db.js', async () => {
  const { createInMemoryDb } = await import('./helpers/in-memory-supabase.js')
  const db = createInMemoryDb()
  return {
    __db: db,
    supabaseAdmin: {
      from: (table: string) => db.from(table),
      auth: { admin: { listUsers: async () => ({ data: { users: [] } }) } },
    },
    supabaseClient: {
      auth: {
        getUser: async (token: string) => {
          const user = users.get(token)
          return user
            ? { data: { user }, error: null }
            : { data: { user: null }, error: { message: 'invalid token' } }
        },
      },
    },
  }
})

vi.mock('../lib/audit-log.js', () => ({
  recordAuditEvent: vi.fn(async () => true),
}))

const dbModule = (await import('../lib/db.js')) as unknown as { __db: InMemoryDb }
const db = dbModule.__db
const { _clearAuthCacheForTests } = await import('../middleware/authJwt.js')
const { organizationsRouter } = await import('../api/organizations.js')
const { membersRouter } = await import('../api/members.js')

const T0 = new Date('2026-09-28T00:00:00.000Z').getTime()

function at(offsetMs: number): void {
  vi.setSystemTime(T0 + offsetMs)
}

function buildApp() {
  const app = new Hono<JwtContext>()
  app.route('/api/v1/organizations/:orgId/members', membersRouter)
  app.route('/api/v1/organizations', organizationsRouter)
  installOnError(app)
  return app
}

function call(
  token: string,
  method: string,
  path: string,
  body?: unknown,
  cookie?: string,
): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (cookie) headers['cookie'] = cookie
  return Promise.resolve(
    buildApp().request(`/api/v1${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  )
}

function roleOf(orgId: string, userId: string): unknown {
  return (db.tables['org_members'] ?? []).find(
    (m) => m['organization_id'] === orgId && m['user_id'] === userId,
  )?.['role']
}

function addUser(token: string, id: string): void {
  users.set(token, { id, email: `${id}@example.com` })
}

function seedOrgWithMembers(members: Array<{ userId: string; role: string }>): void {
  db.tables['organizations'] = [
    { id: 'org1', name: 'Acme', owner_id: 'ua', plan: 'team', created_at: 't0', updated_at: 't0' },
  ]
  db.tables['org_members'] = members.map((m, i) => ({
    organization_id: 'org1',
    user_id: m.userId,
    role: m.role,
    created_at: `2026-01-01T00:00:0${i}.000Z`,
  }))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  at(0)
  db.reset()
  users.clear()
  _clearAuthCacheForTests()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('C1.1 new signup: bootstrap makes the workspace visible immediately', () => {
  test('pre-onboarding lookup, then bootstrap, then /organizations/me is 200 right away', async () => {
    addUser('tok-new', 'u-new')

    // First authenticated call after signup (pending-invitations / consent in
    // the real app): the user has no membership yet.
    const before = await call('tok-new', 'GET', '/organizations/me')
    expect(before.status).toBe(404)

    at(20_000)
    const boot = await call('tok-new', 'POST', '/organizations/bootstrap', { name: 'Acme' })
    expect(boot.status).toBe(201)
    const bootBody = (await boot.json()) as { data: { organization: { id: string } } }
    const orgId = bootBody.data.organization.id
    expect(roleOf(orgId, 'u-new')).toBe('admin')

    // Same instance, same token, no workspace cookie, well inside the 60s TTL.
    at(30_000)
    const me = await call('tok-new', 'GET', '/organizations/me')
    expect(me.status).toBe(200)
    const meBody = (await me.json()) as { data: { id: string } }
    expect(meBody.data.id).toBe(orgId)
  })

  test('bootstrap after the pre-onboarding entry expired still yields 200 (no re-cached null)', async () => {
    addUser('tok-new', 'u-new')
    await call('tok-new', 'GET', '/organizations/me')

    // The earlier entry has expired, so bootstrap's own authJwt pass is the
    // last lookup before the membership row exists.
    at(70_000)
    const boot = await call('tok-new', 'POST', '/organizations/bootstrap', { name: 'Acme' })
    expect(boot.status).toBe(201)

    at(100_000)
    const me = await call('tok-new', 'GET', '/organizations/me')
    expect(me.status).toBe(200)
  })

  test('the workspace cookie path keeps working (control)', async () => {
    addUser('tok-new', 'u-new')
    await call('tok-new', 'GET', '/organizations/me')
    const boot = await call('tok-new', 'POST', '/organizations/bootstrap', { name: 'Acme' })
    const orgId = ((await boot.json()) as { data: { organization: { id: string } } }).data
      .organization.id

    const me = await call('tok-new', 'GET', '/organizations/me', undefined, `sb-ws=${orgId}`)
    expect(me.status).toBe(200)
  })
})

describe('C1.2 demoted or removed admins lose write access immediately', () => {
  beforeEach(() => {
    addUser('tok-a', 'ua')
    addUser('tok-b', 'ub')
    addUser('tok-c', 'uc')
    seedOrgWithMembers([
      { userId: 'ua', role: 'admin' },
      { userId: 'ub', role: 'admin' },
      { userId: 'uc', role: 'editor' },
    ])
  })

  async function warmCacheFor(token: string): Promise<void> {
    const res = await call(token, 'GET', '/organizations/org1/members')
    expect(res.status).toBe(200)
  }

  test('demoted admin with a warm cache cannot change another member (403)', async () => {
    await warmCacheFor('tok-b')

    const demote = await call('tok-a', 'PATCH', '/organizations/org1/members/ub', { role: 'viewer' })
    expect(demote.status).toBe(200)
    expect(roleOf('org1', 'ub')).toBe('viewer')

    at(5_000)
    const res = await call('tok-b', 'PATCH', '/organizations/org1/members/uc', { role: 'viewer' })
    expect(res.status).toBe(403)
    expect(roleOf('org1', 'uc')).toBe('editor')
  })

  test('demoted admin with a warm cache cannot re-promote themselves (403)', async () => {
    await warmCacheFor('tok-b')
    await call('tok-a', 'PATCH', '/organizations/org1/members/ub', { role: 'viewer' })

    at(5_000)
    const res = await call('tok-b', 'PATCH', '/organizations/org1/members/ub', { role: 'admin' })
    expect(res.status).toBe(403)
    expect(roleOf('org1', 'ub')).toBe('viewer')

    // And the demotion sticks once the old cache entry would have expired.
    at(61_000)
    expect(roleOf('org1', 'ub')).toBe('viewer')
  })

  test('demoted admin can still read as a viewer', async () => {
    await warmCacheFor('tok-b')
    await call('tok-a', 'PATCH', '/organizations/org1/members/ub', { role: 'viewer' })

    at(5_000)
    const res = await call('tok-b', 'GET', '/organizations/org1/members')
    expect(res.status).toBe(200)
  })

  test('removed admin with a warm cache cannot delete members or rename the workspace', async () => {
    await warmCacheFor('tok-b')

    const remove = await call('tok-a', 'DELETE', '/organizations/org1/members/ub')
    expect(remove.status).toBe(200)
    expect(roleOf('org1', 'ub')).toBeUndefined()

    at(5_000)
    const del = await call('tok-b', 'DELETE', '/organizations/org1/members/uc')
    expect(del.status).toBe(403)
    expect(roleOf('org1', 'uc')).toBe('editor')

    const rename = await call('tok-b', 'PATCH', '/organizations/org1', { name: 'Hijacked' })
    expect(rename.status).toBe(403)
    expect(db.tables['organizations']?.[0]?.['name']).toBe('Acme')
  })

  test('cold cache control: a demoted admin is rejected without any warm entry', async () => {
    await call('tok-a', 'PATCH', '/organizations/org1/members/ub', { role: 'viewer' })
    _clearAuthCacheForTests()

    const res = await call('tok-b', 'PATCH', '/organizations/org1/members/ub', { role: 'admin' })
    expect(res.status).toBe(403)
  })

  test('warm cache control: an admin who is still an admin can write', async () => {
    await warmCacheFor('tok-a')

    at(5_000)
    const res = await call('tok-a', 'PATCH', '/organizations/org1/members/uc', { role: 'viewer' })
    expect(res.status).toBe(200)
    expect(roleOf('org1', 'uc')).toBe('viewer')
  })

  test('a freshly promoted member can write without waiting out the cache', async () => {
    await warmCacheFor('tok-c')
    await call('tok-a', 'PATCH', '/organizations/org1/members/uc', { role: 'admin' })

    at(5_000)
    const res = await call('tok-c', 'PATCH', '/organizations/org1/members/ub', { role: 'editor' })
    expect(res.status).toBe(200)
    expect(roleOf('org1', 'ub')).toBe('editor')
  })
})
