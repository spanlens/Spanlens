/**
 * Pure helpers for the Paddle overage cron. Split from paddle-usage.ts so
 * tests can exercise the boundary conditions without pulling in db.ts
 * (which requires Supabase env at import time).
 */

/**
 * One charge unit = 1,000 requests. `quantity` sent to Paddle is
 * `ceil(overage_requests / UNITS_PER_QUANTITY)`. Mirrors the pricing model
 * configured in the Paddle dashboard ($0.10 per 1K on Starter overage).
 */
export const UNITS_PER_QUANTITY = 1000

/**
 * Charging window: the 48-hour stretch ending at `periodEndMs`. This is
 * when the daily cron is allowed to finalize the current period's overage.
 * Outside this window we do nothing — we want exactly one charge per
 * period, issued as the period is about to close.
 *
 * Inclusive of the period_end moment itself, so a run happening right AT
 * the boundary still qualifies. Runs strictly AFTER period_end are out of
 * the window (by that point Paddle's webhook will have rolled the sub
 * over to the new period; no retry path for the closed period).
 */
export function isWithinChargingWindow(
  periodEndMs: number,
  nowMs: number,
  windowHours: number = 48,
): boolean {
  const delta = periodEndMs - nowMs // positive = period hasn't ended yet
  if (delta < 0) return false // already past
  if (delta > windowHours * 3600_000) return false // too far in the future
  return true
}
