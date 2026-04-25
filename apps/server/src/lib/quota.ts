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

// Projects are an organizational unit (separating different LLM apps inside
// the same team), not a billing lever. Every competitor that has the project
// concept (Langfuse, Braintrust) gives unlimited projects on every tier; the
// billable dimensions are usage, retention, and seats. We follow the same
// pattern. The constant is kept so future tiers can reintroduce a limit
// without touching every call site.
export const PROJECT_LIMITS: Record<Plan, number | null> = {
  free: null,
  starter: null,
  team: null,
  enterprise: null,
}

export const LOG_RETENTION_DAYS: Record<Plan, number> = {
  free: 7,
  starter: 30,
  team: 90,
  enterprise: 365,
}

export interface ProjectQuotaCheckResult {
  allowed: boolean
  used: number
  limit: number | null
  plan: Plan
}

/**
 * Checks whether the organization can create another project.
 * Uses PROJECT_LIMITS keyed on organizations.plan.
 */
export async function checkProjectQuota(
  organizationId: string,
): Promise<ProjectQuotaCheckResult> {
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('plan')
    .eq('id', organizationId)
    .single()

  const plan = ((org?.plan as Plan) ?? 'free') as Plan
  const limit = PROJECT_LIMITS[plan]

  const { count } = await supabaseAdmin
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)

  const used = count ?? 0
  if (limit === null) {
    return { allowed: true, used, limit: null, plan }
  }
  return { allowed: used < limit, used, limit, plan }
}

export interface QuotaCheckResult {
  allowed: boolean
  usedThisMonth: number
  limit: number | null
  plan: Plan
  /** True when the org is currently past the soft limit but overage is authorized. */
  overageActive: boolean
  /** Org's overage policy, for reporting to the dashboard + email templates. */
  allowOverage: boolean
  capMultiplier: number
}

/**
 * Counts this org's requests in the current UTC calendar month and applies
 * the Pattern C quota policy (see lib/quota-policy.ts).
 *
 * Callers:
 *   - middleware/quota.ts      — uses `allowed` to decide 429 vs pass-through
 *   - api/billing.ts            — exposes current quota state to the dashboard
 *   - lib/quota-warnings.ts     — iterates active orgs to send 80/100% emails
 *
 * Falls back to 'free' + conservative defaults on any lookup failure.
 */
export async function checkMonthlyQuota(
  organizationId: string,
): Promise<QuotaCheckResult> {
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('plan, allow_overage, overage_cap_multiplier')
    .eq('id', organizationId)
    .single()

  const plan = ((org?.plan as Plan) ?? 'free') as Plan
  const allowOverage = (org?.allow_overage as boolean | undefined) ?? true
  const capMultiplier = (org?.overage_cap_multiplier as number | undefined) ?? 5

  const limit = MONTHLY_REQUEST_LIMITS[plan]
  if (limit === null) {
    return {
      allowed: true,
      usedThisMonth: 0,
      limit: null,
      plan,
      overageActive: false,
      allowOverage,
      capMultiplier,
    }
  }

  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

  const { count } = await supabaseAdmin
    .from('requests')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .gte('created_at', monthStart.toISOString())

  const used = count ?? 0

  // Apply Pattern C policy
  const { evaluateQuotaPolicy } = await import('./quota-policy.js')
  const decision = evaluateQuotaPolicy({
    used,
    limit,
    plan,
    allowOverage,
    capMultiplier,
  })

  return {
    allowed: decision.action === 'pass',
    usedThisMonth: used,
    limit,
    plan,
    overageActive: decision.action === 'pass' && decision.overageActive,
    allowOverage,
    capMultiplier,
  }
}
