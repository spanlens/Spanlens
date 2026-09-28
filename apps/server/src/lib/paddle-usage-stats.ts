/**
 * Pure helpers for the Paddle overage cron. Split from paddle-usage.ts so
 * tests can exercise the boundary conditions without pulling in db.ts
 * (which requires Supabase env at import time).
 */

/**
 * One charge unit = 1,000 requests. `quantity` sent to Paddle is
 * `ceil(overage_requests / UNITS_PER_QUANTITY)`. The unit price is the
 * Paddle overage price configured in the dashboard, matching the published
 * rates in apps/web/lib/billing-plans.ts: $8 per 100K on Pro (plan id
 * `starter`) and $5 per 100K on Team, i.e. $0.08 and $0.05 per unit.
 */
export const UNITS_PER_QUANTITY = 1000

/**
 * Charging window: the 48-hour stretch ending at `periodEndMs`. This is
 * when the daily cron issues the period's provisional overage charge, for
 * the usage seen so far. Usage after that run is billed by the settlement
 * pass once the period has closed (paddle-overage-settlement.ts), so
 * together they charge each period exactly once for its final usage.
 *
 * Inclusive of the period_end moment itself, so a run happening right AT
 * the boundary still qualifies. Runs strictly AFTER period_end are out of
 * the window (by then Paddle's webhook has rolled the sub over to the new
 * period, and the closed period belongs to the settlement pass).
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
