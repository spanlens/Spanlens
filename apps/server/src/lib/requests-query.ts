import { pgQuery, pgStream } from './postgres.js'
import { supabaseAdmin } from './db.js'
import { LOG_RETENTION_DAYS, type Plan } from './quota.js'

/**
 * Query-layer plumbing for the Postgres `requests` table.
 *
 * Two responsibilities, encapsulated here so every read path enforces them
 * uniformly:
 *
 *   1. **Tenant isolation**: the pooled application connection bypasses RLS,
 *      as `supabaseAdmin` always did. Every WHERE must filter
 *      `organization_id`. Missing the filter would leak cross-org data.
 *      History: this table spent a year in a store with no row security of
 *      any kind, so isolation was built in this layer and there is still no
 *      database-side policy underneath it to catch a query that forgets.
 *
 *   2. **Plan retention**: Free is 14 days, Pro 90, Team 365. Rows are hard
 *      deleted at 365 days by dropping the month's partition; shorter
 *      per-plan retention is enforced at query time by clipping the WHERE
 *      window. Keeping both layers means a plan upgrade makes older data
 *      visible again rather than finding it already deleted.
 *
 * The retention policy itself is recorded in
 * docs/plans/clickhouse-migration.md §3.1.
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
 *   const rows = await pgQuery<Row>({
 *     query: `SELECT id FROM requests WHERE ${whereScope} AND provider = {provider}`,
 *     params: { ...scopeParams, provider: 'openai' },
 *   })
 */
export async function requestsScope(
  organizationId: string,
  options: RequestsScopeOptions = {},
): Promise<RequestsScope> {
  const plan = await getOrgPlan(organizationId)
  const retentionDays = LOG_RETENTION_DAYS[plan]
  // `INTERVAL $1 DAY` is a syntax error in Postgres — the unit cannot be
  // parameterised. make_interval() takes the count as a named argument
  // instead, which keeps the value bound rather than interpolated.
  const whereScope = options.ignoreRetention
    ? 'organization_id = {orgId}'
    : 'organization_id = {orgId} ' +
      'AND created_at >= now() - make_interval(days => {retentionDays})'
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
 * Returns, for each of the given provider keys, the timestamp of the most
 * recent request that used it.
 *
 * One query rather than one per key: `/api/v1/provider-keys` renders this
 * column for every key on the page, and the pre-migration version issued a
 * round trip each time.
 *
 * `ignoreRetention` is deliberate. A key that has sat unused past the plan's
 * retention window still needs to report when it was last used — that is
 * precisely the case the column exists to surface. Tenant isolation still
 * comes from `requestsScope`.
 *
 * Never throws: the last-used column is decoration on a page whose real
 * content is the key list, so a failure here returns an empty map and the UI
 * shows "never used" rather than an error.
 */
export async function fetchProviderKeyLastUsed(
  organizationId: string,
  keyIds: ReadonlyArray<string>,
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (keyIds.length === 0) return result

  try {
    const scope = await requestsScope(organizationId, { ignoreRetention: true })
    const rows = await pgQuery<{ id: string; last_used_at: string }>({
      query:
        'SELECT provider_key_id AS id, max(created_at) AS last_used_at ' +
        'FROM requests ' +
        `WHERE ${scope.whereScope} ` +
        '  AND provider_key_id = ANY({keyIds}::uuid[]) ' +
        'GROUP BY provider_key_id',
      params: { ...scope.scopeParams, keyIds: [...keyIds] },
    })
    for (const row of rows) result.set(row.id, row.last_used_at)
  } catch (err) {
    console.error(
      '[requests-query] provider-key last-used lookup failed:',
      err instanceof Error ? err.message : err,
    )
  }
  return result
}

/**
 * Convenience runner: executes a parametrized query against the `requests`
 * table with the org-scope already injected. The caller still writes their
 * SELECT/ORDER/LIMIT — this just removes boilerplate around the WHERE prefix.
 *
 * `select`, `filters` and `orderBy` are SQL fragments and must never carry a
 * caller-supplied value; bind those through `params` as `{name}` placeholders.
 * `limit`/`offset` are coerced with `Number()` before interpolation.
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

  return pgQuery<T & Record<string, unknown>>({
    query: sql,
    params: { ...scope.scopeParams, ...params },
  }) as Promise<T[]>
}

/**
 * Streaming variant of `selectRequests` — yields rows one at a time without
 * buffering the full result set in memory.
 *
 * Used by `/api/v1/exports/requests?format=csv|jsonl` so 100k+ row exports do
 * not load every row into the Vercel function heap. Backed by a server-side
 * cursor (`pg-query-stream`), which fetches a batch at a time and keeps peak
 * memory bounded regardless of total result size.
 *
 * This is the single reason the server needed a real Postgres driver rather
 * than going through PostgREST: there is no cursor over the REST API, so a
 * large export would have to be either fully materialised or paginated across
 * a thousand round trips.
 *
 * Memory contract: at most one batch of rows is materialised in JS at a time.
 * A 1M-row CSV export observed ~30MB heap delta in load tests vs. ~600MB for
 * the previous fully-materialised `selectRequests` path.
 *
 * Consumer rules:
 *   - Iterate with `for await (const row of streamRequests(...))`.
 *   - Do NOT collect into an array (defeats the purpose).
 *   - Finish or abandon the iterator promptly — the cursor holds one pooled
 *     connection for the life of the iteration. `pgStream` releases it in a
 *     `finally`, so an early `break` or throw still returns the client.
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

  yield* pgStream<T & Record<string, unknown>>({
    query: sql,
    params: { ...scope.scopeParams, ...params },
  }) as AsyncGenerator<T, void, undefined>
}

/**
 * Counts rows in `requests` matching the scope + optional extra filters.
 *
 * `count(*)` comes back as `int8`, which the driver hands over as a string so
 * that values past 2^53 do not silently lose precision. Coerced here so
 * callers get a number.
 */
export async function countRequests(opts: {
  scope: RequestsScope
  filters?: string | undefined
  params?: Record<string, unknown> | undefined
}): Promise<number> {
  const { scope, filters, params = {} } = opts
  const where = filters ? `${scope.whereScope} AND ${filters}` : scope.whereScope
  const rows = await pgQuery<{ n: string | number }>({
    query: `SELECT count(*) AS n FROM requests WHERE ${where}`,
    params: { ...scope.scopeParams, ...params },
  })
  return Number(rows[0]?.n ?? 0)
}
