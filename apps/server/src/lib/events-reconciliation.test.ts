import { afterEach, describe, expect, it, vi } from 'vitest'

const queryMock = vi.fn()
vi.mock('./clickhouse.js', () => ({
  getClickhouse: () => ({ query: queryMock }),
}))

import { computeReconciliation, runReconciliationCron } from './events-reconciliation.js'

afterEach(() => queryMock.mockReset())

function res<T>(rows: T[]) {
  return { json: async () => rows as unknown }
}

describe('computeReconciliation', () => {
  it('returns withinTolerance=true when counts match exactly', async () => {
    queryMock
      .mockResolvedValueOnce(res([{ c: '1000' }]))
      .mockResolvedValueOnce(res([{ c: '1000' }]))

    const r = await computeReconciliation()
    expect(r.requestsCount).toBe(1000)
    expect(r.eventsCount).toBe(1000)
    expect(r.absDiff).toBe(0)
    expect(r.ratio).toBe(0)
    expect(r.withinTolerance).toBe(true)
  })

  it('returns withinTolerance=true when both counts are zero (off-peak)', async () => {
    queryMock
      .mockResolvedValueOnce(res([{ c: '0' }]))
      .mockResolvedValueOnce(res([{ c: '0' }]))

    const r = await computeReconciliation()
    expect(r.ratio).toBe(0)
    expect(r.withinTolerance).toBe(true)
  })

  it('returns withinTolerance=true when diff is at the 1% threshold', async () => {
    queryMock
      .mockResolvedValueOnce(res([{ c: '100' }]))
      .mockResolvedValueOnce(res([{ c: '99' }]))

    const r = await computeReconciliation()
    expect(r.absDiff).toBe(1)
    expect(r.ratio).toBeCloseTo(0.01, 4)
    expect(r.withinTolerance).toBe(true)
  })

  it('returns withinTolerance=false when diff exceeds 1%', async () => {
    queryMock
      .mockResolvedValueOnce(res([{ c: '1000' }]))
      .mockResolvedValueOnce(res([{ c: '950' }]))

    const r = await computeReconciliation()
    expect(r.absDiff).toBe(50)
    expect(r.ratio).toBe(0.05)
    expect(r.withinTolerance).toBe(false)
  })

  it('clips the window to end an hour before now so in-flight writes do not skew it', async () => {
    queryMock
      .mockResolvedValueOnce(res([{ c: '0' }]))
      .mockResolvedValueOnce(res([{ c: '0' }]))

    const before = Date.now()
    const r = await computeReconciliation()
    const after = Date.now()

    const toMs = new Date(r.windowToUtc).getTime()
    const fromMs = new Date(r.windowFromUtc).getTime()

    // windowTo should be ~1h ago, windowFrom should be ~25h ago.
    expect(toMs).toBeLessThanOrEqual(after - 3_500_000)
    expect(toMs).toBeGreaterThanOrEqual(before - 3_700_000)
    expect(toMs - fromMs).toBe(24 * 3_600_000)
  })

  it('throws via runReconciliationCron when out of tolerance', async () => {
    queryMock
      .mockResolvedValueOnce(res([{ c: '100' }]))
      .mockResolvedValueOnce(res([{ c: '50' }]))

    await expect(runReconciliationCron()).rejects.toThrow(/drift.*>.*1%/)
  })

  it('resolves cleanly via runReconciliationCron when within tolerance', async () => {
    queryMock
      .mockResolvedValueOnce(res([{ c: '100' }]))
      .mockResolvedValueOnce(res([{ c: '100' }]))

    const r = await runReconciliationCron()
    expect(r.withinTolerance).toBe(true)
  })
})
