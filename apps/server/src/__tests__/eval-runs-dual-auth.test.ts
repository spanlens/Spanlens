import { describe, expect, test, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { authJwtOrApiKey, type DualAuthContext } from '../middleware/authJwtOrApiKey.js'
import { requireFullScope } from '../middleware/requireFullScope.js'
import { _clearAuthCacheForTests } from '../middleware/authJwt.js'
import { installOnError } from './helpers/install-on-error.js'

/**
 * P2-8: the evals router is dual-auth so CI/SDK can run evals with an
 * sl_live_* key. Spend/write routes (eval-run trigger, evaluator CRUD)
 * additionally mount requireFullScope. These tests pin the auth matrix on
 * the exact middleware composition the router uses:
 *
 *   write route (authJwtOrApiKey + requireFullScope):
 *     full sl_live_ key  → allowed
 *     public sl_live_pub_ key → 403 PUBLIC_KEY_WRITE_FORBIDDEN
 *     JWT                → allowed (requireFullScope is a no-op off the key path)
 *   read route (authJwtOrApiKey only):
 *     public key         → allowed
 */

const FULL_KEY = 'sl_live_fullkey0123456789abcdef'
const PUBLIC_KEY = 'sl_live_pub_publickey0123456789'
const JWT_TOKEN = 'fake-jwt-token-12345'

const FULL_HASH = 'full-hash'
const PUBLIC_HASH = 'public-hash'

vi.mock('../lib/crypto.js', () => ({
  sha256Hex: async (raw: string) => {
    if (raw === FULL_KEY) return FULL_HASH
    if (raw === PUBLIC_KEY) return PUBLIC_HASH
    return 'invalid'
  },
}))

vi.mock('../lib/db.js', () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      select: (_cols: string) => ({
        eq: (col: string, val: string) => ({
          eq: (_col2: string, _val2: unknown) => ({
            single: async () => {
              if (table === 'api_keys' && col === 'key_hash') {
                if (val === FULL_HASH) {
                  return {
                    data: {
                      id: 'api-key-full',
                      project_id: 'proj-1',
                      organization_id: null,
                      scope: 'full',
                      projects: { organization_id: 'org-full', organizations: { plan: 'pro' } },
                      organizations: null,
                    },
                    error: null,
                  }
                }
                if (val === PUBLIC_HASH) {
                  return {
                    data: {
                      id: 'api-key-public',
                      project_id: null,
                      organization_id: 'org-public',
                      scope: 'public',
                      projects: null,
                      organizations: { plan: 'pro' },
                    },
                    error: null,
                  }
                }
              }
              return { data: null, error: { message: 'not found' } }
            },
            maybeSingle: async () => ({ data: null }),
          }),
          order: () => ({
            limit: () => ({
              maybeSingle: async () => ({
                data: { organization_id: 'org-from-jwt', role: 'admin' },
              }),
            }),
          }),
        }),
      }),
    }),
  },
  supabaseClient: {
    auth: {
      getUser: async (token: string) =>
        token === JWT_TOKEN
          ? { data: { user: { id: 'user-1', email: 'jwt@example.com' } }, error: null }
          : { data: { user: null }, error: { message: 'invalid token' } },
    },
  },
}))

function buildApp() {
  const app = new Hono<DualAuthContext>()
  app.use('*', authJwtOrApiKey)
  // Mirrors evalsRouter: write route guarded, read route open.
  app.post('/eval-runs', requireFullScope, (c) =>
    c.json({ ok: true, orgId: c.get('orgId'), scope: c.get('apiKeyScope') ?? null }),
  )
  app.get('/eval-runs', (c) => c.json({ ok: true, orgId: c.get('orgId') }))
  installOnError(app)
  return app
}

describe('evals dual-auth + full-scope guard', () => {
  beforeEach(() => {
    _clearAuthCacheForTests()
  })

  test('full sl_live_ key may trigger a run (write route)', async () => {
    const res = await buildApp().request('/eval-runs', {
      method: 'POST',
      headers: { Authorization: `Bearer ${FULL_KEY}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { orgId: string; scope: string }
    expect(body.orgId).toBe('org-full')
    expect(body.scope).toBe('full')
  })

  test('public sl_live_pub_ key is rejected on the write route', async () => {
    const res = await buildApp().request('/eval-runs', {
      method: 'POST',
      headers: { Authorization: `Bearer ${PUBLIC_KEY}` },
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('PUBLIC_KEY_WRITE_FORBIDDEN')
  })

  test('JWT passes the write route (requireFullScope is a no-op off the key path)', async () => {
    const res = await buildApp().request('/eval-runs', {
      method: 'POST',
      headers: { Authorization: `Bearer ${JWT_TOKEN}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { orgId: string; scope: string | null }
    expect(body.orgId).toBe('org-from-jwt')
    expect(body.scope).toBeNull()
  })

  test('public key may read runs (read route, no guard)', async () => {
    const res = await buildApp().request('/eval-runs', {
      headers: { Authorization: `Bearer ${PUBLIC_KEY}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { orgId: string }
    expect(body.orgId).toBe('org-public')
  })
})
