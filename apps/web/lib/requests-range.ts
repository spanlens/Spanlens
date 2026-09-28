import { PLAN_RETENTION_DAYS } from './billing-plans'

/**
 * Time windows for the /requests page.
 *
 * One range control feeds three readers: the table, the KPI strip, and the
 * traffic chart. They must describe the same rows, or the strip can read
 * "0 requests · today" above a table full of today's rows. Every bound here
 * is computed from a single `nowMs` so the three agree to the millisecond.
 *
 * "Today" is the browser's local day. Settings tells users every timestamp
 * in the UI uses their local timezone; a UTC day would start at 09:00 for a
 * user in Seoul and at 20:00 the previous evening for one in New York.
 */

export type RequestsTimeRange = 'all' | 'today' | '7d' | '30d'

const RANGES: readonly RequestsTimeRange[] = ['all', 'today', '7d', '30d']
const DAY_MS = 24 * 3_600_000

/** The traffic chart's fixed trailing view when the range is "All time". */
const ALL_TIME_CHART_DAYS = 30

/**
 * Longest retention of any plan. The server clips every read to the org's
 * own plan, so a lower bound this far back means "everything this workspace
 * keeps", which is exactly what the unbounded table shows for "All time".
 */
export const MAX_RETENTION_DAYS = Math.max(...Object.values(PLAN_RETENTION_DAYS))

export function parseRequestsTimeRange(raw: string | null | undefined): RequestsTimeRange {
  return RANGES.find((r) => r === raw) ?? 'all'
}

/** Midnight at the start of the browser's local day containing `nowMs`. */
export function localDayStartIso(nowMs: number): string {
  const start = new Date(nowMs)
  start.setHours(0, 0, 0, 0)
  return start.toISOString()
}

function daysAgoIso(nowMs: number, days: number): string {
  return new Date(nowMs - days * DAY_MS).toISOString()
}

/** Lower bound for the table. "All time" has none: plan retention bounds it. */
export function requestsTableFrom(range: RequestsTimeRange, nowMs: number): string | undefined {
  switch (range) {
    case 'today': return localDayStartIso(nowMs)
    case '7d': return daysAgoIso(nowMs, 7)
    case '30d': return daysAgoIso(nowMs, 30)
    default: return undefined
  }
}

/**
 * Lower bound for the KPI strip: the table's window. The stats endpoints fall
 * back to 30 days when no bound is sent, so "All time" has to send one
 * explicitly or the strip silently covers less than the table.
 */
export function requestsKpiFrom(range: RequestsTimeRange, nowMs: number): string {
  return requestsTableFrom(range, nowMs) ?? daysAgoIso(nowMs, MAX_RETENTION_DAYS)
}

/** Params for the stats hooks: a rolling `hours` window or an explicit `from`. */
export type RequestsChartWindow = { hours: number } | { from: string }

/**
 * Window for the traffic chart (and the KPI sparklines, which share its
 * query). "All time" keeps a 30-day trailing view so the bars stay readable;
 * `requestsChartLabel` says so on the card. It is expressed as rolling
 * `hours` rather than an explicit bound so the query key matches the page's
 * server prefetch (`statsTimeseriesSpec(720)`).
 */
export function requestsChartWindow(range: RequestsTimeRange, nowMs: number): RequestsChartWindow {
  const from = requestsTableFrom(range, nowMs)
  return from ? { from } : { hours: ALL_TIME_CHART_DAYS * 24 }
}

/** Buckets the chart draws: hourly for today, daily otherwise. */
export function requestsChartBucketCount(range: RequestsTimeRange): number {
  switch (range) {
    case 'today': return 24
    case '7d': return 7
    default: return ALL_TIME_CHART_DAYS
  }
}

/** Suffix for the KPI tiles ("Requests · today"). */
export function requestsRangeLabel(range: RequestsTimeRange): string {
  return range === 'all' ? 'all time' : range
}

/** Caption on the traffic chart, which caps "All time" at 30 days. */
export function requestsChartLabel(range: RequestsTimeRange): string {
  switch (range) {
    case 'today': return 'today'
    case '7d': return 'last 7d'
    default: return `last ${ALL_TIME_CHART_DAYS}d`
  }
}
