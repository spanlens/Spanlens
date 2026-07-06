/**
 * Phase 5.1 events table query helpers.
 *
 * Mirrors the contract of `requests-query.ts` (tenant isolation +
 * plan retention) for the new `events` table. Reads against `events`
 * MUST go through `eventsScope()` so they:
 *
 *   1. Filter `organization_id` (ClickHouse has no RLS).
 *   2. Clip the time window to the org's plan retention.
 *
 * NOTE: in Stage 1 nothing reads from `events` yet — this file ships
 * with the dual-write so the eventual reading-switch PR (Stage 3) is
 * a pure flag flip, not a "design the query layer" PR. Tests still
 * cover the helpers so the contract is locked in.
 */

import { unscopedClickhouse } from './clickhouse.js'
import { LOG_RETENTION_DAYS, type Plan } from './quota.js'
import { getOrgPlan } from './requests-query.js'

export interface EventsScope {
  /**
   * SQL fragment that must appear at the start of every WHERE clause
   * against `events`. No leading WHERE / AND.
   */
  readonly whereScope: string
  readonly scopeParams: Readonly<{ orgId: string; retentionDays: number }>
  readonly plan: Plan
}

export interface EventsScopeOptions {
  /**
   * Skip the plan retention window. Required for billing / quota / admin
   * paths. Do NOT use for user-facing reads.
   */
  readonly ignoreRetention?: boolean
}

/**
 * Resolves the org + retention WHERE scope for `events` queries.
 */
