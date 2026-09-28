import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Hono, type Context } from 'hono'
import type { JwtContext } from '../middleware/authJwt.js'
import { installOnError } from './helpers/install-on-error.js'

// ─────────────────────────────────────────────────────────────────────────────
// Tests for the JWT middleware that gates every /api/v1/* route. A regression
// here means dashboard requests start letting anyone through or rejecting
// legitimate sessions — direct user-visible outage. We mock supabase so the
// tests run offline and stay deterministic.
// ─────────────────────────────────────────────────────────────────────────────

// supabaseClient.auth.getUser → controlled per-test
const getUserMock = vi.fn()
// supabaseAdmin.from('org_members').select(...).eq(...).maybeSingle()
// is set up dynamically because the call chain differs for the two queries
// (preferred-cookie lookup vs default-first-membership).
const fromMock = vi.fn()

vi.mock('../lib/db.js', () => ({
  supabaseClient: {
    auth: {
      getUser: (...args: unknown[]) => getUserMock(...args),
    },
  },
  supabaseAdmin: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}))

let authJwt: typeof import('../middleware/authJwt.js').authJwt

beforeEach(async () => {
  vi.resetModules()
  getUserMock.mockReset()
  fromMock.mockReset()
  ;({ authJwt } = await import('../middleware/authJwt.js'))
})

afterEach(() => vi.useRealTimers())

/** Builds a tiny Hono app with the middleware mounted on a probe route. */
function makeApp() {
  const app = new Hono<JwtContext>()
  app.use('*', authJwt)
  const probe = (c: Context<JwtContext>) =>
    c.json({
      userId: c.get('userId'),
      orgId: c.get('orgId'),
      role: c.get('role'),
    })
  app.get('/probe', probe)
  app.post('/probe', probe)
  installOnError(app)
  return app
}

describe('authJwt — auth header', () => {
  test('missing Authorization header → 401', async () => {
    const res = await makeApp().request('/probe')
    expect(res.status).toBe(401)
    // Sprint 7 R-15: standard envelope.
    expect(await res.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' },
    })
    // Never reaches Supabase — fail fast
    expect(getUserMock).not.toHaveBeenCalled()
  })

  test('Authorization without Bearer prefix → 401', async () => {
    const res = await makeApp().request('/probe', {
      headers: { Authorization: 'Basic abcdef' },
    })
    expect(res.status).toBe(401)
    expect(getUserMock).not.toHaveBeenCalled()
  })

  test('Authorization equal to "Bearer" (trailing whitespace stripped by header parser) → 401 missing prefix', async () => {
    // Hono / underlying HTTP layer trims trailing whitespace, so 'Bearer '
    // arrives as 'Bearer' on the server. The prefix check ('Bearer ') fails
    // before any supabase call — exactly the guard we want for malformed
    // clients sending just the keyword with no token.
    const res = await makeApp().request('/probe', {
      headers: { Authorization: 'Bearer ' },
    })
    expect(res.status).toBe(401)
    // Sprint 7 R-15: standard envelope.
    expect(await res.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' },
    })
    expect(getUserMock).not.toHaveBeenCalled()
  })
})

describe('authJwt — supabase auth result', () => {
  test('Supabase error → 401', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'expired' } })
    const res = await makeApp().request('/probe', {
      headers: { Authorization: 'Bearer expired_token' },
    })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' },
    })
  })

  test('Supabase returns no user → 401', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const res = await makeApp().request('/probe', {
      headers: { Authorization: 'Bearer nouser' },
    })
    expect(res.status).toBe(401)
  })
})

