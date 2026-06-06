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

import { getClickhouse } from './clickhouse.js'
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
  filters?: string
  params?: Record<string, unknown>
  orderBy?: string
  limit?: number
  offset?: number
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

  const res = await getClickhouse().query({
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
  filters?: string
  params?: Record<string, unknown>
}): Promise<number> {
  const { scope, filters, params } = opts
  const whereParts = [scope.whereScope]
  if (filters && filters.length > 0) whereParts.push(filters)
  const where = whereParts.join(' AND ')
  const query = `SELECT count() AS c FROM events WHERE ${where}`
  const res = await getClickhouse().query({
    query,
    query_params: { ...scope.scopeParams, ...(params ?? {}) },
    format: 'JSONEachRow',
  })
  const rows = (await res.json()) as Array<{ c: string }>
  return Number(rows[0]?.c ?? 0)
}
