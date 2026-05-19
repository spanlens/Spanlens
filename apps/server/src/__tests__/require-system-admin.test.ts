import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Hono } from 'hono'

// ─────────────────────────────────────────────────────────────────────────────
// Tests for the system-admin gate that protects internal-only routes (e.g.
// /api/v1/admin/model-prices). The middleware MUST fail closed when the
// allowlist env var is unset or empty — a regression that flipped to "open"
// would expose Spanlens-global resources to every authenticated user.
// ─────────────────────────────────────────────────────────────────────────────

const getUserMock = vi.fn()
vi.mock('../lib/db.js', () => ({
  supabaseClient: {
    auth: {
      getUser: (...args: unknown[]) => getUserMock(...args),
    },
  },
}))

let requireSystemAdmin: typeof import('../middleware/requireSystemAdmin.js').requireSystemAdmin
const origEnv = process.env['SPANLENS_ADMIN_EMAILS']

beforeEach(async () => {
  vi.resetModules()
  getUserMock.mockReset()
  delete process.env['SPANLENS_ADMIN_EMAILS']
  ;({ requireSystemAdmin } = await import('../middleware/requireSystemAdmin.js'))
})

afterEach(() => {
  if (origEnv === undefined) delete process.env['SPANLENS_ADMIN_EMAILS']
  else process.env['SPANLENS_ADMIN_EMAILS'] = origEnv
})

/** Apps the middleware on top of a fake authJwt that just stuffs userId. */
function makeApp(userId: string | null, opts: { authHeader?: string } = {}) {
  const app = new Hono<{ Variables: { userId: string | null } }>()
  app.use('*', async (c, next) => {
    if (userId) c.set('userId', userId)
    return next()
  })
  app.use('*', requireSystemAdmin as unknown as Parameters<typeof app.use>[1])
  app.get('/probe', (c) => c.json({ ok: true }))
  return {
    request: () =>
      app.request(
        '/probe',
        opts.authHeader
          ? { headers: { Authorization: opts.authHeader } }
          : {},
      ),
  }
}

describe('requireSystemAdmin — fail-closed defaults', () => {
  test('SPANLENS_ADMIN_EMAILS unset → 403 (no one is admin by default)', async () => {
    const res = await makeApp('usr_1', { authHeader: 'Bearer t' }).request()
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Insufficient permission' })
  })

  test('SPANLENS_ADMIN_EMAILS set to whitespace/empty → 403', async () => {
    process.env['SPANLENS_ADMIN_EMAILS'] = '   ,  , '
    const res = await makeApp('usr_1', { authHeader: 'Bearer t' }).request()
    expect(res.status).toBe(403)
  })

  test('missing userId in context (upstream middleware off) → 403', async () => {
    process.env['SPANLENS_ADMIN_EMAILS'] = 'ops@spanlens.io'
    const res = await makeApp(null, { authHeader: 'Bearer t' }).request()
    expect(res.status).toBe(403)
  })

  test('missing Authorization header (skips upstream JWT check) → 403', async () => {
    process.env['SPANLENS_ADMIN_EMAILS'] = 'ops@spanlens.io'
    const res = await makeApp('usr_1').request() // no authHeader
    expect(res.status).toBe(403)
    expect(getUserMock).not.toHaveBeenCalled()
  })
})

describe('requireSystemAdmin — Supabase auth lookup', () => {
  test('Supabase rejects token → 403', async () => {
    process.env['SPANLENS_ADMIN_EMAILS'] = 'ops@spanlens.io'
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'expired' } })
    const res = await makeApp('usr_1', { authHeader: 'Bearer t' }).request()
    expect(res.status).toBe(403)
  })

  test('Supabase returns user without email → 403', async () => {
    process.env['SPANLENS_ADMIN_EMAILS'] = 'ops@spanlens.io'
    getUserMock.mockResolvedValue({ data: { user: { id: 'usr_1', email: undefined } }, error: null })
    const res = await makeApp('usr_1', { authHeader: 'Bearer t' }).request()
    expect(res.status).toBe(403)
  })

  test('email not in allowlist → 403', async () => {
    process.env['SPANLENS_ADMIN_EMAILS'] = 'ops@spanlens.io,ceo@spanlens.io'
    getUserMock.mockResolvedValue({
      data: { user: { id: 'usr_1', email: 'random@example.com' } },
      error: null,
    })
    const res = await makeApp('usr_1', { authHeader: 'Bearer t' }).request()
    expect(res.status).toBe(403)
  })
})

describe('requireSystemAdmin — happy paths', () => {
  test('email exact match → next()', async () => {
    process.env['SPANLENS_ADMIN_EMAILS'] = 'ops@spanlens.io,ceo@spanlens.io'
    getUserMock.mockResolvedValue({
      data: { user: { id: 'usr_1', email: 'ops@spanlens.io' } },
      error: null,
    })
    const res = await makeApp('usr_1', { authHeader: 'Bearer t' }).request()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  test('case-insensitive comparison + whitespace tolerance', async () => {
    process.env['SPANLENS_ADMIN_EMAILS'] = ' OPS@SPANLENS.IO , ceo@spanlens.io '
    getUserMock.mockResolvedValue({
      data: { user: { id: 'usr_1', email: 'Ops@Spanlens.io' } },
      error: null,
    })
    const res = await makeApp('usr_1', { authHeader: 'Bearer t' }).request()
    expect(res.status).toBe(200)
  })
})
