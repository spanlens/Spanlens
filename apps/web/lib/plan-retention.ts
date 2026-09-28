import { PLAN_RETENTION_DAYS } from './billing-plans'

/**
 * "90 days" for a plan id, from the same table the plan cards and the
 * Plan & limits tab read. PLAN_RETENTION_DAYS mirrors the server's
 * LOG_RETENTION_DAYS, which is what actually clips every read; a drift test
 * (plan-retention.test.ts) compares the two.
 *
 * Returns null for a missing or unknown plan so callers show a loading or
 * unknown state instead of a guessed number.
 */
export function retentionLabelFor(planId: string | null | undefined): string | null {
  if (!planId) return null
  const days = PLAN_RETENTION_DAYS[planId]
  return days ? `${days} days` : null
}
