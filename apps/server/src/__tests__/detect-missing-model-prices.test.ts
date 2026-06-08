import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * R-Q2 — /cron/detect-missing-model-prices unit tests.
 *
 * The cron handler is the entry point for the operator-facing alert when
 * `model_prices` falls behind a new model release (gotcha #2). Three
 * branches must be exercised because each has a different production
 * failure mode:
 *
 *   1. Auth gate (CRON_SECRET) — fail-closed. If a refactor accidentally
 *      removed the assertion, the endpoint becomes a tenant-blind
 *      ClickHouse query open to the public internet.
 *
 *   2. Empty result (zero models exceed the 100/hour threshold) — must
 *      NOT insert an internal_alerts row. Spurious alerts train the
 *      operator to ignore the queue.
 *
 *   3. Non-empty result — exactly one alert row per run, with the
 *      per-model breakdown in `details`. We don't dedupe against
 *      unresolved alerts of the same kind (see cron.ts comment) so a
 *      still-broken seed keeps re-firing until the operator fixes it.
 */

const supabaseInsertMock = vi.fn()
const clickhouseQueryMock = vi.fn()
const logCronRunMock = vi.fn()

vi.mock('../lib/db.js', () => ({
  supabaseAdmin: {
    from: (_table: string) => ({
      insert: (payload: unknown) => supabaseInsertMock(payload),
    }),
  },
}))

vi.mock('../lib/clickhouse.js', () => ({
  unscopedClickhouse: () => ({
    query: (opts: unknown) => clickhouseQueryMock(opts),
  }),
  getOrgClickhouse: () => ({ query: () => Promise.resolve({ json: () => [] }) }),
}))

vi.mock('../lib/cron-logger.js', () => ({
  logCronRun: (...args: unknown[]) => {
    logCronRunMock(...args)
    return Promise.resolve()
  },
}))

// Other cron-route imports pull in real modules we don't need here.
// Mocking them keeps the cron.ts module-load side-effect-free.
vi.mock('../lib/notifiers.js', () => ({ deliverToChannel: vi.fn() }))
vi.mock('../lib/webhook-emit.js', () => ({ emitWebhookEvent: vi.fn() }))
vi.mock('../lib/webhook-dispatch.js', () => ({ retryFailedWebhooks: vi.fn() }))
vi.mock('../lib/paddle-usage.js', () => ({ computeAndReportOverages: vi.fn() }))
vi.mock('../lib/quota-warnings.js', () => ({ runQuotaWarningsJob: vi.fn() }))
vi.mock('../lib/anomaly-snapshot.js', () => ({ snapshotAnomaliesForAllOrgs: vi.fn() }))
vi.mock('../lib/stale-key-digest.js', () => ({ runStaleKeyDigestJob: vi.fn() }))
vi.mock('../lib/background-migrations/runner.js', () => ({ runDueMigrations: vi.fn() }))
vi.mock('../lib/events-reconciliation.js', () => ({ runReconciliationCron: vi.fn() }))
vi.mock('../lib/leak-detection.js', () => ({ runLeakDetectionJob: vi.fn() }))
vi.mock('../lib/recommendation-notify.js', () => ({ sendHighConfidenceRecommendationAlerts: vi.fn() }))
vi.mock('../lib/fallback-replay.js', () => ({
  replayFallbackQueue: vi.fn(),
  replayEventsFallbackQueue: vi.fn(),
}))
vi.mock('../lib/billing-downgrade.js', () => ({ runDowngradeCheck: vi.fn() }))
vi.mock('../api/pendingDeletions.js', () => ({ executePendingDeletions: vi.fn() }))

let cronRouter: typeof import('../api/cron.js').cronRouter
const origSecret = process.env['CRON_SECRET']

beforeEach(async () => {
  vi.resetModules()
  supabaseInsertMock.mockReset()
  clickhouseQueryMock.mockReset()
  logCronRunMock.mockReset()
  process.env['CRON_SECRET'] = 'test-secret'
  ;({ cronRouter } = await import('../api/cron.js'))
})

afterEach(() => {
  if (origSecret === undefined) delete process.env['CRON_SECRET']
  else process.env['CRON_SECRET'] = origSecret
})

function request(authHeader?: string) {
  return cronRouter.request(
    '/detect-missing-model-prices',
    authHeader ? { headers: { Authorization: authHeader } } : {},
  )
}

describe('R-Q2 — /cron/detect-missing-model-prices', () => {
  test('rejects request without Bearer auth (401)', async () => {
    const res = await request()
    expect(res.status).toBe(401)
    expect(supabaseInsertMock).not.toHaveBeenCalled()
    expect(clickhouseQueryMock).not.toHaveBeenCalled()
  })

  test('rejects request with wrong secret (401)', async () => {
    const res = await request('Bearer wrong')
    expect(res.status).toBe(401)
    expect(clickhouseQueryMock).not.toHaveBeenCalled()
  })

  test('fail-closed when CRON_SECRET unset', async () => {
    delete process.env['CRON_SECRET']
    vi.resetModules()
    ;({ cronRouter } = await import('../api/cron.js'))

    const res = await request('Bearer anything')
    expect(res.status).toBe(401)
  })

  test('zero missing models → no internal_alerts insert + missing=0', async () => {
    clickhouseQueryMock.mockResolvedValue({ json: async () => [] })

    const res = await request('Bearer test-secret')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; missing: number }
    expect(body.ok).toBe(true)
    expect(body.missing).toBe(0)
    expect(supabaseInsertMock).not.toHaveBeenCalled()
    expect(logCronRunMock).toHaveBeenCalledWith(
      'detect-missing-model-prices',
      'ok',
      expect.any(Number),
    )
  })

  test('non-empty result → inserts exactly one internal_alerts row with details', async () => {
    // ClickHouse JSONEachRow returns counts as STRINGS (gotcha #19).
    // Use that exact shape in the fixture to lock the type conversion.
    clickhouseQueryMock.mockResolvedValue({
      json: async () => [
        { model: 'gpt-4o-2026-11-01', missing_count: '512' },
        { model: 'claude-sonnet-5', missing_count: '187' },
      ],
    })
    supabaseInsertMock.mockResolvedValue({ error: null })

    const res = await request('Bearer test-secret')
    expect(res.status).toBe(200)

    expect(supabaseInsertMock).toHaveBeenCalledTimes(1)
    const payload = supabaseInsertMock.mock.calls[0]?.[0] as {
      kind: string
      severity: string
      message: string
      details: { models: Array<{ model: string; count: number }>; threshold: number }
    }
    expect(payload.kind).toBe('missing_model_prices')
    expect(payload.severity).toBe('warn')
    expect(payload.message).toContain('2 model(s) missing prices')
    expect(payload.message).toContain('699 rows') // 512 + 187
    expect(payload.details.threshold).toBe(100)
    // Confirm string → number conversion (gotcha #19).
    expect(payload.details.models).toEqual([
      { model: 'gpt-4o-2026-11-01', count: 512 },
      { model: 'claude-sonnet-5', count: 187 },
    ])
  })

  test('ClickHouse query throws → 500 + logCronRun error', async () => {
    clickhouseQueryMock.mockRejectedValue(new Error('ClickHouse unreachable'))

    const res = await request('Bearer test-secret')
    expect(res.status).toBe(500)
    expect(supabaseInsertMock).not.toHaveBeenCalled()
    expect(logCronRunMock).toHaveBeenCalledWith(
      'detect-missing-model-prices',
      'error',
      expect.any(Number),
      expect.stringContaining('ClickHouse unreachable'),
    )
  })

  test('internal_alerts insert fails → 500 + logCronRun error', async () => {
    clickhouseQueryMock.mockResolvedValue({
      json: async () => [{ model: 'gpt-9', missing_count: '200' }],
    })
    supabaseInsertMock.mockResolvedValue({
      error: { message: 'duplicate key value violates unique constraint' },
    })

    const res = await request('Bearer test-secret')
    expect(res.status).toBe(500)
    expect(logCronRunMock).toHaveBeenCalledWith(
      'detect-missing-model-prices',
      'error',
      expect.any(Number),
      expect.stringContaining('insert failed'),
    )
  })
})
