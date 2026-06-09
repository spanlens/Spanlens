import { describe, expect, test, vi } from 'vitest'
import { Hono } from 'hono'
import { authApiKey, type ApiKeyContext } from '../middleware/authApiKey.js'
import { requireFullScope } from '../middleware/requireFullScope.js'
import { installOnError } from './helpers/install-on-error.js'

/**
 * requireFullScope rejects `public`-scope Spanlens keys with 403 before they
 * reach write handlers (proxy/* and ingest/*). Full-scope keys pass through.
 *
 * The DB mock returns a row keyed by the resolved hash so we exercise both
 * branches from one test file:
 *   - sl_live_<hex>     → scope='full',   project-scoped
 *   - sl_live_pub_<hex> → scope='public', workspace-scoped
 */

const FULL_KEY = 'sl_live_fulltestkey0123456789abcd'
const FULL_HASH = 'full-hash'
const PUB_KEY = 'sl_live_pub_publictestkey0123456'
const PUB_HASH = 'pub-hash'

vi.mock('../lib/crypto.js', () => ({
  sha256Hex: async (raw: string) => {
    if (raw === FULL_KEY) return FULL_HASH
    if (raw === PUB_KEY) return PUB_HASH
    return 'invalid-hash'
  },
}))

vi.mock('../lib/db.js', () => ({
  supabaseAdmin: {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (col: string, val: string) => ({
          eq: (_col2: string, _val2: unknown) => ({
            single: async () => {
              if (col !== 'key_hash') return { data: null, error: { message: 'not found' } }
              if (val === FULL_HASH) {
                return {
                  data: {
                    id: 'full-key-id',
                    project_id: 'proj-1',
                    organization_id: null,
                    scope: 'full',
                    projects: { organization_id: 'org-1' },
                  },
                  error: null,
                }
              }
              if (val === PUB_HASH) {
                return {
                  data: {
                    id: 'pub-key-id',
                    project_id: null,
                    organization_id: 'org-1',
                    scope: 'public',
                    projects: null,
                  },
                  error: null,
                }
              }
              return { data: null, error: { message: 'not found' } }
            },
          }),
        }),
      }),
    }),
  },
}))

function buildApp() {
  const app = new Hono<ApiKeyContext>()
  app.use('*', authApiKey)
  app.use('*', requireFullScope)
  app.post('/write', (c) => c.json({ ok: true, scope: c.get('apiKeyScope') }))
  installOnError(app)
  return app
}

describe('requireFullScope', () => {
  const app = buildApp()

  test('full-scope key passes the guard with scope on context', async () => {
    const res = await app.request('/write', {
      method: 'POST',
      headers: { Authorization: `Bearer ${FULL_KEY}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; scope: string }
    expect(body.ok).toBe(true)
    expect(body.scope).toBe('full')
  })

  test('public key is rejected with 403 + PUBLIC_KEY_WRITE_FORBIDDEN code', async () => {
    const res = await app.request('/write', {
      method: 'POST',
      headers: { Authorization: `Bearer ${PUB_KEY}` },
    })
    expect(res.status).toBe(403)
    // Sprint 7 R-15: standard envelope via global onError handler.
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('PUBLIC_KEY_WRITE_FORBIDDEN')
    expect(body.error.message.toLowerCase()).toContain('public api key')
  })

  test('public-key rejection applies on every accepted transport', async () => {
    // Both x-api-key (Anthropic) and x-goog-api-key (Gemini) must enforce
    // the same scope rule — rejection is at middleware layer, not provider path.
    for (const headers of [{ 'x-api-key': PUB_KEY }, { 'x-goog-api-key': PUB_KEY }]) {
      const res = await app.request('/write', { method: 'POST', headers })
      expect(res.status).toBe(403)
    }
  })

  test('missing key returns 401 from authApiKey, not 403 from the scope guard', async () => {
    const res = await app.request('/write', { method: 'POST' })
    expect(res.status).toBe(401)
  })
})

describe('authApiKey owner resolution', () => {
  const app = new Hono<ApiKeyContext>()
  app.use('*', authApiKey)
  app.get('/probe', (c) =>
    c.json({
      orgId: c.get('organizationId'),
      projectId: c.get('projectId'),
      scope: c.get('apiKeyScope'),
    }),
  )
  installOnError(app)

  test('full key resolves organizationId via projects join, projectId set', async () => {
    const res = await app.request('/probe', { headers: { Authorization: `Bearer ${FULL_KEY}` } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { orgId: string; projectId: string | null; scope: string }
    expect(body.orgId).toBe('org-1')
    expect(body.projectId).toBe('proj-1')
    expect(body.scope).toBe('full')
  })

  test('public key resolves organizationId from the direct column, projectId null', async () => {
    const res = await app.request('/probe', { headers: { Authorization: `Bearer ${PUB_KEY}` } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { orgId: string; projectId: string | null; scope: string }
    expect(body.orgId).toBe('org-1')
    expect(body.projectId).toBeNull()
    expect(body.scope).toBe('public')
  })
})
