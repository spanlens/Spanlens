import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_RETENTION_DAYS,
  localDayStartIso,
  parseRequestsTimeRange,
  requestsChartBucketCount,
  requestsChartWindow,
  requestsChartLabel,
  requestsKpiFrom,
  requestsRangeLabel,
  requestsTableFrom,
} from './requests-range'
import { PLAN_RETENTION_DAYS } from './billing-plans'

/**
 * The /requests page has one time-range control and three readers: the
 * table, the KPI strip, and the traffic chart. Two defects lived here:
 *
 *   - "All time" labelled a KPI strip that actually asked for 30 days, while
 *     the table under it had no lower bound at all.
 *   - "Today" started at UTC midnight, while Settings promises that every
 *     timestamp in the UI uses the browser's local timezone.
 */

const DAY_MS = 24 * 3_600_000

describe('localDayStartIso', () => {
  // Node re-reads process.env.TZ on assignment, so the zone can be pinned per
  // test. CI runs in UTC, where local and UTC midnight coincide and the bug
  // this guards against is invisible.
  const originalTz = process.env.TZ
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ
    else process.env.TZ = originalTz
  })

  it('is midnight in the browser zone, not UTC midnight', () => {
    process.env.TZ = 'Asia/Seoul'
    // 12:00 KST on Sep 28. UTC midnight would be 09:00 KST, so the old
    // "today" silently dropped the first nine hours of a Seoul user's day.
    const now = Date.UTC(2026, 8, 28, 3, 0, 0)
    expect(localDayStartIso(now)).toBe('2026-09-27T15:00:00.000Z')
  })

  it('follows the zone west of UTC as well', () => {
    process.env.TZ = 'America/New_York'
    // 08:00 EDT on Sep 28 (UTC-4).
    const now = Date.UTC(2026, 8, 28, 12, 0, 0)
    expect(localDayStartIso(now)).toBe('2026-09-28T04:00:00.000Z')
  })
})

describe('the three readers agree on the window', () => {
  const now = Date.UTC(2026, 8, 28, 15, 0, 0)

  it('today: table and KPI both start at local midnight', () => {
    expect(requestsTableFrom('today', now)).toBe(localDayStartIso(now))
    expect(requestsKpiFrom('today', now)).toBe(localDayStartIso(now))
    expect(requestsChartWindow('today', now)).toEqual({ from: localDayStartIso(now) })
  })

  it('7d / 30d: table and KPI share the same trailing bound', () => {
    expect(requestsTableFrom('7d', now)).toBe(new Date(now - 7 * DAY_MS).toISOString())
    expect(requestsKpiFrom('7d', now)).toBe(requestsTableFrom('7d', now))
    expect(requestsKpiFrom('30d', now)).toBe(new Date(now - 30 * DAY_MS).toISOString())
  })

  it('all: the table has no bound and the KPI reaches back over every retained day', () => {
    // The server clips every read to the org's plan retention, so asking from
    // the longest retention any plan has means "everything the table can
    // show". Asking for 30 days, as before, did not.
    expect(requestsTableFrom('all', now)).toBeUndefined()
    expect(requestsKpiFrom('all', now)).toBe(new Date(now - MAX_RETENTION_DAYS * DAY_MS).toISOString())
  })

  it('MAX_RETENTION_DAYS covers every plan', () => {
    for (const days of Object.values(PLAN_RETENTION_DAYS)) {
      expect(MAX_RETENTION_DAYS).toBeGreaterThanOrEqual(days)
    }
  })

  it('all: the chart stays a 30-day view and says so', () => {
    expect(requestsChartWindow('all', now)).toEqual({ hours: 30 * 24 })
    expect(requestsChartWindow('7d', now)).toEqual({ from: requestsTableFrom('7d', now) })
    expect(requestsChartLabel('all')).toBe('last 30d')
    expect(requestsChartBucketCount('all')).toBe(30)
  })
})

describe('labels match the window actually queried', () => {
  it('names each range', () => {
    expect(requestsRangeLabel('all')).toBe('all time')
    expect(requestsRangeLabel('today')).toBe('today')
    expect(requestsRangeLabel('7d')).toBe('7d')
    expect(requestsRangeLabel('30d')).toBe('30d')
    expect(requestsChartLabel('today')).toBe('today')
    expect(requestsChartLabel('7d')).toBe('last 7d')
  })

  it('chart buckets: hours for today, days otherwise', () => {
    expect(requestsChartBucketCount('today')).toBe(24)
    expect(requestsChartBucketCount('7d')).toBe(7)
    expect(requestsChartBucketCount('30d')).toBe(30)
  })
})

describe('parseRequestsTimeRange', () => {
  it('accepts the four ranges and falls back to all', () => {
    expect(parseRequestsTimeRange('today')).toBe('today')
    expect(parseRequestsTimeRange('7d')).toBe('7d')
    expect(parseRequestsTimeRange('30d')).toBe('30d')
    expect(parseRequestsTimeRange('all')).toBe('all')
    expect(parseRequestsTimeRange(null)).toBe('all')
    expect(parseRequestsTimeRange('90d')).toBe('all')
  })
})