describe('authJwt — happy path (default workspace)', () => {
  test('valid token without cookie → resolves to oldest org_members row', async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: 'usr_1' } },
      error: null,
    })

    // Single `from('org_members')` call: select.eq.order.limit.maybeSingle returns the default
    const defaultChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { organization_id: 'org_1', role: 'admin' },
        error: null,
      }),
    }
    fromMock.mockReturnValue(defaultChain)

    const res = await makeApp().request('/probe', {
      headers: { Authorization: 'Bearer good' },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ userId: 'usr_1', orgId: 'org_1', role: 'admin' })
  })

  test('valid token without any membership → orgId=null, role=null (pre-onboarding)', async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: 'usr_new' } },
      error: null,
    })

    fromMock.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })

    const res = await makeApp().request('/probe', {
      headers: { Authorization: 'Bearer new' },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ userId: 'usr_new', orgId: null, role: null })
  })
})

describe('authJwt — workspace cookie (sb-ws)', () => {
  test('preferred cookie matches a membership → uses that org', async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: 'usr_1' } },
      error: null,
    })

    // Only one `from` call: preferred-cookie lookup succeeds, no fallback needed
    fromMock.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      // Note: preferred-cookie path uses .eq twice (user_id + organization_id), then maybeSingle
      maybeSingle: vi.fn().mockResolvedValue({
        data: { organization_id: 'org_preferred', role: 'editor' },
        error: null,
      }),
    })

    const res = await makeApp().request('/probe', {
      headers: {
        Authorization: 'Bearer good',
        cookie: 'sb-ws=org_preferred; other=value',
      },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      userId: 'usr_1',
      orgId: 'org_preferred',
      role: 'editor',
    })
  })

  test('stale cookie (user no longer in that org) → falls back to default membership', async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: 'usr_1' } },
      error: null,
    })

    // First call: cookie lookup misses (data null)
    // Second call: default lookup succeeds
    let callCount = 0
    fromMock.mockImplementation(() => {
      callCount += 1
      if (callCount === 1) {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { organization_id: 'org_default', role: 'viewer' },
          error: null,
        }),
      }
    })

    const res = await makeApp().request('/probe', {
      headers: {
        Authorization: 'Bearer good',
        cookie: 'sb-ws=org_stale',
      },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      userId: 'usr_1',
      orgId: 'org_default',
      role: 'viewer',
    })
    // Both code paths exercised
    expect(callCount).toBe(2)
  })

  test('malformed cookie header is tolerated (no throw)', async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: 'usr_1' } },
      error: null,
    })
    fromMock.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { organization_id: 'org_default', role: 'admin' },
        error: null,
      }),
    })

    // No sb-ws cookie present — only random/empty parts
    const res = await makeApp().request('/probe', {
      headers: {
        Authorization: 'Bearer good',
        cookie: ';;;random;= ;',
      },
    })
    expect(res.status).toBe(200)
  })
})

