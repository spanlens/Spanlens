import { describe, expect, test, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { _clearAuthCacheForTests } from '../middleware/authJwt.js'
import { _clearApiKeyCacheForTests } from '../middleware/authApiKey.js'
import { installOnError } from './helpers/install-on-error.js'

/**
 * GET /api/v1/dashboard/summary — the composite read that replaced the
 * dashboard's per-panel client fan-out.
 *
 * Three things are worth pinning here, and they are exactly the three that
 * would be expensive to discover in production:
 *
 *   1. Orchestration — every dataset is delegated to the fetcher exported by
 *      the router that owns it, so the composite and the individual endpoint
 *      can never disagree about what a panel contains.
 *   2. Partial-failure degradation — one sick dataset resolves to `null` and
 *      the response stays 200 with the rest intact. A 500 here would blank
 *      panels whose data was fine.
 *   3. Auth — dual auth, so a `sl_live_pub_*` read key must NOT be rejected.
 *      Mounting requireFullScope on a read route is the standing trap.
 *
 * The per-dataset fetchers are mocked at the module boundary: their real
 * queries are covered by their own routes' tests, and mocking them keeps this
 * file focused on the composite's contract rather than on ClickHouse SQL.
 */

const FULL_KEY = 'sl_live_dashboardfullkey0123456789'
const PUBLIC_KEY = 'sl_live_pub_dashboardpublickey0123'
const JWT_TOKEN = 'fake-jwt-token-12345'

const FULL_HASH = 'dashboard-full-hash'
const PUBLIC_HASH = 'dashboard-public-hash'

// ── Fixtures ────────────────────────────────────────────────────

const ALERT = {
  id: 'alert-1',
  name: 'Budget guard',
  type: 'budget',
  threshold: 100,
  window_minutes: 60,
  cooldown_minutes: 60,
  is_active: true,
  last_triggered_at: null,
  project_id: null,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
}

const RECOMMENDATION = {
  currentProvider: 'openai',
  currentModel: 'gpt-4o',
  suggestedProvider: 'openai',
  suggestedModel: 'gpt-4o-mini',
  estimatedMonthlySavingsUsd: 42,
}

const AUDIT_ROW = {
  id: 'audit-1',
  action: 'key.created',
  resource_type: 'api_keys',
  resource_id: 'key-1',
  user_id: 'user-1',
  metadata: null,
  ip_address: null,
  created_at: '2026-08-10T12:00:00.000Z',
}

const PROMPT = { id: 'prompt-1', name: 'summarise', stats: { calls: 3, totalCostUsd: 0.5 } }
const SECURITY_ITEM = { type: 'pii', pattern: 'email', count: 2 }
const FORECAST = { monthToDate: 12.5, dayOfMonth: 11, daysInMonth: 31 }

// ── Mocks: per-dataset fetchers ─────────────────────────────────
//
// Paths are written relative to THIS file; Vitest matches on the resolved
// module id, so `../api/alerts.js` here is the same module dashboard.ts
// imports as `./alerts.js`. A mock factory that omits the symbol
// dashboard.ts actually imports fails loudly, which is the point.

const fetchAlerts = vi.hoisted(() => vi.fn())
const recommendModelSwaps = vi.hoisted(() => vi.fn())
const fetchAuditLogs = vi.hoisted(() => vi.fn())
const fetchPromptsWithStats = vi.hoisted(() => vi.fn())
const fetchSecuritySummary = vi.hoisted(() => vi.fn())
const computeSpendForecast = vi.hoisted(() => vi.fn())

vi.mock('../api/alerts.js', () => ({ fetchAlerts }))
vi.mock('../api/auditLogs.js', () => ({ fetchAuditLogs }))
vi.mock('../api/prompts.js', () => ({ fetchPromptsWithStats }))
vi.mock('../api/security.js', () => ({ fetchSecuritySummary }))
vi.mock('../api/stats.js', () => ({ computeSpendForecast }))
vi.mock('../lib/model-recommend.js', () => ({ recommendModelSwaps }))

// ── Mocks: auth layer (same shape as require-edit-dual-auth.test.ts) ──

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
      // authApiKey stamps `last_used_at` through fireAndForget after a key
      // authenticates. It swallows its own failures, but without this stub
      // every API-key test prints a background-task stack trace.
      update: (_values: unknown) => ({ eq: async () => ({ error: null }) }),
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

const { dashboardRouter } = await import('../api/dashboard.js')

interface SummaryBody {
  success: boolean
  data: {
    alerts: unknown[] | null
    recommendations: unknown[] | null
    auditLogs: unknown[] | null
    prompts: unknown[] | null
    securitySummary: unknown[] | null
    spendForecast: unknown | null
  }
  meta: {
    hours: number
    auditLimit: number
    minSavingsUsd: number
    promptSinceHours: number
    degraded: string[]
  }
}

function buildApp() {
  const app = new Hono()
  app.route('/api/v1/dashboard', dashboardRouter)
  installOnError(app)
  return app
}

function get(path: string, token = JWT_TOKEN) {
  return buildApp().request(path, { headers: { Authorization: `Bearer ${token}` } })
}

/** Every fetcher resolves with its happy-path fixture. */
function stubAllOk() {
  fetchAlerts.mockResolvedValue([ALERT])
  recommendModelSwaps.mockResolvedValue([RECOMMENDATION])
  fetchAuditLogs.mockResolvedValue({ rows: [AUDIT_ROW], total: 1 })
  fetchPromptsWithStats.mockResolvedValue([PROMPT])
  fetchSecuritySummary.mockResolvedValue({ summary: [SECURITY_ITEM], totalFlags: 2 })
  computeSpendForecast.mockResolvedValue(FORECAST)
}

beforeEach(() => {
  _clearAuthCacheForTests()
  _clearApiKeyCacheForTests()
  jwtRole = 'admin'
  vi.clearAllMocks()
  stubAllOk()
})

// ── Success ─────────────────────────────────────────────────────

describe('GET /api/v1/dashboard/summary — success', () => {
  test('returns all six datasets in one response with nothing degraded', async () => {
    const res = await get('/api/v1/dashboard/summary')
    expect(res.status).toBe(200)

    const body = (await res.json()) as SummaryBody
    expect(body.success).toBe(true)
    expect(body.data.alerts).toEqual([ALERT])
    expect(body.data.recommendations).toEqual([RECOMMENDATION])
    expect(body.data.auditLogs).toEqual([AUDIT_ROW])
    expect(body.data.prompts).toEqual([PROMPT])
    expect(body.data.securitySummary).toEqual([SECURITY_ITEM])
    expect(body.data.spendForecast).toEqual(FORECAST)
    expect(body.meta.degraded).toEqual([])
  })

  test('scopes every fetcher to the caller org resolved by auth', async () => {
    await get('/api/v1/dashboard/summary')
    expect(fetchAlerts).toHaveBeenCalledWith('org-from-jwt')
    expect(recommendModelSwaps).toHaveBeenCalledWith('org-from-jwt', expect.anything())
    expect(fetchAuditLogs).toHaveBeenCalledWith('org-from-jwt', expect.anything())
    expect(fetchPromptsWithStats).toHaveBeenCalledWith('org-from-jwt', expect.anything())
    expect(fetchSecuritySummary).toHaveBeenCalledWith('org-from-jwt', expect.anything())
    expect(computeSpendForecast).toHaveBeenCalledWith('org-from-jwt')
  })

  test('applies documented defaults: 24h window, 6 audit rows, $5 min savings', async () => {
    const res = await get('/api/v1/dashboard/summary')
    const body = (await res.json()) as SummaryBody
    expect(body.meta).toMatchObject({
      hours: 24,
      auditLimit: 6,
      minSavingsUsd: 5,
      promptSinceHours: 24,
    })
    expect(recommendModelSwaps).toHaveBeenCalledWith('org-from-jwt', {
      hours: 24,
      minSavingsUsd: 5,
    })
    expect(fetchAuditLogs).toHaveBeenCalledWith('org-from-jwt', { limit: 6, offset: 0 })
    expect(fetchSecuritySummary).toHaveBeenCalledWith('org-from-jwt', 24)
  })

  test('threads hours / auditLimit / minSavings from the query string', async () => {
    const res = await get('/api/v1/dashboard/summary?hours=168&auditLimit=20&minSavings=12')
    const body = (await res.json()) as SummaryBody
    expect(body.meta).toMatchObject({ hours: 168, auditLimit: 20, minSavingsUsd: 12 })
    expect(recommendModelSwaps).toHaveBeenCalledWith('org-from-jwt', {
      hours: 168,
      minSavingsUsd: 12,
    })
    expect(fetchAuditLogs).toHaveBeenCalledWith('org-from-jwt', { limit: 20, offset: 0 })
    expect(fetchSecuritySummary).toHaveBeenCalledWith('org-from-jwt', 168)
  })

  test('clamps the security window to 720h like the standalone endpoint', async () => {
    await get('/api/v1/dashboard/summary?hours=2000')
    expect(fetchSecuritySummary).toHaveBeenCalledWith('org-from-jwt', 720)
  })

  test('floors the security window at 1h so a sub-hour range is not empty', async () => {
    // getSecuritySummary interpolates an integer INTERVAL — rounding 0.4 down
    // to 0 would return an empty window rather than a short one.
    await get('/api/v1/dashboard/summary?hours=0.4')
    expect(fetchSecuritySummary).toHaveBeenCalledWith('org-from-jwt', 1)
  })

  test('caps auditLimit at 200 so a caller cannot page the whole audit trail', async () => {
    const res = await get('/api/v1/dashboard/summary?auditLimit=5000')
    const body = (await res.json()) as SummaryBody
    expect(body.meta.auditLimit).toBe(200)
    expect(fetchAuditLogs).toHaveBeenCalledWith('org-from-jwt', { limit: 200, offset: 0 })
  })

  test('an empty dataset stays [] and is NOT reported as degraded', async () => {
    // The whole point of the null-on-failure convention: "no alerts" and
    // "alerts lookup exploded" must be distinguishable by the client.
    fetchAlerts.mockResolvedValue([])
    const res = await get('/api/v1/dashboard/summary')
    const body = (await res.json()) as SummaryBody
    expect(body.data.alerts).toEqual([])
    expect(body.meta.degraded).toEqual([])
  })
})

// ── Partial failure ─────────────────────────────────────────────

describe('GET /api/v1/dashboard/summary — partial failure', () => {
  test('one failing dataset degrades to null while the rest still render', async () => {
    fetchSecuritySummary.mockRejectedValue(new Error('ClickHouse unreachable'))

    const res = await get('/api/v1/dashboard/summary')
    // Still 200: a 500 would blank five panels that had good data.
    expect(res.status).toBe(200)

    const body = (await res.json()) as SummaryBody
    expect(body.data.securitySummary).toBeNull()
    expect(body.meta.degraded).toEqual(['securitySummary'])
    expect(body.data.alerts).toEqual([ALERT])
    expect(body.data.recommendations).toEqual([RECOMMENDATION])
    expect(body.data.auditLogs).toEqual([AUDIT_ROW])
    expect(body.data.prompts).toEqual([PROMPT])
    expect(body.data.spendForecast).toEqual(FORECAST)
  })

  test('a second failure is isolated too, and degraded keeps a stable order', async () => {
    fetchAlerts.mockRejectedValue(new Error('postgres down'))
    computeSpendForecast.mockRejectedValue(new Error('clickhouse timeout'))

    const res = await get('/api/v1/dashboard/summary')
    expect(res.status).toBe(200)

    const body = (await res.json()) as SummaryBody
    expect(body.data.alerts).toBeNull()
    expect(body.data.spendForecast).toBeNull()
    // Declaration order, not rejection order — the list must not depend on
    // which promise happened to lose the race.
    expect(body.meta.degraded).toEqual(['alerts', 'spendForecast'])
    expect(body.data.prompts).toEqual([PROMPT])
  })

  test('every dataset failing still returns 200 with a fully null payload', async () => {
    const boom = () => Promise.reject(new Error('everything is on fire'))
    fetchAlerts.mockImplementation(boom)
    recommendModelSwaps.mockImplementation(boom)
    fetchAuditLogs.mockImplementation(boom)
    fetchPromptsWithStats.mockImplementation(boom)
    fetchSecuritySummary.mockImplementation(boom)
    computeSpendForecast.mockImplementation(boom)

    const res = await get('/api/v1/dashboard/summary')
    expect(res.status).toBe(200)

    const body = (await res.json()) as SummaryBody
    expect(body.data).toEqual({
      alerts: null,
      recommendations: null,
      auditLogs: null,
      prompts: null,
      securitySummary: null,
      spendForecast: null,
    })
    expect(body.meta.degraded).toEqual([
      'alerts',
      'recommendations',
      'auditLogs',
      'prompts',
      'securitySummary',
      'spendForecast',
    ])
  })

  test('a slow-failing dataset does not prevent the others from resolving', async () => {
    // Guards the Promise.all shape: a rejection swallowed per-dataset must not
    // short-circuit the batch.
    fetchPromptsWithStats.mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error('slow boom')), 10)),
    )
    const res = await get('/api/v1/dashboard/summary')
    const body = (await res.json()) as SummaryBody
    expect(body.data.prompts).toBeNull()
    expect(body.data.alerts).toEqual([ALERT])
    expect(body.meta.degraded).toEqual(['prompts'])
  })
})

