/**
 * Phase 5.1 Stage 3 — events vs requests reconciliation.
 *
 * Runs daily from /cron/events-reconciliation. Compares the row counts
 * over a recent window and reports the absolute diff + ratio. The
 * cron logs the result through `withCronLog`, so:
 *
 *   • A drift inside threshold → status='ok', stays out of /health/deep
 *     and only shows up in cron_job_runs for trend inspection.
 *   • A drift above threshold → console.error (Vercel logs pick it up)
 *     AND the cron call itself throws to mark the run 'error' in
 *     cron_job_runs.
 *
 * The window deliberately ends 1 hour ago so we don't compare counts
 * mid-write — the dual-write path can race with the comparison
 * window otherwise. (events writes 30ms after `requests`; an
 * in-flight call would skew the diff toward "events smaller".)
 *
 * Threshold (`DIFF_TOLERANCE_RATIO = 0.01`, i.e. 1%) is the noise floor
 * we expect dual-write race conditions to produce. Bump it once we
 * have a few days of baseline data and know the natural noise floor.
 */

import { unscopedClickhouse } from './clickhouse.js'

const RECON_WINDOW_HOURS = 24
const RECON_END_LAG_HOURS = 1
const DIFF_TOLERANCE_RATIO = 0.01

export interface ReconciliationResult {
  windowFromUtc: string
  windowToUtc: string
  requestsCount: number
  eventsCount: number
  absDiff: number
  ratio: number
  withinTolerance: boolean
}

/**
 * Read one count from the shared CH client. Throws on transport
 * error so the caller can mark the cron run failed.
 */
async function singleCount(query: string, params: Record<string, unknown>): Promise<number> {
  const res = await unscopedClickhouse().query({
    query,
    query_params: params,
    format: 'JSONEachRow',
  })
  const rows = (await res.json()) as Array<{ c: string }>
  return Number(rows[0]?.c ?? 0)
}

/**
 * Compute the diff between `requests` and `events`-with-generation
 * over the reconciliation window. Caller decides whether to throw on
 * an out-of-tolerance result.
 */
export async function computeReconciliation(): Promise<ReconciliationResult> {
  const now = new Date()
  const windowToUtc = new Date(now.getTime() - RECON_END_LAG_HOURS * 3_600_000)
  const windowFromUtc = new Date(windowToUtc.getTime() - RECON_WINDOW_HOURS * 3_600_000)

  // CH expects 'YYYY-MM-DD HH:MM:SS.fff' — gotcha #18.
  const fmt = (d: Date): string => d.toISOString().replace('T', ' ').replace('Z', '')

  const params = {
    from_ts: fmt(windowFromUtc),
    to_ts: fmt(windowToUtc),
  }

  const [requestsCount, eventsCount] = await Promise.all([
    singleCount(
      `SELECT count() AS c FROM requests
       WHERE created_at >= parseDateTime64BestEffort({from_ts:String})
         AND created_at <  parseDateTime64BestEffort({to_ts:String})`,
      params,
    ),
    singleCount(
      `SELECT count() AS c FROM events
       WHERE event_type = 'generation'
         AND created_at >= parseDateTime64BestEffort({from_ts:String})
         AND created_at <  parseDateTime64BestEffort({to_ts:String})`,
      params,
    ),
  ])

  const absDiff = Math.abs(requestsCount - eventsCount)
  // If both counts are zero (off-peak / quiet org) we treat the ratio
  // as 0 to avoid a divide-by-zero and a false alarm.
  const denom = Math.max(requestsCount, eventsCount)
  const ratio = denom === 0 ? 0 : absDiff / denom

  return {
    windowFromUtc: windowFromUtc.toISOString(),
    windowToUtc: windowToUtc.toISOString(),
    requestsCount,
    eventsCount,
    absDiff,
    ratio,
    withinTolerance: ratio <= DIFF_TOLERANCE_RATIO,
  }
}

/**
 * Cron handler — runs the reconciliation, throws when out of
 * tolerance so the cron-log marks the run failed. Returns the
 * full result on success for the JSON response.
 */
export async function runReconciliationCron(): Promise<ReconciliationResult> {
  const result = await computeReconciliation()
  if (!result.withinTolerance) {
    // Logged loudly so Vercel runtime logs surface it even if the
    // throw is later caught somewhere upstream.
    console.error('[events-reconciliation] drift above threshold:', result)
    throw new Error(
      `events vs requests drift ${(result.ratio * 100).toFixed(2)}% > ${
        DIFF_TOLERANCE_RATIO * 100
      }% (requests=${result.requestsCount}, events=${result.eventsCount})`,
    )
  }
  return result
}

export const _internalForTesting = {
  DIFF_TOLERANCE_RATIO,
  RECON_WINDOW_HOURS,
  RECON_END_LAG_HOURS,
}
