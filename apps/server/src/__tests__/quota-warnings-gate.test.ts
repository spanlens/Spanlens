import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * check-quota-warnings × activity watermark.
 *
 * The month-wide gate that shipped first was not enough: one tenant with
 * traffic anywhere in the month keeps passing it, so the job still dragged
 * ClickHouse awake every hour for the rest of the month. The gate here is the
 * later of the month start and the last successful run, which is safe because
 * this job's output moves only when new requests arrive.
 *
 * What these cases pin, in order of what would hurt most if it broke:
 *
 *   1. an org WITH new traffic is still counted and still warned
 *   2. an unreadable watermark counts everyone, as before
 *   3. an org with nothing new since the last run is skipped
 *   4. the month start is the floor, so a run older than the month cannot
 *      widen the window backwards past it
 */

const orgsResultMock = vi.fn()
const countMonthlyRequestsMock = vi.fn()
const getOrgActivitySinceMock = vi.fn()
const lastSuccessfulRunAtMock = vi.fn()
const sendQuotaWarningEmailMock = vi.fn()

let capturedGateSince: Date | null = null

vi.mock('../lib/db.js', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        in: () => ({ returns: () => Promise.resolve(orgsResultMock()) }),
      }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: 'owner@example.com' } }, error: null }),
      },
    },
  },
}))

vi.mock('../lib/quota.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/quota.js')>('../lib/quota.js')
  return { ...actual, countMonthlyRequests: countMonthlyRequestsMock }
})

vi.mock('../lib/notifiers.js', () => ({ sendQuotaWarningEmail: sendQuotaWarningEmailMock }))

vi.mock('../lib/org-activity.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/org-activity.js')>(
    '../lib/org-activity.js',
  )
  return {
    ...actual,
    getOrgActivitySince: (since: Date) => {
      capturedGateSince = since
      return getOrgActivitySinceMock(since)
    },
  }
})

vi.mock('../lib/cron-cadence.js', () => ({ lastSuccessfulRunAt: lastSuccessfulRunAtMock }))

const ORG = '00000000-0000-4000-8000-000000000001'

function freeOrg() {
  return {
    id: ORG,
    name: 'Acme',
    plan: 'free',
    owner_id: 'user-1',
    allow_overage: false,
    overage_cap_multiplier: 1,
    quota_warning_80_sent_at: null,
    quota_warning_100_sent_at: null,
  }
}

let runQuotaWarningsJob: typeof import('../lib/quota-warnings.js').runQuotaWarningsJob
let monthlyLimit: number

beforeEach(async () => {
  vi.resetModules()
  orgsResultMock.mockReset()
  countMonthlyRequestsMock.mockReset()
  getOrgActivitySinceMock.mockReset()
  lastSuccessfulRunAtMock.mockReset()
  sendQuotaWarningEmailMock.mockReset()
  capturedGateSince = null
  vi.spyOn(console, 'error').mockImplementation(() => {})
  ;({ runQuotaWarningsJob } = await import('../lib/quota-warnings.js'))
  const { MONTHLY_REQUEST_LIMITS } = await import('../lib/quota.js')
  monthlyLimit = MONTHLY_REQUEST_LIMITS.free as number
  orgsResultMock.mockReturnValue({ data: [freeOrg()], error: null })
  sendQuotaWarningEmailMock.mockResolvedValue({ ok: true })
})

describe('runQuotaWarningsJob gating', () => {
  test('counts and warns an org with new traffic since the last run', async () => {
    lastSuccessfulRunAtMock.mockResolvedValue(new Date(Date.now() - 60 * 60 * 1000))
    getOrgActivitySinceMock.mockResolvedValue(new Map([[ORG, Date.now() - 60_000]]))
    countMonthlyRequestsMock.mockResolvedValue(Math.ceil(monthlyLimit * 0.9))

    const result = await runQuotaWarningsJob()

    expect(countMonthlyRequestsMock).toHaveBeenCalledTimes(1)
    expect(result.sent80).toBe(1)
    expect(result.skipped).toBe(0)
  })

  test('counts every org when the watermark cannot be read', async () => {
    lastSuccessfulRunAtMock.mockResolvedValue(new Date(Date.now() - 60 * 60 * 1000))
    getOrgActivitySinceMock.mockResolvedValue(null)
    countMonthlyRequestsMock.mockResolvedValue(0)

    await runQuotaWarningsJob()

    expect(countMonthlyRequestsMock).toHaveBeenCalledTimes(1)
  })

  test('counts every org when there is no successful run to gate on', async () => {
    lastSuccessfulRunAtMock.mockResolvedValue(null)
    getOrgActivitySinceMock.mockResolvedValue(new Map([[ORG, Date.now() - 60_000]]))
    countMonthlyRequestsMock.mockResolvedValue(0)

    await runQuotaWarningsJob()

    expect(countMonthlyRequestsMock).toHaveBeenCalledTimes(1)
  })

  test('skips ClickHouse for an org with nothing new since the last run', async () => {
    const lastRun = new Date(Date.now() - 60 * 60 * 1000)
    lastSuccessfulRunAtMock.mockResolvedValue(lastRun)
    // Active this month, but two hours ago — before the last run.
    getOrgActivitySinceMock.mockResolvedValue(new Map())

    const result = await runQuotaWarningsJob()

    expect(countMonthlyRequestsMock).not.toHaveBeenCalled()
    expect(result.skipped).toBe(1)
    expect(result.checked).toBe(1)
    expect(result.sent80).toBe(0)
  })

  test('gates on the last run when it is inside the month', async () => {
    const lastRun = new Date(Date.now() - 30 * 60 * 1000)
    lastSuccessfulRunAtMock.mockResolvedValue(lastRun)
    getOrgActivitySinceMock.mockResolvedValue(new Map())

    await runQuotaWarningsJob()

    expect(capturedGateSince?.getTime()).toBe(lastRun.getTime())
  })

  test('never widens the window past the month start', async () => {
    const { currentMonthStartMs } = await import('../lib/quota-warnings-stats.js')
    const monthStart = currentMonthStartMs(new Date())
    // A run recorded before this month must not pull the gate back with it.
    lastSuccessfulRunAtMock.mockResolvedValue(new Date(monthStart - 24 * 60 * 60 * 1000))
    getOrgActivitySinceMock.mockResolvedValue(new Map())

    await runQuotaWarningsJob()

    expect(capturedGateSince?.getTime()).toBe(monthStart)
  })

  test('reports errors so the caller can withhold the success stamp', async () => {
    lastSuccessfulRunAtMock.mockResolvedValue(new Date(Date.now() - 60 * 60 * 1000))
    getOrgActivitySinceMock.mockResolvedValue(new Map([[ORG, Date.now() - 60_000]]))
    countMonthlyRequestsMock.mockRejectedValue(new Error('ClickHouse timeout'))

    const result = await runQuotaWarningsJob()

    expect(result.errors).toBe(1)
    expect(result.skipped).toBe(0)
  })
})
