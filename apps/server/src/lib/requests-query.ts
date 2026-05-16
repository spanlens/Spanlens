import { getClickhouse } from './clickhouse.js'
import { supabaseAdmin } from './db.js'
import { LOG_RETENTION_DAYS, type Plan } from './quota.js'

/**
 * Query-layer plumbing for the ClickHouse `requests` table.
 *
 * Two responsibilities, encapsulated here so every read path enforces them
 * uniformly:
 *
 *   1. **Tenant isolation** — ClickHouse has no RLS. Every WHERE must filter
 *      `organization_id`. Missing the filter would leak cross-org data.
 *
 *   2. **Plan retention** — Free is 14 days, Pro 90, Team 365. The table
 *      itself is TTLed to 365 days (the longest non-Enterprise plan), so
 *      shorter retention is enforced at query time by clipping the WHERE
 *      window. Pre-launch this is a no-op (empty table), but the helper
 *      lands in place before any data flows.
 *
 * See docs/plans/clickhouse-migration.md §3.1 for the policy.
 */

interface CachedPlan {
  plan: Plan
  expiresAt: number
}

const PLAN_CACHE_TTL_MS = 30 * 1000 // 30s — short enough that downgrades take effect quickly
const planCache = new Map<string, CachedPlan>()

/**
 * Looks up an organization's billing plan. Cached for 30s to avoid hammering
 * Supabase on every dashboard query — the dashboard typically issues 4–6
 * concurrent reads per page load.
 *
 * Falls back to 'free' on any lookup miss (network blip, deleted org, etc.).
 * The conservative fallback never grants extra retention.
 */
export async function getOrgPlan(organizationId: string): Promise<Plan> {
  const cached = planCache.get(organizationId)
  if (cached && cached.expiresAt > Date.now()) return cached.plan

  const { data } = await supabaseAdmin
    .from('organizations')
    .select('plan')
    .eq('id', organizationId)
    .single()

  const plan = ((data?.plan as Plan | null | undefined) ?? 'free')
  planCache.set(organizationId, { plan, expiresAt: Date.now() + PLAN_CACHE_TTL_MS })
  return plan
}

/** Test/escape hatch — flush the cache when a plan changes mid-test. */
export function resetOrgPlanCache(): void {
  planCache.clear()
}

export interface RequestsScope {
  /**
   * SQL fragment that must appear at the start of every WHERE clause against
   * `requests`. No leading WHERE / AND.
   */
  readonly whereScope: string
  /** Params to merge into the final `query_params` object. */
  readonly scopeParams: Readonly<{ orgId: string; retentionDays: number }>
  /** The org's plan, exposed for callers that need to vary behavior (e.g. limits). */
  readonly plan: Plan
}

export interface RequestsScopeOptions {
  /**
   * Skip the plan retention window. Required for billing/quota counters
   * and admin/cron jobs that need to see the full month (or full table)
   * regardless of which retention tier the org is on.
   *
   * Do NOT use for user-facing reads — the dashboard must respect plan
   * retention or Free users would see data past their tier.
   */
  readonly ignoreRetention?: boolean
}

/**
 * Resolves the org + retention WHERE scope for `requests` queries.
 * Callers must include `whereScope` in every query and merge `scopeParams`
 * into `query_params` — there is no escape hatch for tenant isolation.
 *
 * Example:
 *   const { whereScope, scopeParams } = await requestsScope(orgId)
 *   const result = await getClickhouse().query({
 *     query: `SELECT id FROM requests WHERE ${whereScope} AND provider = {provider:String}`,
 *     query_params: { ...scopeParams, provider: 'openai' },
 *     format: 'JSONEachRow',
 *   })
 */
export async function requestsScope(
  organizationId: string,
  options: RequestsScopeOptions = {},
): Promise<RequestsScope> {
  const plan = await getOrgPlan(organizationId)
  const retentionDays = LOG_RETENTION_DAYS[plan]
  const whereScope = options.ignoreRetention
    ? 'organization_id = {orgId:UUID}'
    : 'organization_id = {orgId:UUID} ' +
      'AND created_at >= now() - INTERVAL {retentionDays:UInt32} DAY'
  return {
    whereScope,
    scopeParams: { orgId: organizationId, retentionDays },
    plan,
  }
}

/**
 * Bulk-fetches `provider_keys.name` for a set of IDs and returns a map.
 * Used to replace Supabase's nested-select pattern (`provider_keys ( name )`)
 * at the application layer now that requests lives in a different DB.
 *
 * Returns an empty map for an empty input — safe to call unconditionally.
 */
export async function fetchProviderKeyNames(
  organizationId: string,
  keyIds: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, string | null>> {
  const uniqueIds = [...new Set(keyIds.filter((id): id is string => !!id))]
  if (uniqueIds.length === 0) return new Map()

  const { data } = await supabaseAdmin
    .from('provider_keys')
    .select('id, name')
    .eq('organization_id', organizationId)
    .in('id', uniqueIds)

  const map = new Map<string, string | null>()
  for (const row of data ?? []) {
    map.set(row.id as string, (row.name as string | null) ?? null)
  }
  return map
}

/**
 * Convenience runner: executes a parametrized ClickHouse query against the
 * `requests` table with the org-scope already injected. The caller still
 * writes their SELECT/ORDER/LIMIT — this just removes boilerplate around the
 * WHERE prefix and JSON parsing.
 *
 * Returns the parsed rows (JSONEachRow format).
 */
export async function selectRequests<T>(opts: {
  scope: RequestsScope
  select: string                            // e.g. 'id, provider, model'
  filters?: string | undefined              // additional WHERE conditions, no leading AND
  orderBy?: string | undefined              // e.g. 'created_at DESC'
  limit?: number | undefined
  offset?: number | undefined
  params?: Record<string, unknown> | undefined
}): Promise<T[]> {
  const { scope, select, filters, orderBy, limit, offset, params = {} } = opts
  const where = filters ? `${scope.whereScope} AND ${filters}` : scope.whereScope
  let sql = `SELECT ${select} FROM requests WHERE ${where}`
  if (orderBy) sql += ` ORDER BY ${orderBy}`
  if (limit != null) sql += ` LIMIT ${Number(limit)}`
  if (offset != null) sql += ` OFFSET ${Number(offset)}`

  const result = await getClickhouse().query({
    query: sql,
    query_params: { ...scope.scopeParams, ...params },
    format: 'JSONEachRow',
  })
  return (await result.json()) as T[]
}

/**
 * Counts rows in `requests` matching the scope + optional extra filters.
 * Returns a number (parsed from ClickHouse's String representation of UInt64).
 */
export async function countRequests(opts: {
  scope: RequestsScope
  filters?: string | undefined
  params?: Record<string, unknown> | undefined
}): Promise<number> {
  const { scope, filters, params = {} } = opts
  const where = filters ? `${scope.whereScope} AND ${filters}` : scope.whereScope
  const result = await getClickhouse().query({
    query: `SELECT count() AS n FROM requests WHERE ${where}`,
    query_params: { ...scope.scopeParams, ...params },
    format: 'JSONEachRow',
  })
  const rows = (await result.json()) as Array<{ n: string | number }>
  return Number(rows[0]?.n ?? 0)
}
