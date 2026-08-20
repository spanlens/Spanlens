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
 * The log table has since moved to Postgres, but the shape of the hazard is
 * identical: a DISTINCT over every logged request is the most expensive way to
 * learn which handful of orgs had traffic. The watermark holds that exact
 * answer in a small indexed table. What is pinned here:
 *
 *   - no active orgs → the `requests` table is never queried
 *   - active orgs → they are still analysed
 *   - unreadable watermark → the original scan still runs, because skipping a
 *     day of anomaly detection is worse than one expensive query
 */

const pgQueryMock = vi.fn()
const getOrgActivitySinceMock = vi.fn()
const detectAnomaliesMock = vi.fn()

vi.mock('../lib/postgres.js', () => ({
  pgQuery: pgQueryMock,
  pgQueryOne: vi.fn(),
  pgExecute: vi.fn(),
  pgStream: vi.fn(),
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
  pgQueryMock.mockReset()
  getOrgActivitySinceMock.mockReset()
  detectAnomaliesMock.mockReset()
  detectAnomaliesMock.mockResolvedValue([])
  ;({ snapshotAnomaliesForAllOrgs } = await import('../lib/anomaly-snapshot.js'))
})

describe('snapshotAnomaliesForAllOrgs', () => {
  test('never scans the requests table when no org has recent traffic', async () => {
    getOrgActivitySinceMock.mockResolvedValue(new Map())

    await expect(snapshotAnomaliesForAllOrgs()).resolves.toEqual([])

    expect(pgQueryMock).not.toHaveBeenCalled()
    expect(detectAnomaliesMock).not.toHaveBeenCalled()
  })

  test('analyses the orgs the watermark reports as active', async () => {
    getOrgActivitySinceMock.mockResolvedValue(new Map([[ORG, Date.now() - 60_000]]))

    const results = await snapshotAnomaliesForAllOrgs()

    // The org list came from the watermark, so the DISTINCT scan is gone entirely.
    expect(pgQueryMock).not.toHaveBeenCalled()
    expect(detectAnomaliesMock).toHaveBeenCalledWith(ORG)
    expect(results).toHaveLength(1)
    expect(results[0]?.orgId).toBe(ORG)
  })

  test('falls back to the DISTINCT scan when the watermark is unreadable', async () => {
    getOrgActivitySinceMock.mockResolvedValue(null)
    pgQueryMock.mockResolvedValue([{ organization_id: ORG }])

    const results = await snapshotAnomaliesForAllOrgs()

    expect(pgQueryMock).toHaveBeenCalledTimes(1)
    // The fallback is a bounded window, not the whole table.
    const { query, params } = pgQueryMock.mock.calls[0]![0] as {
      query: string
      params: Record<string, unknown>
    }
    expect(query).toContain('created_at >= {since}::timestamptz')
    expect(params['since']).toBeDefined()
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
