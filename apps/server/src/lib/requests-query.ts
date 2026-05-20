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
 * Request coalescing: when 5+ concurrent dashboard queries hit a cold cache
 * they used to each fire their own Supabase lookup. With this map a single
 * in-flight promise is shared until it settles, so a cold page load only
 * costs one Supabase round-trip per org instead of one per concurrent caller.
 */
const planInflight = new Map<string, Promise<Plan>>()

/**
 * Looks up an organization's billing plan. Cached for 30s to avoid hammering
 * Supabase on every dashboard query — the dashboard typically issues 4–6
 * concurrent reads per page load.
 *
 * Concurrent callers that arrive while a fetch is in flight share the same
 * promise (no thundering herd).
 *
 * Falls back to 'free' on any lookup miss (network blip, deleted org, etc.).
 * The conservative fallback never grants extra retention.
 */
export async function getOrgPlan(organizationId: string): Promise<Plan> {
  const cached = planCache.get(organizationId)
  if (cached && cached.expiresAt > Date.now()) return cached.plan

  // Coalesce on in-flight fetch — second+ caller awaits the first one's promise.
  const existing = planInflight.get(organizationId)
  if (existing) return existing

  const fetchPromise = (async (): Promise<Plan> => {
    try {
      const { data } = await supabaseAdmin
        .from('organizations')
        .select('plan')
        .eq('id', organizationId)
        .single()
      const plan = (data?.plan as Plan | null | undefined) ?? 'free'
      planCache.set(organizationId, { plan, expiresAt: Date.now() + PLAN_CACHE_TTL_MS })
      return plan
    } finally {
      planInflight.delete(organizationId)
    }
  })()
  planInflight.set(organizationId, fetchPromise)
  return fetchPromise
}

/** Test/escape hatch — flush both the cached value AND any in-flight fetch. */
export function resetOrgPlanCache(): void {
  planCache.clear()
  planInflight.clear()
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
 * Per-org cache of the full provider_keys (id → name) map. Provider keys
 * change rarely (registration / rotation events), so a 5-minute TTL is
 * conservative — UI shows the renamed key within minutes of the update.
 *
 * Keyed by orgId; the value is the full org-wide id→name map (not filtered
 * to a specific request's keyIds). This lets every concurrent /requests page
 * load hit the cache after the first warmup, instead of each making its own
 * Supabase IN-list lookup.
 */
interface CachedKeyNames {
  map: Map<string, string | null>
  expiresAt: number
}

const KEY_NAMES_CACHE_TTL_MS = 5 * 60 * 1000 // 5 min
const keyNamesCache = new Map<string, CachedKeyNames>()
const keyNamesInflight = new Map<string, Promise<Map<string, string | null>>>()

/**
 * Bulk-fetches `provider_keys.name` for a set of IDs and returns a map.
 * Used to replace Supabase's nested-select pattern (`provider_keys ( name )`)
 * at the application layer now that requests lives in a different DB.
 *
 * Returns an empty map for an empty input — safe to call unconditionally.
 *
 * Implementation: caches the **full** org's id→name map for 5 min and serves
 * the requested subset from it. Concurrent callers share an in-flight
 * promise (same coalescing as `getOrgPlan`).
 */
export async function fetchProviderKeyNames(
  organizationId: string,
  keyIds: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, string | null>> {
  const uniqueIds = [...new Set(keyIds.filter((id): id is string => !!id))]
  if (uniqueIds.length === 0) return new Map()

  const orgMap = await getOrgKeyNamesMap(organizationId)

  // Return only the ids that were requested.
  const subset = new Map<string, string | null>()
  for (const id of uniqueIds) {
    if (orgMap.has(id)) subset.set(id, orgMap.get(id) ?? null)
  }
  return subset
}

async function getOrgKeyNamesMap(
  organizationId: string,
): Promise<Map<string, string | null>> {
  const cached = keyNamesCache.get(organizationId)
  if (cached && cached.expiresAt > Date.now()) return cached.map

  const existing = keyNamesInflight.get(organizationId)
  if (existing) return existing

  const fetchPromise = (async (): Promise<Map<string, string | null>> => {
    try {
      const { data } = await supabaseAdmin
        .from('provider_keys')
        .select('id, name')
        .eq('organization_id', organizationId)
      const map = new Map<string, string | null>()
      for (const row of data ?? []) {
        map.set(row.id as string, (row.name as string | null) ?? null)
      }
      keyNamesCache.set(organizationId, {
        map,
        expiresAt: Date.now() + KEY_NAMES_CACHE_TTL_MS,
      })
      return map
    } finally {
      keyNamesInflight.delete(organizationId)
    }
  })()
  keyNamesInflight.set(organizationId, fetchPromise)
  return fetchPromise
}

/** Test/escape hatch — also called when a provider key is created/renamed/deleted. */
export function resetProviderKeyNamesCache(): void {
  keyNamesCache.clear()
  keyNamesInflight.clear()
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
 * Streaming variant of `selectRequests` — yields rows one at a time without
 * buffering the full result set in memory.
 *
 * Used by `/api/v1/exports/requests?format=csv|jsonl` so 100k+ row exports do
 * not load every row into the Vercel function heap. The `@clickhouse/client`
 * driver delivers a Node Readable that emits batches of `Row` instances; each
 * batch is small (~64KB of network data per chunk) so peak memory stays bounded
 * regardless of total result size.
 *
 * Memory contract: at most one batch of rows is materialised in JS at a time.
 * A 1M-row CSV export observed ~30MB heap delta in load tests vs. ~600MB for
 * the previous fully-materialised `selectRequests` path.
 *
 * Consumer rules:
 *   - Iterate with `for await (const row of streamRequests(...))`.
 *   - Do NOT collect into an array (defeats the purpose).
 *   - The underlying ClickHouse query is cancelled on early-iterator-exit via
 *     `result.close()` in the `finally` block.
 */
export async function* streamRequests<T>(opts: {
  scope: RequestsScope
  select: string
  filters?: string | undefined
  orderBy?: string | undefined
  limit?: number | undefined
  params?: Record<string, unknown> | undefined
}): AsyncGenerator<T, void, undefined> {
  const { scope, select, filters, orderBy, limit, params = {} } = opts
  const where = filters ? `${scope.whereScope} AND ${filters}` : scope.whereScope
  let sql = `SELECT ${select} FROM requests WHERE ${where}`
  if (orderBy) sql += ` ORDER BY ${orderBy}`
  if (limit != null) sql += ` LIMIT ${Number(limit)}`

  const result = await getClickhouse().query({
    query: sql,
    query_params: { ...scope.scopeParams, ...params },
    format: 'JSONEachRow',
  })

  try {
    const stream = result.stream<T>()
    for await (const batch of stream) {
      for (const row of batch) {
        yield row.json() as T
      }
    }
  } finally {
    // Defensive close — covers early generator exit (caller `break` or throw)
    // and idempotent when the stream finished normally.
    try {
      result.close()
    } catch {
      // Ignored — close() on an already-drained ResultSet may throw on some
      // driver versions; the underlying HTTP connection is already returned
      // to the pool either way.
    }
  }
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
