import { supabaseAdmin } from './db.js'
import { unscopedClickhouse } from './clickhouse.js'
import { evaluateQuotaPolicy } from './quota-policy.js'

/**
 * Monthly request quota per plan tier. Checked in the proxy middleware
 * before forwarding upstream — over-quota returns 429 immediately.
 *
 * The source of truth is `requests` table: count of rows in the current
 * UTC calendar month for this organization.
 */

export type Plan = 'free' | 'starter' | 'team' | 'enterprise'

export const MONTHLY_REQUEST_LIMITS: Record<Plan, number | null> = {
  free: 50_000,
  starter: 100_000,
  team: 1_000_000,
  enterprise: null, // unlimited
}

// Projects are an organizational unit (separating different LLM apps inside
// the same team), not a billing lever. The standard pricing pattern in this
// category is to give unlimited projects on every tier; the billable
// dimensions are usage, retention, and seats. We follow the same pattern.
// The constant is kept so future tiers can reintroduce a limit without
// touching every call site.
export const PROJECT_LIMITS: Record<Plan, number | null> = {
  free: null,
  starter: null,
  team: null,
  enterprise: null,
}

export const LOG_RETENTION_DAYS: Record<Plan, number> = {
  free: 14,
  starter: 90,
  team: 365,
  // Enterprise default — extendable by separate contract. Previously 36500
  // (100 years, effectively unlimited), but that conflicted with the
  // published Privacy Policy and made GDPR data-minimization harder to
  // justify. 365d aligns with the longest standard tier.
  enterprise: 365,
}

// Team seat limits per plan. enforced when inviting members.
// null = unlimited (Enterprise only).
export const SEAT_LIMITS: Record<Plan, number | null> = {
  free: 1,
  starter: 3,
  team: 10,
  enterprise: null,
}

// Per-100K overage rate in USD. null = no overage allowed (Free) or custom (Enterprise).
export const OVERAGE_USD_PER_100K: Record<Plan, number | null> = {
  free: null,
  starter: 8,
  team: 5,
  enterprise: null,
}

// Max number of workspaces a single user can OWN (be `owner_id` of). Counted
// across all their owned organizations regardless of which plan each one is
// on. Limits "free tier quota multiplication" (a free user splitting traffic
// across N workspaces to N×50K free quota) without restricting how many
// workspaces they can JOIN as a member — joining is unbounded because the
// owner of that workspace is paying for it. null = unlimited (Enterprise).
//
// The check uses the user's "effective plan" = the highest tier among the
// workspaces they own. Upgrading any single owned workspace immediately
// raises the cap. See `effectiveOwnedPlan()` and POST /api/v1/organizations.
export const OWNED_WORKSPACE_LIMITS: Record<Plan, number | null> = {
  free: 1,
  starter: 2,
  team: 5,
  enterprise: null,
}

// Highest-to-lowest plan order. Used by `effectiveOwnedPlan()` to pick the
// strongest tier across a user's owned workspaces (so upgrading one workspace
// to Team gives the user Team-level workspace-creation rights everywhere).
const PLAN_RANK: Record<Plan, number> = {
  free: 0,
  starter: 1,
  team: 2,
  enterprise: 3,
}

/**
 * Returns the highest-tier plan from a list. Used to compute a user's
 * effective workspace-creation rights from their owned workspaces' plans.
 * Empty input falls back to `'free'` (the implicit floor before any
 * workspace exists, e.g. for defensive checks in the very first bootstrap).
 */
export function effectiveOwnedPlan(plans: ReadonlyArray<Plan>): Plan {
  let best: Plan = 'free'
  for (const p of plans) {
    if (PLAN_RANK[p] > PLAN_RANK[best]) best = p
  }
  return best
}

/**
 * Counts `requests` rows for an org from `since` to now, bypassing plan
 * retention. Used by billing quota checks and Paddle overage accounting —
 * the metering window is the calendar/billing period, not the dashboard
 * retention window.
 *
 * Exposed at the top of the file so callers can reuse it without rebuilding
 * the same ClickHouse query.
 */
