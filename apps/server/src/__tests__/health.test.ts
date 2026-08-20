import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * R-22 /health, /health/ready, /health/deep tests.
 *
 * The three endpoints have distinct failure modes the tests pin down:
 *
 *   /health
 *     - Always 200, even when every dependency is down (it's liveness).
 *     - Must include `version` so on-call can correlate dashboards with the
 *       deployed commit. version=null in local/test (no VERCEL_GIT_COMMIT_SHA).
 *
 *   /health/ready
 *     - 200 only when BOTH routes to Postgres are up. The server reaches the
 *       same database two ways: PostgREST over HTTPS for row-shaped CRUD,
 *       and a pooled connection through Supavisor for the analytics on
 *       `requests`. Either can fail on its own — an exhausted pooler, a bad
 *       connection string, a network path that only affects port 6543 — so
 *       probing one and calling it healthy would miss half the product.
 *     - 503 when either is down — so docker / load balancer routes around
 *       half-broken instances.
 *     - Upstash absent (KV_REST_API_URL unset) is *not* a failure — local
 *       dev runs without it. Reported as 'skipped'.
 *     - Upstash configured but unreachable IS a failure (latent customer
 *       impact via prompt-cache misses → cascading slowness).
 *
 *   /health/deep
 *     - Adds R-11 entry-trigger metrics: crons.max_runtime_ms and
 *       webhooks.backlog_count. Each must surface its actual value when the
 *       query succeeds, and `null` (not a fake 0) when the query itself
 *       failed. The null-vs-0 distinction is what lets operators tell
 *       "Supabase is broken" apart from "the queue is genuinely empty."
 *     - 503 when the pooled connection is unreachable. The Supabase failures
 *       for the new metrics do NOT 503 — they degrade to null so a single
 *       bad aggregate query doesn't take the whole monitor down.
 *
 * `pingPostgres()` reports failure in its return value rather than throwing,
 * so the mock below resolves `{ ok, latencyMs }` shapes rather than booleans.
 * A probe that threw instead would be indistinguishable from a bug in the
 * handler, which is why the real one does not.
 */

const supabaseAdminMock = {
  from: vi.fn(),
}
const pingPostgresMock = vi.fn()
const fallbackQueueSizeMock = vi.fn()
const getRedisMock = vi.fn()

vi.mock('../lib/db.js', () => ({
  supabaseAdmin: supabaseAdminMock,
}))

vi.mock('../lib/postgres.js', () => ({
  pingPostgres: () => pingPostgresMock(),
}))

vi.mock('../lib/fallback-replay.js', () => ({
  fallbackQueueSize: () => fallbackQueueSizeMock(),
}))

vi.mock('../lib/prompt-cache.js', () => ({
  getRedis: () => getRedisMock(),
}))

let healthRouter: typeof import('../api/health.js').healthRouter
const origVercelSha = process.env['VERCEL_GIT_COMMIT_SHA']

beforeEach(async () => {
  vi.resetModules()
  supabaseAdminMock.from.mockReset()
  pingPostgresMock.mockReset()
  fallbackQueueSizeMock.mockReset()
  getRedisMock.mockReset()
  delete process.env['VERCEL_GIT_COMMIT_SHA']
  ;({ healthRouter } = await import('../api/health.js'))
})

afterEach(() => {
  if (origVercelSha !== undefined) process.env['VERCEL_GIT_COMMIT_SHA'] = origVercelSha
})

// --- helpers for the supabase chain --------------------------------------
// /health/deep makes two distinct calls to supabaseAdmin.from. Each chain
// has its own shape — we drive them with these factory helpers so the
// individual tests stay readable.

function pgReadyOk() {
  // The .from('organizations').select(..., head: true).limit(1) chain used
  // by /health/ready. Resolves with `{ error: null }` on success.
  return {
    select: () => ({
      limit: () => Promise.resolve({ error: null }),
    }),
  }
}

function pgReadyFail() {
  return {
    select: () => ({
      limit: () => Promise.resolve({ error: { message: 'db down' } }),
    }),
  }
}

function pgDeepCronChain(maxDuration: number | null) {
  return {
    select: () => ({
      gte: () => ({
        order: () => ({
          limit: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: maxDuration === null ? null : { duration_ms: maxDuration },
                error: null,
              }),
          }),
        }),
      }),
    }),
  }
}

function pgDeepCronChainError() {
  return {
    select: () => ({
      gte: () => ({
        order: () => ({
          limit: () => ({
            maybeSingle: () => Promise.reject(new Error('cron query failed')),
          }),
        }),
      }),
    }),
  }
}

