import { describe, expect, test, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { authJwtOrApiKey, type DualAuthContext } from '../middleware/authJwtOrApiKey.js'
import { _clearAuthCacheForTests } from '../middleware/authJwt.js'

/**
 * The dual-auth middleware on `/api/v1/*` routes to one of two auth flows
 * based on the Authorization header shape:
 *
 *   Bearer sl_live_*  → authApiKey (Spanlens key)
 *   Bearer <JWT>      → authJwt (Supabase session)
 *
 * After authApiKey succeeds, we BRIDGE `organizationId` → `orgId` so the
 * existing read-API handlers (which were written for JWT auth and use
 * `c.get('orgId')`) keep working without per-route changes. The tests below
 * verify both branches reach the handler with `orgId` populated.
 */

const SPANLENS_KEY = 'sl_live_dualauthtestkey0123456789'
const SPANLENS_HASH = 'spanlens-hash'
const JWT_TOKEN = 'fake-jwt-token-12345'

vi.mock('../lib/crypto.js', () => ({
  sha256Hex: async (raw: string) => {
    if (raw === SPANLENS_KEY) return SPANLENS_HASH
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
              if (table === 'api_keys' && col === 'key_hash' && val === SPANLENS_HASH) {
                return {
                  data: {
                    id: 'api-key-1',
                    project_id: null,
                    organization_id: 'org-from-api-key',
                    scope: 'public',
                    projects: null,
                  },
                  error: null,
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
      getUser: async (token: string) => {
        if (token === JWT_TOKEN) {
          return {
            data: {
              user: { id: 'user-1', email: 'jwt@example.com' },
            },
            error: null,
          }
        }
        return { data: { user: null }, error: { message: 'invalid token' } }
      },
    },
  },
}))

function buildApp() {
  const app = new Hono<DualAuthContext>()
  app.use('*', authJwtOrApiKey)
  app.get('/probe', (c) =>
    c.json({
      orgId: c.get('orgId'),
      // organizationId is set by authApiKey branch; left undefined on JWT.
      organizationId: c.get('organizationId') ?? null,
      scope: c.get('apiKeyScope') ?? null,
    }),
  )
  return app
}

describe('authJwtOrApiKey', () => {
  beforeEach(() => {
    _clearAuthCacheForTests()
  })

  test('routes sl_live_* key through authApiKey and bridges orgId', async () => {
    const app = buildApp()
    const res = await app.request('/probe', {
      headers: { Authorization: `Bearer ${SPANLENS_KEY}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      orgId: string
      organizationId: string
      scope: string
    }
    // Both names point at the same org so legacy JWT handlers work
    // unmodified when the request came in via an API key.
    expect(body.orgId).toBe('org-from-api-key')
    expect(body.organizationId).toBe('org-from-api-key')
    expect(body.scope).toBe('public')
  })

  test('routes JWT through authJwt — orgId resolved via org_members', async () => {
    const app = buildApp()
    const res = await app.request('/probe', {
      headers: { Authorization: `Bearer ${JWT_TOKEN}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { orgId: string; scope: string | null }
    expect(body.orgId).toBe('org-from-jwt')
    // JWT auth doesn't set apiKeyScope — handlers that care should check.
    expect(body.scope).toBeNull()
  })

  test('missing Authorization header returns 401 from JWT path', async () => {
    const app = buildApp()
    const res = await app.request('/probe')
    expect(res.status).toBe(401)
  })

  test('Bearer with non-sl_live token goes through JWT path (invalid → 401)', async () => {
    const app = buildApp()
    const res = await app.request('/probe', {
      headers: { Authorization: 'Bearer some-other-token' },
    })
    // Not sl_live_*, so routed to authJwt. supabaseClient.auth.getUser
    // returns an error for unknown tokens.
    expect(res.status).toBe(401)
  })
})
