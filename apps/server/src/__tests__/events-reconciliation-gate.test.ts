import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * events-reconciliation × activity watermark.
 *
 * The job compares row counts in `requests` and `events` over a 24h window.
 * With no traffic in that window both counts are zero and the verdict is
 * already known, so the two ClickHouse counts only serve to wake a suspended
 * service. Measured 2026-08-19: this job spent 46s on a cold start to compare
 * a handful of rows.
 *
 * The safety property is that a quiet window must still be reported as
 * in-tolerance rather than as drift — a false "drift above threshold" would
 * fail the cron and page for nothing.
 */

const chQueryMock = vi.fn()
const anyActivitySinceMock = vi.fn()

vi.mock('../lib/clickhouse.js', () => ({
  unscopedClickhouse: () => ({ query: chQueryMock }),
}))

vi.mock('../lib/org-activity.js', () => ({
  anyActivitySince: (since: Date) => anyActivitySinceMock(since),
}))

let mod: typeof import('../lib/events-reconciliation.js')

beforeEach(async () => {
  vi.resetModules()
  chQueryMock.mockReset()
  anyActivitySinceMock.mockReset()
  mod = await import('../lib/events-reconciliation.js')
})

describe('computeReconciliation', () => {
  test('skips both counts when nothing was logged in the window', async () => {
    anyActivitySinceMock.mockResolvedValue(false)

    const result = await mod.computeReconciliation()

    expect(chQueryMock).not.toHaveBeenCalled()
    expect(result.requestsCount).toBe(0)
    expect(result.eventsCount).toBe(0)
    expect(result.ratio).toBe(0)
    // A quiet window is agreement, not drift.
    expect(result.withinTolerance).toBe(true)
  })

  test('still compares when the window saw traffic', async () => {
    anyActivitySinceMock.mockResolvedValue(true)
    chQueryMock.mockResolvedValue({ json: async () => [{ c: '100' }] })

    const result = await mod.computeReconciliation()

    expect(chQueryMock).toHaveBeenCalledTimes(2)
    expect(result.requestsCount).toBe(100)
    expect(result.eventsCount).toBe(100)
  })

  test('compares anyway when the watermark is unreadable', async () => {
    anyActivitySinceMock.mockResolvedValue(true) // fail-open contract
    chQueryMock.mockResolvedValue({ json: async () => [{ c: '5' }] })

    await mod.computeReconciliation()

    expect(chQueryMock).toHaveBeenCalledTimes(2)
  })

  test('gates on the start of the comparison window', async () => {
    anyActivitySinceMock.mockResolvedValue(false)

    const result = await mod.computeReconciliation()

    const since = anyActivitySinceMock.mock.calls[0]?.[0] as Date
    expect(since.toISOString()).toBe(result.windowFromUtc)
  })

  test('a quiet window does not fail the cron', async () => {
    anyActivitySinceMock.mockResolvedValue(false)
    await expect(mod.runReconciliationCron()).resolves.toMatchObject({
      withinTolerance: true,
    })
  })
})