export async function eventsScope(
  organizationId: string,
  options: EventsScopeOptions = {},
): Promise<EventsScope> {
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
 * Select rows from `events`. Same signature as `selectRequests` to make
 * the eventual reading-switch (Stage 3) a near-mechanical replacement.
 *
 * `select` is interpolated raw into the SELECT clause — callers MUST
 * keep it free of user input.
 */
export async function selectEvents<T>(opts: {
  scope: EventsScope
  select: string
  filters?: string | undefined
  params?: Record<string, unknown> | undefined
  orderBy?: string | undefined
  limit?: number | undefined
  offset?: number | undefined
}): Promise<T[]> {
  const { scope, select, filters, params, orderBy, limit, offset } = opts

  const whereParts = [scope.whereScope]
  if (filters && filters.length > 0) whereParts.push(filters)
  const where = whereParts.join(' AND ')

  const tail: string[] = []
  if (orderBy) tail.push(`ORDER BY ${orderBy}`)
  if (typeof limit === 'number') tail.push(`LIMIT ${Math.max(0, Math.floor(limit))}`)
  if (typeof offset === 'number') tail.push(`OFFSET ${Math.max(0, Math.floor(offset))}`)

  const query = `SELECT ${select} FROM events WHERE ${where} ${tail.join(' ')}`.trim()

  const res = await unscopedClickhouse().query({
    query,
    query_params: { ...scope.scopeParams, ...(params ?? {}) },
    format: 'JSONEachRow',
  })
  return (await res.json()) as T[]
}

/**
 * COUNT(*) variant. Callers don't have to thread "select count(*)"
 * through the same pipeline.
 */
export async function countEvents(opts: {
  scope: EventsScope
  filters?: string | undefined
  params?: Record<string, unknown> | undefined
}): Promise<number> {
  const { scope, filters, params } = opts
  const whereParts = [scope.whereScope]
  if (filters && filters.length > 0) whereParts.push(filters)
  const where = whereParts.join(' AND ')
  const query = `SELECT count() AS c FROM events WHERE ${where}`
  const res = await unscopedClickhouse().query({
    query,
    query_params: { ...scope.scopeParams, ...(params ?? {}) },
    format: 'JSONEachRow',
  })
  const rows = (await res.json()) as Array<{ c: string }>
  return Number(rows[0]?.c ?? 0)
}

/**
 * Phase 5.1 Stage 3 — read-side compatibility shim for the
 * `/api/v1/requests` list endpoint.
 *
 * Selects `event_type='generation'` rows from `events` and projects
 * the columns into the shape the requests router already returns to
 * the dashboard. Columns the events table doesn't carry (security
 * flags, truncation marker) fall back to neutral defaults so the
 * dashboard's badges stay consistent — Stage 3 is a read switch,
 * not a feature regression.
 *
 * `extraFilters` is concatenated with AND to the events-scoped
 * WHERE. Callers should NOT include `event_type` themselves; this
 * helper adds it.
 */
export async function selectGenerationsAsRequests<T>(opts: {
  scope: EventsScope
  filters?: string | undefined
  params?: Record<string, unknown> | undefined
  orderBy?: string | undefined
  limit?: number | undefined
  offset?: number | undefined
}): Promise<T[]> {
  const { scope, filters, params, orderBy, limit, offset } = opts

  const whereParts = [scope.whereScope, "event_type = 'generation'"]
  if (filters && filters.length > 0) whereParts.push(filters)
  const where = whereParts.join(' AND ')

  const tail: string[] = []
  if (orderBy) tail.push(`ORDER BY ${orderBy}`)
  // Dedup: the dual-write + the requests→events backfill can leave two
  // identical rows per event_id (events is a plain MergeTree — no
  // ReplacingMergeTree collapse). Keep one row per id so the list isn't
  // doubled. LIMIT BY must precede the pagination LIMIT/OFFSET.
  tail.push('LIMIT 1 BY id')
  if (typeof limit === 'number') tail.push(`LIMIT ${Math.max(0, Math.floor(limit))}`)
  if (typeof offset === 'number') tail.push(`OFFSET ${Math.max(0, Math.floor(offset))}`)

  // Column aliases match the existing requests-router SELECT exactly
  // so the post-query mapping (cost coercion, key-name lookup, etc.)
  // works unchanged. usage_details map lookups default to 0 when the
  // key is absent.
  const query = `
    SELECT
      toString(event_id)                          AS id,
      project_id,
      provider,
      model,
      toUInt32OrZero(toString(usage_details['prompt_tokens']))     AS prompt_tokens,
      toUInt32OrZero(toString(usage_details['completion_tokens'])) AS completion_tokens,
      toUInt32OrZero(toString(usage_details['total_tokens']))      AS total_tokens,
      toUInt32OrZero(toString(usage_details['cache_read_tokens'])) AS cache_read_tokens,
      toUInt32OrZero(toString(usage_details['cache_write_tokens']))AS cache_write_tokens,
      total_cost_usd                              AS cost_usd,
      duration_ms                                 AS latency_ms,
      status_code,
      input                                       AS request_body,
      output                                      AS response_body,
      error_message,
      trace_id,
      parent_event_id                             AS span_id,
      provider_key_id,
      user_id,
      session_id,
      -- Security flags + truncation marker: real columns since migration 006
      -- (populated by writeRequestAsEvent). The 007 events_as_requests view
      -- already projects these; this shim now matches so the dashboard's
      -- security / truncated badges work under the events read path.
      flags,
      response_flags,
      has_security_flags,
      truncated,
      toString(created_at)                        AS created_at
    FROM events
    WHERE ${where}
    ${tail.join(' ')}
  `.trim()

  try {
    const res = await unscopedClickhouse().query({
      query,
      query_params: { ...scope.scopeParams, ...(params ?? {}) },
      format: 'JSONEachRow',
    })
    return (await res.json()) as T[]
  } catch (err) {
    // Phase 5.1 Stage 3 root-cause hunt — dump the exact query, scope,
    // and caller params so the next Vercel log shows what actually
    // failed instead of a one-line generic message. Remove this
    // helper once the events path is stable.
    console.error('[events-query:selectGenerationsAsRequests] FAILED', {
      query,
      query_params: { ...scope.scopeParams, ...(params ?? {}) },
      filters,
      orderBy,
      limit,
      offset,
      err_message: err instanceof Error ? err.message : String(err),
      err_stack: err instanceof Error ? err.stack : undefined,
    })
    throw err
  }
}

/** Companion COUNT used by the same flag branch in /api/v1/requests. */
export async function countGenerations(opts: {
  scope: EventsScope
  filters?: string | undefined
  params?: Record<string, unknown> | undefined
}): Promise<number> {
  const { scope, filters, params } = opts
  const whereParts = [scope.whereScope, "event_type = 'generation'"]
  if (filters && filters.length > 0) whereParts.push(filters)
  const where = whereParts.join(' AND ')
  // uniqExact(event_id) — NOT count() — because dual-write + backfill can
  // leave duplicate rows per event_id (plain MergeTree, no collapse). count()
  // would double the total; the exact distinct id count matches the deduped
  // list from selectGenerationsAsRequests (LIMIT 1 BY id).
  const query = `SELECT uniqExact(event_id) AS c FROM events WHERE ${where}`
  try {
    const res = await unscopedClickhouse().query({
      query,
      query_params: { ...scope.scopeParams, ...(params ?? {}) },
      format: 'JSONEachRow',
    })
    const rows = (await res.json()) as Array<{ c: string }>
    return Number(rows[0]?.c ?? 0)
  } catch (err) {
    console.error('[events-query:countGenerations] FAILED', {
      query,
      query_params: { ...scope.scopeParams, ...(params ?? {}) },
      filters,
      err_message: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}
