/**
 * Pure decision logic for the quota-warnings cron.
 *
 * Split out from `quota-warnings.ts` so tests can exercise the threshold
 * rules without pulling in `db.ts` (which requires Supabase env at import
 * time). Same pattern as `prompt-compare-stats.ts` and `anomaly-stats.ts`.
 */

export interface ThresholdDecision {
  /** Whether to send any email this run. */
  send: boolean
  /** Which threshold to notify about — higher takes precedence. */
  threshold: 80 | 100 | null
}

/**
 * Pure decision function. Given a usage ratio + the last-sent timestamps,
 * decide whether an email is due right now.
 *
 * Precedence:
 *   - `100` fires if usageRatio ≥ 1.0 AND the 100% email hasn't been sent
 *     this calendar month.
 *   - `80` fires if usageRatio ≥ 0.8 AND NEITHER the 80% nor the 100%
 *     email has been sent this month. (After a 100% email we don't
 *     retroactively send the 80% — confusing.)
 */
export function decideQuotaWarning(
  usageRatio: number,
  monthStartMs: number,
  lastSent80Ms: number | null,
  lastSent100Ms: number | null,
): ThresholdDecision {
  const sent80ThisMonth = lastSent80Ms !== null && lastSent80Ms >= monthStartMs
  const sent100ThisMonth = lastSent100Ms !== null && lastSent100Ms >= monthStartMs

  if (usageRatio >= 1.0 && !sent100ThisMonth) {
    return { send: true, threshold: 100 }
  }
  if (usageRatio >= 0.8 && !sent80ThisMonth && !sent100ThisMonth) {
    return { send: true, threshold: 80 }
  }
  return { send: false, threshold: null }
}

/**
 * Start of the current UTC calendar month as an epoch-ms number.
 */
export function currentMonthStartMs(now: Date = new Date()): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
}