export async function countMonthlyRequests(
  organizationId: string,
  since: Date,
  until?: Date,
): Promise<number> {
  // ClickHouse DateTime64 won't accept the trailing 'Z' that Date.toISOString
  // produces — same gotcha logger.ts hits when inserting. We strip it here too.
  const sinceTs = since.toISOString().replace('T', ' ').replace('Z', '')
  const untilTs = until ? until.toISOString().replace('T', ' ').replace('Z', '') : null

  const params: Record<string, unknown> = { orgId: organizationId, since: sinceTs }
  let where =
    'organization_id = {orgId:UUID} ' +
    'AND created_at >= parseDateTime64BestEffort({since:String})'
  if (untilTs) {
    params['until'] = untilTs
    where += ' AND created_at < parseDateTime64BestEffort({until:String})'
  }

  const result = await unscopedClickhouse().query({
    query: `SELECT count() AS n FROM requests WHERE ${where}`,
    query_params: params,
    format: 'JSONEachRow',
  })
  const rows = (await result.json()) as Array<{ n: string | number }>
  return Number(rows[0]?.n ?? 0)
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

// ---------------------------------------------------------------------------
// Hot-path caches (P3.1). enforceQuota runs checkMonthlyQuota on EVERY /proxy/*
// request; uncached it cost one Supabase SELECT + one full-month ClickHouse
// count() scan per request. Both are now cached per org with a short TTL +
// in-flight coalescing (same pattern as getOrgPlan in requests-query.ts).
//
// Trade-off: the monthly count can lag real traffic by up to COUNT_TTL_MS. The
// quota band tolerates this — the free-tier block is a soft monetization gate,
// not a security boundary, and BYOK means overage past the boundary costs us
// nothing. Billing/overage accounting uses countMonthlyRequests directly
// (paddle-usage.ts, quota-warnings.ts), NOT this cache, so it is unaffected.
// A future refinement (an in-memory counter incremented from logRequestAsync)
// could make the cached count exact between refreshes; deferred as higher-risk.
// ---------------------------------------------------------------------------

interface CachedQuotaSettings {
  plan: Plan
  allowOverage: boolean
  capMultiplier: number
  expiresAt: number
}
const SETTINGS_TTL_MS = 30 * 1000
const settingsCache = new Map<string, CachedQuotaSettings>()
const settingsInflight = new Map<string, Promise<CachedQuotaSettings>>()

async function getOrgQuotaSettings(organizationId: string): Promise<CachedQuotaSettings> {
  const cached = settingsCache.get(organizationId)
  if (cached && cached.expiresAt > Date.now()) return cached
  const existing = settingsInflight.get(organizationId)
  if (existing) return existing

  const fetchPromise = (async (): Promise<CachedQuotaSettings> => {
    try {
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('plan, allow_overage, overage_cap_multiplier')
        .eq('id', organizationId)
        .single()
      const settings: CachedQuotaSettings = {
        plan: ((org?.plan as Plan) ?? 'free') as Plan,
        allowOverage: (org?.allow_overage as boolean | undefined) ?? true,
        capMultiplier: (org?.overage_cap_multiplier as number | undefined) ?? 5,
        expiresAt: Date.now() + SETTINGS_TTL_MS,
      }
      settingsCache.set(organizationId, settings)
      return settings
    } finally {
      settingsInflight.delete(organizationId)
    }
  })()
  settingsInflight.set(organizationId, fetchPromise)
  return fetchPromise
}

interface CachedMonthCount {
  count: number
  monthKey: string
  expiresAt: number
}
const COUNT_TTL_MS = 10 * 1000
const countCache = new Map<string, CachedMonthCount>()
const countInflight = new Map<string, Promise<number>>()

async function getCachedMonthlyCount(
  organizationId: string,
  monthStart: Date,
): Promise<number> {
  const monthKey = monthStart.toISOString().slice(0, 7) // YYYY-MM
  const cached = countCache.get(organizationId)
  if (cached && cached.monthKey === monthKey && cached.expiresAt > Date.now()) {
    return cached.count
  }
  const existing = countInflight.get(organizationId)
  if (existing) return existing

  const fetchPromise = (async (): Promise<number> => {
    try {
      const count = await countMonthlyRequests(organizationId, monthStart)
      countCache.set(organizationId, { count, monthKey, expiresAt: Date.now() + COUNT_TTL_MS })
      return count
    } finally {
      countInflight.delete(organizationId)
    }
  })()
  countInflight.set(organizationId, fetchPromise)
  return fetchPromise
}

/** Test/escape hatch — flush the quota hot-path caches. */
export function resetQuotaCaches(): void {
  settingsCache.clear()
  settingsInflight.clear()
  countCache.clear()
  countInflight.clear()
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
 * Org settings + the month count are cached per org (short TTL) so the proxy
 * hot path does not hit Supabase + ClickHouse on every request. Falls back to
 * 'free' + conservative defaults on any lookup failure.
 */
export async function checkMonthlyQuota(
  organizationId: string,
): Promise<QuotaCheckResult> {
  const { plan, allowOverage, capMultiplier } = await getOrgQuotaSettings(organizationId)

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

  // Billing accuracy: count the full UTC month, bypassing plan retention.
  // Free's 14-day window would otherwise undercount usage past day 14.
  let used: number
  try {
    used = await getCachedMonthlyCount(organizationId, monthStart)
  } catch (err) {
    // ClickHouse unreachable — FAIL OPEN. This runs on every /proxy/* request;
    // if the count lookup throws, letting it propagate would 500 the whole
    // proxy on a CH outage (the exact scenario the requests_fallback queue,
    // gotcha #23, was built to survive). The quota band is a soft monetization
    // gate, not a security boundary, and BYOK means traffic past the limit
    // costs us nothing — so allowing the request through is the safe direction.
    console.error('[quota] monthly count lookup failed, failing open:', err)
    return {
      allowed: true,
      usedThisMonth: 0,
      limit,
      plan,
      overageActive: false,
      allowOverage,
      capMultiplier,
    }
  }

  // Apply Pattern C policy
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
