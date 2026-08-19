import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * snapshot-anomalies × activity watermark.
 *
 * This job opened its day with `SELECT DISTINCT organization_id FROM requests`
 * — an unbounded scan, issued daily, against a service that is now allowed to
 * be asleep. On 2026-08-19 it consumed the entire 60s request budget and still
 * failed ("Failed to fetch active orgs: Timeout error."), having paid for the
 * wake-up regardless.
 *
 * The watermark holds that exact answer in Postgres. What is pinned here:
 *
 *   - no active orgs → ClickHouse is never touched
 *   - active orgs → they are still analysed
 *   - unreadable watermark → the original scan still runs, because skipping a
 *     day of anomaly detection is worse than one wake-up
 */

const chQueryMock = vi.fn()
const getOrgActivitySinceMock = vi.fn()
const detectAnomaliesMock = vi.fn()

vi.mock('../lib/clickhouse.js', () => ({
  unscopedClickhouse: () => ({ query: chQueryMock }),
}))

vi.mock('../lib/db.js', () => ({
  supabaseAdmin: { from: () => ({ upsert: async () => ({ error: null }) }) },
}))

vi.mock('../lib/anomaly.js', () => ({
  detectAnomalies: (orgId: string) => detectAnomaliesMock(orgId),
  ANOMALY_DEFAULTS: {
    OBSERVATION_HOURS: 1,
    REFERENCE_HOURS: 24,
    SIGMA_THRESHOLD: 3,
    HIGH_SEVERITY_SIGMA: 5,
  },
}))

vi.mock('../lib/notifiers.js', () => ({ deliverToChannel: vi.fn() }))

vi.mock('../lib/org-activity.js', () => ({
  getOrgActivitySince: (since: Date) => getOrgActivitySinceMock(since),
}))

const ORG = '00000000-0000-4000-8000-000000000001'

let snapshotAnomaliesForAllOrgs:
  typeof import('../lib/anomaly-snapshot.js').snapshotAnomaliesForAllOrgs

beforeEach(async () => {
  vi.resetModules()
  chQueryMock.mockReset()
  getOrgActivitySinceMock.mockReset()
  detectAnomaliesMock.mockReset()
  detectAnomaliesMock.mockResolvedValue([])
  ;({ snapshotAnomaliesForAllOrgs } = await import('../lib/anomaly-snapshot.js'))
})

describe('snapshotAnomaliesForAllOrgs', () => {
  test('never touches ClickHouse when no org has recent traffic', async () => {
    getOrgActivitySinceMock.mockResolvedValue(new Map())

    await expect(snapshotAnomaliesForAllOrgs()).resolves.toEqual([])

    expect(chQueryMock).not.toHaveBeenCalled()
    expect(detectAnomaliesMock).not.toHaveBeenCalled()
  })

  test('analyses the orgs the watermark reports as active', async () => {
    getOrgActivitySinceMock.mockResolvedValue(new Map([[ORG, Date.now() - 60_000]]))

    const results = await snapshotAnomaliesForAllOrgs()

    // The org list came from Postgres, so the DISTINCT scan is gone entirely.
    expect(chQueryMock).not.toHaveBeenCalled()
    expect(detectAnomaliesMock).toHaveBeenCalledWith(ORG)
    expect(results).toHaveLength(1)
    expect(results[0]?.orgId).toBe(ORG)
  })

  test('falls back to the ClickHouse scan when the watermark is unreadable', async () => {
    getOrgActivitySinceMock.mockResolvedValue(null)
    chQueryMock.mockResolvedValue({ json: async () => [{ organization_id: ORG }] })

    const results = await snapshotAnomaliesForAllOrgs()

    expect(chQueryMock).toHaveBeenCalledTimes(1)
    expect(detectAnomaliesMock).toHaveBeenCalledWith(ORG)
    expect(results).toHaveLength(1)
  })

  test('asks the watermark for the same 24h window the scan used', async () => {
    getOrgActivitySinceMock.mockResolvedValue(new Map())
    const now = new Date('2026-08-19T12:00:00.000Z')

    await snapshotAnomaliesForAllOrgs(now)

    const since = getOrgActivitySinceMock.mock.calls[0]?.[0] as Date
    expect(since.toISOString()).toBe('2026-08-18T12:00:00.000Z')
  })
})