// /health/deep queries webhook_deliveries TWICE:
//   backlog: .select().eq().not().lt()   (deliveries past their retry window)
//   dlq:     .select().not()             (permanently dead-lettered)
// The single mock object must satisfy both — .select() exposes `eq` (backlog)
// and `not` (dlq).
function pgDeepWebhookChain(backlog: number, dlq = 0) {
  return {
    select: () => ({
      eq: () => ({
        not: () => ({
          lt: () => Promise.resolve({ count: backlog, error: null }),
        }),
      }),
      not: () => Promise.resolve({ count: dlq, error: null }),
    }),
  }
}

function pgDeepWebhookChainError() {
  return {
    select: () => ({
      eq: () => ({
        not: () => ({
          lt: () => Promise.reject(new Error('webhook query failed')),
        }),
      }),
      not: () => Promise.reject(new Error('webhook dlq query failed')),
    }),
  }
}

// Backlog resolves, but the dlq count query itself fails → dlq_count must be
// null (not a fake 0), same null-vs-0 convention as the other deep metrics.
function pgDeepWebhookChainDlqError(backlog: number) {
  return {
    select: () => ({
      eq: () => ({
        not: () => ({
          lt: () => Promise.resolve({ count: backlog, error: null }),
        }),
      }),
      not: () => Promise.reject(new Error('webhook dlq query failed')),
    }),
  }
}

// /health/deep calls supabaseAdmin.from twice — first 'cron_job_runs',
// then 'webhook_deliveries'. Route by table name.
function wireDeepFroms(cronChain: unknown, webhookChain: unknown) {
  supabaseAdminMock.from.mockImplementation((table: string) => {
    if (table === 'cron_job_runs') return cronChain
    if (table === 'webhook_deliveries') return webhookChain
    throw new Error(`unexpected table: ${table}`)
  })
}

describe('GET /health', () => {
  test('always 200 with version=null when VERCEL_GIT_COMMIT_SHA is unset', async () => {
    const res = await healthRouter.request('/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; version: string | null }
    expect(body.status).toBe('ok')
    expect(body.version).toBeNull()
  })

  test('surfaces VERCEL_GIT_COMMIT_SHA when set', async () => {
    process.env['VERCEL_GIT_COMMIT_SHA'] = 'abc1234'
    // Re-import so the module captures the new env at evaluation time.
    vi.resetModules()
    ;({ healthRouter } = await import('../api/health.js'))

    const res = await healthRouter.request('/health')
    const body = (await res.json()) as { version: string }
    expect(body.version).toBe('abc1234')
  })
})

describe('GET /health/ready', () => {
  test('200 when both Postgres routes are OK and Upstash is skipped (no env)', async () => {
    supabaseAdminMock.from.mockReturnValue(pgReadyOk())
    pingPostgresMock.mockResolvedValue({ ok: true, latencyMs: 3 })
    getRedisMock.mockReturnValue(null)

    const res = await healthRouter.request('/health/ready')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      status: string
      checks: { postgres: { ok: boolean }; postgresPool: { ok: boolean }; redis: { status: string } }
    }
    expect(body.status).toBe('ok')
    expect(body.checks.postgres.ok).toBe(true)
    expect(body.checks.postgresPool.ok).toBe(true)
    expect(body.checks.redis.status).toBe('skipped')
  })

  test('200 when Upstash configured + ping resolves', async () => {
    supabaseAdminMock.from.mockReturnValue(pgReadyOk())
    pingPostgresMock.mockResolvedValue({ ok: true, latencyMs: 3 })
    getRedisMock.mockReturnValue({ ping: async () => 'PONG' })

    const res = await healthRouter.request('/health/ready')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { checks: { redis: { status: string } } }
    expect(body.checks.redis.status).toBe('ok')
  })

  test('503 when Postgres is down', async () => {
    supabaseAdminMock.from.mockReturnValue(pgReadyFail())
    pingPostgresMock.mockResolvedValue({ ok: true, latencyMs: 3 })
    getRedisMock.mockReturnValue(null)

    const res = await healthRouter.request('/health/ready')
    expect(res.status).toBe(503)
    const body = (await res.json()) as { status: string; checks: { postgres: { ok: boolean } } }
    expect(body.status).toBe('degraded')
    expect(body.checks.postgres.ok).toBe(false)
  })

  test('503 when the pooled Postgres connection is down', async () => {
    supabaseAdminMock.from.mockReturnValue(pgReadyOk())
    pingPostgresMock.mockResolvedValue({ ok: false, latencyMs: 12, error: 'pooler unreachable' })
    getRedisMock.mockReturnValue(null)

    const res = await healthRouter.request('/health/ready')
    expect(res.status).toBe(503)
    const body = (await res.json()) as { checks: { postgresPool: { ok: boolean } } }
    expect(body.checks.postgresPool.ok).toBe(false)
  })

  test('503 when Upstash configured but ping fails (cascading slowness risk)', async () => {
    supabaseAdminMock.from.mockReturnValue(pgReadyOk())
    pingPostgresMock.mockResolvedValue({ ok: true, latencyMs: 3 })
    getRedisMock.mockReturnValue({ ping: async () => { throw new Error('redis down') } })

    const res = await healthRouter.request('/health/ready')
    expect(res.status).toBe(503)
    const body = (await res.json()) as { checks: { redis: { status: string } } }
    expect(body.checks.redis.status).toBe('fail')
  })
})

