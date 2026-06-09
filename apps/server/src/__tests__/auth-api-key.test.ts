import { describe, expect, test, vi } from 'vitest'
import { Hono } from 'hono'
import { authApiKey, type ApiKeyContext } from '../middleware/authApiKey.js'
import { installOnError } from './helpers/install-on-error.js'

// Stub supabaseAdmin so tests never hit a real database.
// The stub returns a valid key record only when key_hash matches VALID_HASH.
const VALID_KEY = 'sl_live_validtestkey1234567890abc'
const VALID_HASH = 'valid-hash-placeholder'

vi.mock('../lib/db.js', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: async () => ({
              data: {
                id: 'key-1',
                project_id: 'proj-1',
                organization_id: null,
                scope: 'full',
                projects: { organization_id: 'org-1' },
              },
              error: null,
            }),
          }),
        }),
      }),
    }),
  },
}))

vi.mock('../lib/crypto.js', () => ({
  sha256Hex: async (raw: string) => {
    if (raw === VALID_KEY) return VALID_HASH
    return 'invalid-hash'
  },
}))

// Override the DB response based on the hash
vi.mock('../lib/db.js', () => ({
  supabaseAdmin: {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (col: string, val: string) => ({
          eq: (_col2: string, _val2: unknown) => ({
            single: async () => {
              if (col === 'key_hash' && val === VALID_HASH) {
                return {
                  data: {
                    id: 'key-1',
                    project_id: 'proj-1',
                    organization_id: null,
                    scope: 'full',
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
  app.get('/probe', (c) =>
    c.json({
      ok: true,
      orgId: c.get('organizationId'),
      projectId: c.get('projectId'),
      scope: c.get('apiKeyScope'),
    }),
  )
  installOnError(app)
  return app
}

describe('authApiKey — accepted transports', () => {
  const app = buildApp()

  test('Authorization: Bearer passes', async () => {
    const res = await app.request('/probe', {
      headers: { Authorization: `Bearer ${VALID_KEY}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; orgId: string; scope: string }
    expect(body.ok).toBe(true)
    expect(body.orgId).toBe('org-1')
    // scope is populated on the context so downstream guards can read it.
    expect(body.scope).toBe('full')
  })

  test('x-api-key passes', async () => {
    const res = await app.request('/probe', {
      headers: { 'x-api-key': VALID_KEY },
    })
    expect(res.status).toBe(200)
  })

  test('x-goog-api-key passes', async () => {
    const res = await app.request('/probe', {
      headers: { 'x-goog-api-key': VALID_KEY },
    })
    expect(res.status).toBe(200)
  })
})

describe('authApiKey — rejected transports', () => {
  const app = buildApp()

  test('?key= query string returns 401 (key must not be in URL)', async () => {
    const res = await app.request(`/probe?key=${VALID_KEY}`)
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string; message: string } }
    // Should mention the supported header transports, not ?key=
    expect(body.error.message).toContain('x-goog-api-key')
    expect(body.error.message).not.toContain('?key=')
  })

  test('no key returns 401', async () => {
    const res = await app.request('/probe')
    expect(res.status).toBe(401)
  })

  test('invalid key returns 401', async () => {
    const res = await app.request('/probe', {
      headers: { Authorization: 'Bearer sl_live_wrong_key' },
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string; message: string } }
    // Sprint 7 R-15: standard envelope shape via global onError handler.
    expect(body.error.code).toBe('UNAUTHORIZED')
    expect(body.error.message).toBe('Invalid API key')
  })

  test('Bearer with empty value returns 401', async () => {
    const res = await app.request('/probe', {
      headers: { Authorization: 'Bearer ' },
    })
    expect(res.status).toBe(401)
  })
})
