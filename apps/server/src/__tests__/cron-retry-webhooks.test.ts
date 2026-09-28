import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * /cron/retry-webhooks route (XVERIFY C12.1).
 *
 * The route is fired every 5 minutes by vercel.json and cron-server.yml
 * (gotcha #32), so two properties matter here:
 *
 *   - A firing that lands right after a successful run is skipped by the
 *     cadence guard, and the guard's window stays shorter than the schedule
 *     so it never swallows a regular tick. Overlapping runs are made safe by
 *     the atomic claim in lib/webhook-dispatch.ts; this guard only saves the
 *     duplicate round trip.
 *   - A run that could not read the queue is recorded as `error`, never `ok`.
 *     Before the fix, a failed queue read resolved to all-zero counters and
 *     the run was logged as healthy while nothing was being retried.
 */

const retryMock = vi.fn()
const ranWithinMock = vi.fn()
const logCronRunMock = vi.fn()

vi.mock('../lib/db.js', () => ({ supabaseAdmin: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock('../lib/postgres.js', () => ({ pgQuery: vi.fn() }))
vi.mock('../lib/webhook-dispatch.js', () => ({
  retryFailedWebhooks: (...args: unknown[]) => retryMock(...args),
}))
vi.mock('../lib/cron-cadence.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/cron-cadence.js')>()),
  ranSuccessfullyWithin: (...args: unknown[]) => ranWithinMock(...args),
}))
vi.mock('../lib/cron-logger.js', () => ({
  logCronRun: (...args: unknown[]) => {
    logCronRunMock(...args)
    return Promise.resolve()
  },
}))

// Other cron-route imports pull in real modules this suite does not need.
vi.mock('../lib/notifiers.js', () => ({ deliverToChannel: vi.fn() }))
vi.mock('../lib/webhook-emit.js', () => ({ emitWebhookEvent: vi.fn() }))
vi.mock('../lib/paddle-usage.js', () => ({ computeAndReportOverages: vi.fn() }))
vi.mock('../lib/quota-warnings.js', () => ({ runQuotaWarningsJob: vi.fn() }))
vi.mock('../lib/anomaly-snapshot.js', () => ({ snapshotAnomaliesForAllOrgs: vi.fn() }))
vi.mock('../lib/stale-key-digest.js', () => ({ runStaleKeyDigestJob: vi.fn() }))
vi.mock('../lib/background-migrations/runner.js', () => ({ runDueMigrations: vi.fn() }))
vi.mock('../lib/leak-detection.js', () => ({ runLeakDetectionJob: vi.fn() }))
vi.mock('../lib/recommendation-notify.js', () => ({ sendHighConfidenceRecommendationAlerts: vi.fn() }))
vi.mock('../lib/fallback-replay.js', () => ({ replayFallbackQueue: vi.fn() }))
vi.mock('../lib/billing-downgrade.js', () => ({ runDowngradeCheck: vi.fn() }))
vi.mock('../api/pendingDeletions.js', () => ({ executePendingDeletions: vi.fn() }))

let cronRouter: typeof import('../api/cron.js').cronRouter
const origSecret = process.env['CRON_SECRET']

const RESULT = {
  retried: 3,
  succeeded: 2,
  failed: 1,
  exhausted: 0,
  skipped: 0,
  deadlineReached: false,
}

beforeEach(async () => {
  vi.resetModules()
  retryMock.mockReset().mockResolvedValue(RESULT)
  ranWithinMock.mockReset().mockResolvedValue(false)
  logCronRunMock.mockReset()
  process.env['CRON_SECRET'] = 'test-secret'
  ;({ cronRouter } = await import('../api/cron.js'))
})

afterEach(() => {
  if (origSecret === undefined) delete process.env['CRON_SECRET']
  else process.env['CRON_SECRET'] = origSecret
})

function hit(auth = 'Bearer test-secret'): Promise<Response> {
  return Promise.resolve(cronRouter.request('/retry-webhooks', { headers: { Authorization: auth } }))
}

describe('/cron/retry-webhooks', () => {
  test('rejects a caller without the cron secret', async () => {
    const res = await hit('Bearer wrong')
    expect(res.status).toBe(401)
    expect(retryMock).not.toHaveBeenCalled()
  })

  test('runs the retry job and records an ok run', async () => {
    const res = await hit()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, ...RESULT })
    expect(retryMock).toHaveBeenCalledTimes(1)
    expect(logCronRunMock).toHaveBeenCalledWith('retry-webhooks', 'ok', expect.any(Number))
  })

  test('a firing right after a successful run is skipped without touching the queue', async () => {
    ranWithinMock.mockResolvedValue(true)

    const res = await hit()

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, skipped: 'cadence', job: 'retry-webhooks' })
    expect(retryMock).not.toHaveBeenCalled()
    expect(logCronRunMock).not.toHaveBeenCalled()
  })

  test('the cadence window is shorter than the 5-minute schedule', async () => {
    await hit()

    const [job, minutes] = ranWithinMock.mock.calls[0] as [string, number]
    expect(job).toBe('retry-webhooks')
    expect(minutes).toBeGreaterThan(0)
    expect(minutes).toBeLessThan(5)
  })

  test('a failed queue claim is recorded as an error run, not ok', async () => {
    retryMock.mockRejectedValue(new Error('Webhook retry queue claim failed: connection reset'))

    const res = await hit()

    expect(res.status).toBe(500)
    expect(logCronRunMock).toHaveBeenCalledWith(
      'retry-webhooks',
      'error',
      expect.any(Number),
      'Webhook retry queue claim failed: connection reset',
    )
    expect(logCronRunMock).not.toHaveBeenCalledWith('retry-webhooks', 'ok', expect.anything())
  })
})
