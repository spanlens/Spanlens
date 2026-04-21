import { supabaseAdmin } from './db.js'

/**
 * Monthly request quota per plan tier. Checked in the proxy middleware
 * before forwarding upstream — over-quota returns 429 immediately.
 *
 * The source of truth is `requests` table: count of rows in the current
 * UTC calendar month for this organization.
 */

export type Plan = 'free' | 'starter' | 'team' | 'enterprise'

export const MONTHLY_REQUEST_LIMITS: Record<Plan, number | null> = {
  free: 10_000,
  starter: 100_000,
  team: 500_000,
  enterprise: null, // unlimited
}

export const LOG_RETENTION_DAYS: Record<Plan, number> = {
  free: 7,
  starter: 30,
  team: 90,
  enterprise: 365,
}

export interface QuotaCheckResult {
  allowed: boolean
  usedThisMonth: number
  limit: number | null
  plan: Plan
}

/**
 * Counts this org's requests in the current UTC calendar month and compares
 * against the plan limit. Falls back to 'free' on any lookup failure (safe
 * default — we'd rather throttle than over-serve).
 */
export async function checkMonthlyQuota(
  organizationId: string,
): Promise<QuotaCheckResult> {
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('plan')
    .eq('id', organizationId)
    .single()

  const plan = ((org?.plan as Plan) ?? 'free') as Plan
  const limit = MONTHLY_REQUEST_LIMITS[plan]
  if (limit === null) {
    return { allowed: true, usedThisMonth: 0, limit: null, plan }
  }

  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

  const { count } = await supabaseAdmin
    .from('requests')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .gte('created_at', monthStart.toISOString())

  const used = count ?? 0
  return { allowed: used < limit, usedThisMonth: used, limit, plan }
}