// ── Auth ────────────────────────────────────────────────────────

describe('GET /api/v1/dashboard/summary — auth', () => {
  test('rejects an unauthenticated request', async () => {
    const res = await buildApp().request('/api/v1/dashboard/summary')
    expect(res.status).toBe(401)
    expect(fetchAlerts).not.toHaveBeenCalled()
  })

  test('rejects a bogus bearer token', async () => {
    const res = await get('/api/v1/dashboard/summary', 'not-a-real-token')
    expect(res.status).toBe(401)
    expect(fetchAlerts).not.toHaveBeenCalled()
  })

  test('accepts a full sl_live_ key and scopes to its org', async () => {
    const res = await get('/api/v1/dashboard/summary', FULL_KEY)
    expect(res.status).toBe(200)
    expect(fetchAlerts).toHaveBeenCalledWith('org-full')
  })

  test('accepts a public sl_live_pub_ read key — this is a READ route', async () => {
    // Regression guard: mounting requireFullScope here would 403 every MCP /
    // BI / embed caller. Read routes take authJwtOrApiKey and nothing else.
    const res = await get('/api/v1/dashboard/summary', PUBLIC_KEY)
    expect(res.status).toBe(200)
    expect(fetchAlerts).toHaveBeenCalledWith('org-public')
  })

  test('a viewer JWT can read — no role gate on a read route', async () => {
    jwtRole = 'viewer'
    const res = await get('/api/v1/dashboard/summary')
    expect(res.status).toBe(200)
  })
})

// ── Mount order ─────────────────────────────────────────────────

describe('dashboardRouter mount position in app.ts', () => {
  test('is mounted above the /api/v1 wildcard routers', async () => {
    const { readFile } = await import('node:fs/promises')
    const { fileURLToPath } = await import('node:url')
    const source = await readFile(fileURLToPath(new URL('../app.ts', import.meta.url)), 'utf8')

    const dashboardAt = source.indexOf("app.route('/api/v1/dashboard'")
    const evalsAt = source.indexOf("app.route('/api/v1',                evalsRouter)")

    expect(dashboardAt).toBeGreaterThan(-1)
    expect(evalsAt).toBeGreaterThan(-1)
    // Below the wildcards, evalsRouter's `.use('*', authJwt)` would intercept
    // this dual-auth route and 401 every sl_live_* caller before its own
    // middleware ran — the recommendations (2026-06-04) failure mode.
    expect(dashboardAt).toBeLessThan(evalsAt)
  })
})
