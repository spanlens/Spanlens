import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * /cron/self-monitor unit tests.
 *
 * The watchdog has three branches the production failure modes hinge on:
 *
 *   1. Auth gate (CRON_SECRET) — fail-closed. Without this guard the
 *      endpoint would be a public crontab inspector.
 *
 *   2. No failures in the last hour — return early without writing
 *      an alert. Writing on every quiet run would train the operator
 *      to ignore the queue.
 *
 *   3. Failures exist + no unresolved cron_failure alert — insert
 *      exactly one alert with per-job breakdown. Dedup: if an
 *      unresolved cron_failure alert already exists, skip the insert
 *      so a single broken cron firing every 5 minutes does not flood
 *      /settings/alerts.
 */

const cronJobRunsQueryMock = vi.fn()
const internalAlertsSelectMock = vi.fn()
const internalAlertsInsertMock = vi.fn()
const logCronRunMock = vi.fn()

// supabaseAdmin.from(table)... — return different chains for the two tables we touch.
vi.mock('../lib/db.js', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'cron_job_runs') {
        return {
          select: () => ({
            eq: () => ({
              gte: () => ({
                order: (..._args: unknown[]) => cronJobRunsQueryMock(),
              }),
            }),
          }),
        }
      }
      if (table === 'internal_alerts') {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                limit: () => ({
                  maybeSingle: () => internalAlertsSelectMock(),
                }),
              }),
            }),
          }),
          insert: (payload: unknown) => internalAlertsInsertMock(payload),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  },
}))

vi.mock('../lib/clickhouse.js', () => ({
  getClickhouse: () => ({ query: () => Promise.resolve({ json: () => [] }), ping: async () => ({ success: true }) }),
  getOrgClickhouse: () => ({ query: () => Promise.resolve({ json: () => [] }) }),
  pingClickhouse: async () => true,
}))

vi.mock('../lib/cron-logger.js', () => ({
  logCronRun: (...args: unknown[]) => {
    logCronRunMock(...args)
    return Promise.resolve()
  },
}))

// Other cron-route imports pull in real modules we don't need here.
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
  cronJobRunsQueryMock.mockReset()
  internalAlertsSelectMock.mockReset()
  internalAlertsInsertMock.mockReset()
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
    '/self-monitor',
    authHeader ? { headers: { Authorization: authHeader } } : {},
  )
}

describe('/cron/self-monitor', () => {
  test('rejects request without Bearer auth (401)', async () => {
    const res = await request()
    expect(res.status).toBe(401)
    expect(cronJobRunsQueryMock).not.toHaveBeenCalled()
    expect(internalAlertsInsertMock).not.toHaveBeenCalled()
  })

  test('rejects request with wrong secret (401)', async () => {
    const res = await request('Bearer wrong')
    expect(res.status).toBe(401)
    expect(cronJobRunsQueryMock).not.toHaveBeenCalled()
  })

  test('zero failures → no alert + failures=0', async () => {
    cronJobRunsQueryMock.mockResolvedValue({ data: [], error: null })

    const res = await request('Bearer test-secret')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; failures: number }
    expect(body.ok).toBe(true)
    expect(body.failures).toBe(0)
    expect(internalAlertsSelectMock).not.toHaveBeenCalled()
    expect(internalAlertsInsertMock).not.toHaveBeenCalled()
    expect(logCronRunMock).toHaveBeenCalledWith('self-monitor', 'ok', expect.any(Number))
  })

  test('failures exist + no existing unresolved alert → inserts exactly one alert with per-job breakdown', async () => {
    cronJobRunsQueryMock.mockResolvedValue({
      data: [
        { job_name: 'detect-missing-model-prices', status: 'error', error_message: 'ClickHouse timeout', ran_at: '2026-06-09T10:00:00Z' },
        { job_name: 'detect-missing-model-prices', status: 'error', error_message: 'ClickHouse timeout', ran_at: '2026-06-09T09:00:00Z' },
        { job_name: 'replay-fallback', status: 'error', error_message: 'Supabase 500', ran_at: '2026-06-09T09:30:00Z' },
      ],
      error: null,
    })
    internalAlertsSelectMock.mockResolvedValue({ data: null })
    internalAlertsInsertMock.mockResolvedValue({ error: null })

    const res = await request('Bearer test-secret')
    expect(res.status).toBe(200)

    expect(internalAlertsInsertMock).toHaveBeenCalledTimes(1)
    const payload = internalAlertsInsertMock.mock.calls[0]?.[0] as {
      kind: string
      severity: string
      message: string
      details: { jobs: Array<{ job_name: string; count: number; last_error: string | null; last_ran_at: string }>; window_minutes: number }
    }
    expect(payload.kind).toBe('cron_failure')
    expect(payload.severity).toBe('error')
    expect(payload.message).toContain('2 cron job(s) failed')
    expect(payload.message).toContain('3 runs')
    expect(payload.details.window_minutes).toBe(60)
    expect(payload.details.jobs).toHaveLength(2)
    const dmmp = payload.details.jobs.find((j) => j.job_name === 'detect-missing-model-prices')
    expect(dmmp?.count).toBe(2)
    expect(dmmp?.last_error).toBe('ClickHouse timeout')
    const replay = payload.details.jobs.find((j) => j.job_name === 'replay-fallback')
    expect(replay?.count).toBe(1)
  })

  test('failures exist + unresolved cron_failure already present → skip insert (dedup)', async () => {
    cronJobRunsQueryMock.mockResolvedValue({
      data: [
        { job_name: 'detect-missing-model-prices', status: 'error', error_message: 'still broken', ran_at: '2026-06-09T10:00:00Z' },
      ],
      error: null,
    })
    internalAlertsSelectMock.mockResolvedValue({ data: { id: 'existing-alert-uuid' } })

    const res = await request('Bearer test-secret')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; deduped: boolean; existing_alert_id: string }
    expect(body.deduped).toBe(true)
    expect(body.existing_alert_id).toBe('existing-alert-uuid')
    expect(internalAlertsInsertMock).not.toHaveBeenCalled()
    expect(logCronRunMock).toHaveBeenCalledWith('self-monitor', 'ok', expect.any(Number))
  })

  test('cron_job_runs query error → 500 + logCronRun error', async () => {
    cronJobRunsQueryMock.mockResolvedValue({
      data: null,
      error: { message: 'connection refused' },
    })

    const res = await request('Bearer test-secret')
    expect(res.status).toBe(500)
    expect(internalAlertsInsertMock).not.toHaveBeenCalled()
    expect(logCronRunMock).toHaveBeenCalledWith(
      'self-monitor',
      'error',
      expect.any(Number),
      expect.stringContaining('cron_job_runs query failed'),
    )
  })

  test('internal_alerts insert fails → 500 + logCronRun error', async () => {
    cronJobRunsQueryMock.mockResolvedValue({
      data: [{ job_name: 'keep-warm', status: 'error', error_message: null, ran_at: '2026-06-09T10:00:00Z' }],
      error: null,
    })
    internalAlertsSelectMock.mockResolvedValue({ data: null })
    internalAlertsInsertMock.mockResolvedValue({
      error: { message: 'CHECK constraint violation' },
    })

    const res = await request('Bearer test-secret')
    expect(res.status).toBe(500)
    expect(logCronRunMock).toHaveBeenCalledWith(
      'self-monitor',
      'error',
      expect.any(Number),
      expect.stringContaining('insert failed'),
    )
  })
})