// XVERIFY 2026-09-28 C1.1: the "no membership yet" result used to be cached
// for 60s, so a workspace created right after signup stayed invisible.
describe('authJwt — cache policy', () => {
  function membershipChain(result: { organization_id: string; role: string } | null) {
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: result, error: null }),
    }
  }

  test('a pre-onboarding (no membership) result is NOT cached', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'usr_new' } }, error: null })
    fromMock.mockReturnValueOnce(membershipChain(null))
    fromMock.mockReturnValueOnce(membershipChain({ organization_id: 'org_new', role: 'admin' }))

    const app = makeApp()
    const first = await app.request('/probe', { headers: { Authorization: 'Bearer tok' } })
    expect(await first.json()).toEqual({ userId: 'usr_new', orgId: null, role: null })

    // Membership created in between (bootstrap). Same token, same instance.
    const second = await app.request('/probe', { headers: { Authorization: 'Bearer tok' } })
    expect(await second.json()).toEqual({ userId: 'usr_new', orgId: 'org_new', role: 'admin' })
    expect(getUserMock).toHaveBeenCalledTimes(2)
  })

  test('a resolved membership IS cached (second request skips Supabase)', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'usr_1' } }, error: null })
    fromMock.mockReturnValue(membershipChain({ organization_id: 'org_1', role: 'editor' }))

    const app = makeApp()
    await app.request('/probe', { headers: { Authorization: 'Bearer tok' } })
    const second = await app.request('/probe', { headers: { Authorization: 'Bearer tok' } })
    expect(await second.json()).toEqual({ userId: 'usr_1', orgId: 'org_1', role: 'editor' })
    expect(getUserMock).toHaveBeenCalledTimes(1)
    expect(fromMock).toHaveBeenCalledTimes(1)
  })

  test('invalidateAuthCacheForUser drops every entry of that user and nobody else', async () => {
    const { invalidateAuthCacheForUser } = await import('../middleware/authJwt.js')
    getUserMock.mockImplementation(async (token: string) => ({
      data: { user: { id: token.startsWith('a') ? 'usr_a' : 'usr_b' } },
      error: null,
    }))
    fromMock.mockImplementation(() =>
      membershipChain({ organization_id: 'org_1', role: 'admin' }),
    )

    const app = makeApp()
    // usr_a: two tokens plus a workspace-cookie variant = three entries.
    await app.request('/probe', { headers: { Authorization: 'Bearer a1' } })
    await app.request('/probe', { headers: { Authorization: 'Bearer a2' } })
    await app.request('/probe', {
      headers: { Authorization: 'Bearer a1', cookie: 'sb-ws=org_1' },
    })
    await app.request('/probe', { headers: { Authorization: 'Bearer b1' } })
    expect(getUserMock).toHaveBeenCalledTimes(4)

    expect(invalidateAuthCacheForUser('usr_a')).toBe(3)
    expect(invalidateAuthCacheForUser('usr_a')).toBe(0)

    // usr_b is still served from cache; usr_a pays the lookup again.
    await app.request('/probe', { headers: { Authorization: 'Bearer b1' } })
    expect(getUserMock).toHaveBeenCalledTimes(4)
    await app.request('/probe', { headers: { Authorization: 'Bearer a1' } })
    expect(getUserMock).toHaveBeenCalledTimes(5)
  })

  test('a write re-reads org_members even with a warm entry, reusing the verified token', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'usr_1' } }, error: null })
    fromMock.mockReturnValueOnce(membershipChain({ organization_id: 'org_1', role: 'admin' }))
    fromMock.mockReturnValueOnce(membershipChain({ organization_id: 'org_1', role: 'viewer' }))

    const app = makeApp()
    const headers = { Authorization: 'Bearer tok' }
    const read = await app.request('/probe', { headers })
    expect(await read.json()).toEqual({ userId: 'usr_1', orgId: 'org_1', role: 'admin' })

    // Demoted to viewer in between. The write sees it at once.
    const write = await app.request('/probe', { method: 'POST', headers })
    expect(await write.json()).toEqual({ userId: 'usr_1', orgId: 'org_1', role: 'viewer' })
    expect(getUserMock).toHaveBeenCalledTimes(1)
    expect(fromMock).toHaveBeenCalledTimes(2)

    // The refreshed membership replaces the stale entry for later reads.
    const after = await app.request('/probe', { headers })
    expect(await after.json()).toEqual({ userId: 'usr_1', orgId: 'org_1', role: 'viewer' })
    expect(fromMock).toHaveBeenCalledTimes(2)
  })

  test('a write that finds no membership drops the cached entry', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'usr_1' } }, error: null })
    fromMock.mockReturnValueOnce(membershipChain({ organization_id: 'org_1', role: 'admin' }))
    fromMock.mockReturnValue(membershipChain(null))

    const app = makeApp()
    const headers = { Authorization: 'Bearer tok' }
    await app.request('/probe', { headers })

    // Removed from the workspace in between.
    const write = await app.request('/probe', { method: 'POST', headers })
    expect(await write.json()).toEqual({ userId: 'usr_1', orgId: null, role: null })

    // The next read resolves from scratch instead of reusing org_1.
    const after = await app.request('/probe', { headers })
    expect(await after.json()).toEqual({ userId: 'usr_1', orgId: null, role: null })
    expect(getUserMock).toHaveBeenCalledTimes(2)
  })
})
