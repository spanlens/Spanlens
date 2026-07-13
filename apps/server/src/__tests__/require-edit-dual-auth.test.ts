import { describe, expect, test, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { authJwtOrApiKey, type DualAuthContext } from '../middleware/authJwtOrApiKey.js'
import { requireFullScope } from '../middleware/requireFullScope.js'
import { requireEditDualAuth } from '../middleware/requireEditDualAuth.js'
import { _clearAuthCacheForTests } from '../middleware/authJwt.js'
import { installOnError } from './helpers/install-on-error.js'

/**
 * Pins the auth matrix for dual-auth WRITE routes that use the shared
 * requireEditDualAuth gate (evals evaluator CRUD/run trigger, anomalies ack):
 *
 *   authJwtOrApiKey + requireFullScope + requireEditDualAuth:
 *     full sl_live_ key       → allowed (null role passes the gate)
 *     public sl_live_pub_ key → 403 PUBLIC_KEY_WRITE_FORBIDDEN
 *     admin / editor JWT      → allowed
 *     viewer JWT              → 403 FORBIDDEN
 *
 * Regression guard for two bugs found 2026-07-13: DELETE /evaluators/:id was
 * missing the edit gate (viewer could archive), and anomalies /ack used plain
 * requireRole (full API keys could not ack).
 */

const FULL_KEY = 'sl_live_fullkey0123456789abcdef'
const PUBLIC_KEY = 'sl_live_pub_publickey0123456789'
const JWT_TOKEN = 'fake-jwt-token-12345'

const FULL_HASH = 'full-hash'
const PUBLIC_HASH = 'public-hash'

// Role returned for the JWT path — mutated per test.
let jwtRole = 'admin'

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
                data: { organization_id: 'org-from-jwt', role: jwtRole },
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
  // Mirrors the write-route composition in evals.ts and anomalies.ts.
  app.post('/write', requireFullScope, requireEditDualAuth, (c) =>
    c.json({ ok: true, orgId: c.get('orgId'), role: c.get('role') ?? null }),
  )
  installOnError(app)
  return app
}

describe('requireEditDualAuth write gate', () => {
  beforeEach(() => {
    _clearAuthCacheForTests()
    jwtRole = 'admin'
  })

  test('full sl_live_ key passes (null role is the CI/SDK path)', async () => {
    const res = await buildApp().request('/write', {
      method: 'POST',
      headers: { Authorization: `Bearer ${FULL_KEY}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { orgId: string; role: string | null }
    expect(body.orgId).toBe('org-full')
    expect(body.role).toBeNull()
  })

  test('public sl_live_pub_ key is rejected by requireFullScope', async () => {
    const res = await buildApp().request('/write', {
      method: 'POST',
      headers: { Authorization: `Bearer ${PUBLIC_KEY}` },
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('PUBLIC_KEY_WRITE_FORBIDDEN')
  })

  test('admin JWT passes', async () => {
    jwtRole = 'admin'
    const res = await buildApp().request('/write', {
      method: 'POST',
      headers: { Authorization: `Bearer ${JWT_TOKEN}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { role: string | null }
    expect(body.role).toBe('admin')
  })

  test('editor JWT passes', async () => {
    jwtRole = 'editor'
    const res = await buildApp().request('/write', {
      method: 'POST',
      headers: { Authorization: `Bearer ${JWT_TOKEN}` },
    })
    expect(res.status).toBe(200)
  })

  test('viewer JWT is rejected with FORBIDDEN', async () => {
    jwtRole = 'viewer'
    const res = await buildApp().request('/write', {
      method: 'POST',
      headers: { Authorization: `Bearer ${JWT_TOKEN}` },
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('FORBIDDEN')
  })
})

// Source-level guard: the 2026-07-13 bug was a ROUTE missing the gate, which
// the middleware-composition tests above cannot catch. Pin that every dual-auth
// write route in evals.ts and anomalies.ts mounts both guards.
describe('dual-auth write routes mount requireFullScope + requireEdit', () => {
  const routes: Array<{ file: string; pattern: RegExp; label: string }> = [
    {
      file: 'evals.ts',
      label: 'POST /evaluators',
      pattern: /post\('\/evaluators', requireFullScope, requireEdit,/,
    },
    {
      file: 'evals.ts',
      label: 'DELETE /evaluators/:id',
      pattern: /delete\('\/evaluators\/:id', requireFullScope, requireEdit,/,
    },
    {
      file: 'evals.ts',
      label: 'POST /eval-runs',
      pattern: /post\('\/eval-runs', requireFullScope, requireEdit,/,
    },
    {
      file: 'anomalies.ts',
      label: 'POST /ack',
      pattern: /post\('\/ack', requireFullScope, requireEdit,/,
    },
    {
      file: 'anomalies.ts',
      label: 'DELETE /ack',
      pattern: /delete\('\/ack', requireFullScope, requireEdit,/,
    },
  ]

  for (const { file, pattern, label } of routes) {
    test(`${file} ${label}`, async () => {
      const { readFile } = await import('node:fs/promises')
      const { fileURLToPath } = await import('node:url')
      const path = fileURLToPath(new URL(`../api/${file}`, import.meta.url))
      const source = await readFile(path, 'utf8')
      expect(source).toMatch(pattern)
    })
  }
})