describe('GET /health/deep', () => {
  beforeEach(() => {
    fallbackQueueSizeMock.mockResolvedValue(0)
    })

  test('200 with new R-11 metrics surfaced', async () => {
    pingPostgresMock.mockResolvedValue({ ok: true, latencyMs: 3 })
    wireDeepFroms(pgDeepCronChain(1234), pgDeepWebhookChain(5, 3))

    const res = await healthRouter.request('/health/deep')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      status: string
      version: string | null
      crons: { max_runtime_ms: number | null }
      webhooks: { backlog_count: number | null; dlq_count: number | null }
      postgresPool: { ok: boolean; latencyMs: number }
      fallback: { queue: number | null }
    }
    expect(body.status).toBe('ok')
    expect(body.version).toBeNull()
    expect(body.crons.max_runtime_ms).toBe(1234)
    expect(body.webhooks.backlog_count).toBe(5)
    expect(body.webhooks.dlq_count).toBe(3)
    expect(body.postgresPool.ok).toBe(true)
    expect(body.fallback.queue).toBe(0)
  })

  test('webhooks.dlq_count = null when the dlq count query fails', async () => {
    pingPostgresMock.mockResolvedValue({ ok: true, latencyMs: 3 })
    wireDeepFroms(pgDeepCronChain(500), pgDeepWebhookChainDlqError(2))

    const res = await healthRouter.request('/health/deep')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      webhooks: { backlog_count: number | null; dlq_count: number | null }
    }
    expect(body.webhooks.backlog_count).toBe(2)
    expect(body.webhooks.dlq_count).toBeNull()
  })

  test('crons.max_runtime_ms = null when cron query fails (degrades, does not 503)', async () => {
    pingPostgresMock.mockResolvedValue({ ok: true, latencyMs: 3 })
    wireDeepFroms(pgDeepCronChainError(), pgDeepWebhookChain(0))

    const res = await healthRouter.request('/health/deep')
    expect(res.status).toBe(200) // Supabase failure on the new query does not 503
    const body = (await res.json()) as { crons: { max_runtime_ms: number | null } }
    expect(body.crons.max_runtime_ms).toBeNull()
  })

  test('webhooks.backlog_count = null when webhook query fails', async () => {
    pingPostgresMock.mockResolvedValue({ ok: true, latencyMs: 3 })
    wireDeepFroms(pgDeepCronChain(500), pgDeepWebhookChainError())

    const res = await healthRouter.request('/health/deep')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { webhooks: { backlog_count: number | null } }
    expect(body.webhooks.backlog_count).toBeNull()
  })

  test('crons.max_runtime_ms = null when no rows in last 24h (cold env)', async () => {
    pingPostgresMock.mockResolvedValue({ ok: true, latencyMs: 3 })
    wireDeepFroms(pgDeepCronChain(null), pgDeepWebhookChain(0))

    const res = await healthRouter.request('/health/deep')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { crons: { max_runtime_ms: number | null } }
    expect(body.crons.max_runtime_ms).toBeNull()
  })

  test('503 when the pooled Postgres connection is down (overall degraded)', async () => {
    pingPostgresMock.mockResolvedValue({ ok: false, latencyMs: 12, error: 'pooler unreachable' })
    wireDeepFroms(pgDeepCronChain(100), pgDeepWebhookChain(0))

    const res = await healthRouter.request('/health/deep')
    expect(res.status).toBe(503)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('degraded')
  })
})
