import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * evaluate-alerts × activity watermark.
 *
 * This is the behaviour the ClickHouse bill actually hinges on, so it gets a
 * real run of the job rather than a source check: when the watermark says an
 * org sent nothing inside an alert's window, the job must not issue the
 * ClickHouse query. Every 15 minutes, forever, that query was enough on its
 * own to hold ClickHouse Cloud out of its 15-minute idle window.
 *
 * Two things are pinned alongside it, because a cheaper bill is worthless if
 * it costs us a real alert:
 *
 *   - an active org is still queried and still fires
 *   - an unreadable watermark queries everything, exactly as before
 *
 * `orgActiveSince` is the real implementation here; only the Postgres read
 * is stubbed. The comparison logic is what decides whether an alert is
 * silently dropped, so it should not be mocked out of the test.
 */

const alertsResultMock = vi.fn()
const chQueryMock = vi.fn()
const getOrgActivitySinceMock = vi.fn()
const deliverToChannelMock = vi.fn()

/**
 * PostgREST chains are fluent and end wherever the caller stops, so the mock
 * is one object that returns itself from every builder method and resolves
 * to a per-table result when awaited. Matching each real chain shape by hand
 * makes the test break on unrelated query edits.
 */
function chainFor(table: string): Record<string, unknown> & PromiseLike<unknown> {
  const result = () =>
    table === 'alerts' && lastVerb === 'select'
      ? alertsResultMock()
      : { data: [], error: null }

  let lastVerb = ''
  const chain = new Proxy({} as Record<string, unknown>, {
    get(_t, prop: string) {
      if (prop === 'then') {
        return (onFulfilled: (v: unknown) => unknown) => Promise.resolve(result()).then(onFulfilled)
      }
      return (...args: unknown[]) => {
        if (prop === 'select' || prop === 'update' || prop === 'insert') lastVerb = prop
        void args
        return chain
      }
    },
  }) as Record<string, unknown> & PromiseLike<unknown>
  return chain
}

vi.mock('../lib/db.js', () => ({
  supabaseAdmin: { from: (table: string) => chainFor(table) },
}))

vi.mock('../lib/clickhouse.js', () => ({
  getOrgClickhouse: () => ({ client: { query: chQueryMock } }),
}))

vi.mock('../lib/notifiers.js', () => ({ deliverToChannel: deliverToChannelMock }))
vi.mock('../lib/webhook-emit.js', () => ({ emitWebhookEvent: vi.fn() }))
vi.mock('../lib/structured-logger.js', () => ({ logError: vi.fn() }))

vi.mock('../lib/org-activity.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/org-activity.js')>(
    '../lib/org-activity.js',
  )
  return { ...actual, getOrgActivitySince: getOrgActivitySinceMock }
})

const ORG = '00000000-0000-4000-8000-000000000001'

function budgetAlert(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alert-1',
    organization_id: ORG,
    project_id: null,
    name: 'monthly spend',
    type: 'budget',
    threshold: 10,
    window_minutes: 60,
    cooldown_minutes: 60,
    last_triggered_at: null,
    ...overrides,
  }
}

let runEvaluateAlertsJob: typeof import('../lib/cron-jobs/evaluate-alerts.js').runEvaluateAlertsJob

beforeEach(async () => {
  vi.resetModules()
  alertsResultMock.mockReset()
  chQueryMock.mockReset()
  getOrgActivitySinceMock.mockReset()
  deliverToChannelMock.mockReset()
  ;({ runEvaluateAlertsJob } = await import('../lib/cron-jobs/evaluate-alerts.js'))
})

describe('runEvaluateAlertsJob with the activity watermark', () => {
  test('does not touch ClickHouse when the org was silent through the window', async () => {
    alertsResultMock.mockReturnValue({ data: [budgetAlert()], error: null })
    // Last request two hours ago; the alert window is one hour.
    getOrgActivitySinceMock.mockResolvedValue(
      new Map([[ORG, Date.now() - 2 * 60 * 60 * 1000]]),
    )

    const result = await runEvaluateAlertsJob()

    expect(chQueryMock).not.toHaveBeenCalled()
    expect(result.report).toEqual([
      { alert_id: 'alert-1', fired: false, reason: 'under_threshold' },
    ])
  })

  test('does not touch ClickHouse when the org has never sent a request', async () => {
    alertsResultMock.mockReturnValue({ data: [budgetAlert()], error: null })
    getOrgActivitySinceMock.mockResolvedValue(new Map())

    await runEvaluateAlertsJob()

    expect(chQueryMock).not.toHaveBeenCalled()
  })

  test('still queries and fires for an org active inside the window', async () => {
    alertsResultMock.mockReturnValue({ data: [budgetAlert()], error: null })
    getOrgActivitySinceMock.mockResolvedValue(new Map([[ORG, Date.now() - 60_000]]))
    chQueryMock.mockResolvedValue({ json: async () => [{ total: '42.5' }] })

    const result = await runEvaluateAlertsJob()

    expect(chQueryMock).toHaveBeenCalledTimes(1)
    // The metric came back over threshold, so the alert reached the delivery
    // phase. Delivery itself is out of scope here — this fixture configures
    // no notification channels, which is why it stops at `no_channels`. What
    // matters is that the gate did not swallow a real breach.
    expect(result.report[0]?.reason).not.toBe('under_threshold')
    expect(result.report[0]?.reason).not.toBe('no_data')
  })

  test('queries anyway when the watermark cannot be read', async () => {
    alertsResultMock.mockReturnValue({ data: [budgetAlert()], error: null })
    getOrgActivitySinceMock.mockResolvedValue(null)
    chQueryMock.mockResolvedValue({ json: async () => [{ total: '0' }] })

    await runEvaluateAlertsJob()

    expect(chQueryMock).toHaveBeenCalledTimes(1)
  })

  test('skips the watermark lookup entirely when no alerts are configured', async () => {
    alertsResultMock.mockReturnValue({ data: [], error: null })

    const result = await runEvaluateAlertsJob()

    expect(getOrgActivitySinceMock).not.toHaveBeenCalled()
    expect(chQueryMock).not.toHaveBeenCalled()
    expect(result.evaluated).toBe(0)
  })

  test('eval_score alerts are unaffected — they never read ClickHouse', async () => {
    alertsResultMock.mockReturnValue({
      data: [budgetAlert({ id: 'alert-2', type: 'eval_score', threshold: 0.8 })],
      error: null,
    })
    getOrgActivitySinceMock.mockResolvedValue(new Map())

    await runEvaluateAlertsJob()

    expect(chQueryMock).not.toHaveBeenCalled()
  })
})
