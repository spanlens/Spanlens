import { describe, expect, test, vi } from 'vitest'
import { Hono } from 'hono'
import { authApiKey, type ApiKeyContext } from '../middleware/authApiKey.js'
import { requireFullScope } from '../middleware/requireFullScope.js'

/**
 * requireFullScope rejects readonly Spanlens keys with 403 before they reach
 * write handlers (proxy/* and ingest/*). Full-scope keys pass through.
 *
 * The DB mock returns whichever scope the test sets via `setMockScope` so we
 * can drive both branches from a single test file without re-mocking per
 * describe block.
 */

const FULL_KEY = 'sl_live_fulltestkey0123456789abcd'
const FULL_HASH = 'full-hash'
const RO_KEY = 'sl_live_ro_readonlytestkey0123456'
const RO_HASH = 'ro-hash'

vi.mock('../lib/crypto.js', () => ({
  sha256Hex: async (raw: string) => {
    if (raw === FULL_KEY) return FULL_HASH
    if (raw === RO_KEY) return RO_HASH
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
                    scope: 'full',
                    projects: { organization_id: 'org-1' },
                  },
                  error: null,
                }
              }
              if (val === RO_HASH) {
                return {
                  data: {
                    id: 'ro-key-id',
                    project_id: 'proj-1',
                    scope: 'readonly',
                    projects: { organization_id: 'org-1' },
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
  app.post('/write', (c) => c.json({ ok: true }))
  return app
}

describe('requireFullScope', () => {
  const app = buildApp()

  test('full-scope key passes the guard', async () => {
    const res = await app.request('/write', {
      method: 'POST',
      headers: { Authorization: `Bearer ${FULL_KEY}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  test('readonly key is rejected with 403 + READONLY_KEY code', async () => {
    const res = await app.request('/write', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RO_KEY}` },
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string; code: string }
    expect(body.code).toBe('READONLY_KEY')
    // Error message should point the user at the dashboard so they know
    // where to mint a full-access key instead of debugging blindly.
    expect(body.error.toLowerCase()).toContain('read-only')
  })

  test('readonly rejection still surfaces 403 on every accepted transport', async () => {
    // Both x-api-key (Anthropic) and x-goog-api-key (Gemini) must enforce
    // the same scope rule — the rejection is at the middleware layer, not
    // tied to a specific provider path.
    for (const headers of [{ 'x-api-key': RO_KEY }, { 'x-goog-api-key': RO_KEY }]) {
      const res = await app.request('/write', { method: 'POST', headers })
      expect(res.status).toBe(403)
    }
  })

  test('missing key returns 401 from authApiKey, not 403 from the scope guard', async () => {
    const res = await app.request('/write', { method: 'POST' })
    expect(res.status).toBe(401)
  })
})
