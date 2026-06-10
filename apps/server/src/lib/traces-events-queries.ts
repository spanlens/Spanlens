/**
 * Phase 5.1 PR-7b — ClickHouse read helpers for /api/v1/traces and
 * /api/v1/traces/:id. Mirrors the response shape the Postgres
 * implementation already returns so the router branch is a pure
 * data-source swap.
 *
 * SAFETY: ClickHouse has no RLS. Every helper takes an `organizationId`
 * and threads it into the WHERE clause as a parameterised UUID. There
 * is no path that issues a query without an org filter.
 *
 * Reads go against `traces_view` / `spans_view` (clickhouse/migrations/
 * 008). The views project the events schema into the legacy column
 * names, so the SQL here looks almost identical to a Postgres SELECT
 * against `traces` / `spans`.
 *
 * Where Postgres aggregates were pre-computed on the trace row
 * (span_count, total_tokens, total_cost_usd), this helper computes
 * them at read time via a single GROUP BY against spans_view — events
 * doesn't carry them as first-class columns.
 */

import { unscopedClickhouse, fromClickhouseTimestamp } from './clickhouse.js'

export interface TraceListOptions {
  organizationId: string
  projectId?: string | undefined
  status?: string | undefined
  from?: string | undefined
  to?: string | undefined
  q?: string | undefined
  limit: number
  offset: number
}

export interface TraceListRow {
  id: string
  project_id: string
  name: string
  status: string
  started_at: string
  ended_at: string | null
  duration_ms: number | null
  span_count: number
  total_tokens: number
  total_cost_usd: number
  error_message: string | null
  created_at: string
}

export interface TraceListResult {
  rows: TraceListRow[]
  total: number
}

/**
 * GET /api/v1/traces list path. Returns the page rows plus a total
 * count. The count is exact (ClickHouse count() on the filtered
 * view) — there's no Postgres-style 'planned' shortcut, but at
 * trace-table scale (≪1M) count() is still sub-second.
 */
export async function listTracesFromEvents(opts: TraceListOptions): Promise<TraceListResult> {
  const filters: string[] = ['t.organization_id = {orgId:UUID}']
  const params: Record<string, unknown> = { orgId: opts.organizationId }

  if (opts.projectId) {
    filters.push('t.project_id = {projectId:UUID}')
    params['projectId'] = opts.projectId
  }
  if (opts.status) {
    filters.push('t.status = {status:String}')
    params['status'] = opts.status
  }
  if (opts.from) {
    filters.push('t.started_at >= parseDateTime64BestEffort({fromTs:String})')
    params['fromTs'] = opts.from
  }
  if (opts.to) {
    filters.push('t.started_at <= parseDateTime64BestEffort({toTs:String})')
    params['toTs'] = opts.to
  }
  if (opts.q && opts.q.length > 0) {
    // ClickHouse has no `ilike`. We use positionCaseInsensitive for
    // the substring match against `name` (gotcha #20). For UUID-shaped
    // queries we additionally allow an exact id match.
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(opts.q)
    if (isUuid) {
      filters.push(
        '(positionCaseInsensitive(t.name, {q:String}) > 0 OR t.id = {qUuid:UUID})',
      )
      params['q'] = opts.q
      params['qUuid'] = opts.q
    } else {
      filters.push('positionCaseInsensitive(t.name, {q:String}) > 0')
      params['q'] = opts.q
    }
  }

  const where = filters.join(' AND ')

  // Aggregate span totals per trace_id. LEFT JOIN so a trace with
  // zero recorded spans still appears (matches the Postgres view
  // where span_count starts at 0).
  //
  // DEDUPE (R-12 Phase 3.2): `events` is append-only — a trace accrues
  // one row per lifecycle write (create, PATCH update, backfill re-insert),
  // all sharing the same event_id. Without `LIMIT 1 BY id` the list shows
  // the same trace once per lifecycle row (dogfood 2026-06-10 surfaced
  // exactly this). `ORDER BY created_at DESC LIMIT 1 BY id` keeps the
  // newest snapshot per trace; events-writer stamps update events with
  // eventTime=now so they win this tie-break.
  const listQuery = `
    SELECT
      toString(t.id)                          AS id,
      toString(t.project_id)                  AS project_id,
      t.name,
      t.status,
      toString(t.started_at)                  AS started_at,
      if(isNull(t.ended_at), NULL, toString(assumeNotNull(t.ended_at)))
                                              AS ended_at,
      t.duration_ms,
      toUInt32(coalesce(s.span_count, 0))     AS span_count,
      toUInt32(coalesce(s.total_tokens, 0))   AS total_tokens,
      toFloat64(coalesce(s.total_cost_usd, 0)) AS total_cost_usd,
      t.error_message,
      toString(t.created_at)                  AS created_at
    FROM (
      SELECT * FROM traces_view
      WHERE organization_id = {orgId:UUID}
      ORDER BY created_at DESC
      LIMIT 1 BY id
    ) t
    LEFT JOIN (
      SELECT
        trace_id,
        count() AS span_count,
        sum(total_tokens) AS total_tokens,
        sum(coalesce(cost_usd, 0)) AS total_cost_usd
      FROM (
        SELECT * FROM spans_view
        WHERE organization_id = {orgId:UUID}
        ORDER BY created_at DESC
        LIMIT 1 BY id
      )
      GROUP BY trace_id
    ) s ON s.trace_id = t.id
    WHERE ${where}
    ORDER BY t.started_at DESC
    LIMIT {lim:UInt32} OFFSET {off:UInt32}
  `.trim()

  // Count over the deduped set — and the WHERE must apply AFTER the
  // dedupe so a status filter sees each trace's latest snapshot only.
  const countQuery = `
    SELECT count() AS c FROM (
      SELECT * FROM traces_view
      WHERE organization_id = {orgId:UUID}
      ORDER BY created_at DESC
      LIMIT 1 BY id
    ) t WHERE ${where}
  `.trim()

  const ch = unscopedClickhouse()
  const [listRes, countRes] = await Promise.all([
    ch.query({
      query: listQuery,
      query_params: { ...params, lim: opts.limit, off: opts.offset },
      format: 'JSONEachRow',
    }),
    ch.query({
      query: countQuery,
      query_params: params,
      format: 'JSONEachRow',
    }),
  ])

  const rows = (await listRes.json()) as TraceListRow[]
  const countRows = (await countRes.json()) as Array<{ c: string }>
  const total = Number(countRows[0]?.c ?? 0)

  // CH returns Decimal/UInt64 as strings on JSON output (gotcha #19);
  // coerce here so the API contract stays numeric. Timestamps come back
  // as 'YYYY-MM-DD HH:MM:SS.fff' with no T/Z — JS new Date() parses that
  // as LOCAL time, so a KST dashboard showed every trace "9 hours ago"
  // (gotcha #18; the Postgres path returns timezone-aware ISO strings).
  return {
    rows: rows.map((r) => ({
      ...r,
      started_at: fromClickhouseTimestamp(r.started_at) ?? r.started_at,
      ended_at: r.ended_at == null ? null : fromClickhouseTimestamp(r.ended_at),
      created_at: fromClickhouseTimestamp(r.created_at) ?? r.created_at,
      duration_ms: r.duration_ms == null ? null : Number(r.duration_ms),
      span_count: Number(r.span_count) || 0,
      total_tokens: Number(r.total_tokens) || 0,
      total_cost_usd: Number(r.total_cost_usd) || 0,
    })),
    total,
  }
}

export interface TraceDetailRow extends TraceListRow {
  organization_id: string
  api_key_id: string | null
  metadata: Record<string, string>
  updated_at: string
  external_trace_id: string | null
}

export interface SpanDetailRow {
  id: string
  parent_span_id: string | null
  name: string
  span_type: string
  status: string
  started_at: string
  ended_at: string | null
  duration_ms: number | null
  input: string
  output: string
  metadata: Record<string, string>
  error_message: string | null
  request_id: string | null
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cost_usd: number | null
}

export interface TraceDetailResult {
  trace: TraceDetailRow | null
  spans: SpanDetailRow[]
}

/**
 * GET /api/v1/traces/:id detail path. Fetches the trace and its
 * spans in parallel. Returns trace=null if not found / wrong org so
 * the handler can return 404.
 */
export async function getTraceWithSpansFromEvents(
  traceId: string,
  organizationId: string,
): Promise<TraceDetailResult> {
  const ch = unscopedClickhouse()

  const params = { traceId, orgId: organizationId }

  const traceQuery = `
    SELECT
      toString(t.id)                                       AS id,
      toString(t.organization_id)                          AS organization_id,
      toString(t.project_id)                               AS project_id,
      toString(t.api_key_id)                               AS api_key_id,
      t.name,
      t.status,
      toString(t.started_at)                               AS started_at,
      if(isNull(t.ended_at), NULL, toString(assumeNotNull(t.ended_at)))
                                                           AS ended_at,
      t.duration_ms,
      toUInt32(coalesce(s.span_count, 0))                  AS span_count,
      toUInt32(coalesce(s.total_tokens, 0))                AS total_tokens,
      toFloat64(coalesce(s.total_cost_usd, 0))             AS total_cost_usd,
      t.error_message,
      t.metadata,
      toString(t.created_at)                               AS created_at,
      toString(t.updated_at)                               AS updated_at,
      t.external_trace_id                                  AS external_trace_id
    FROM (
      SELECT * FROM traces_view
      WHERE id = {traceId:UUID} AND organization_id = {orgId:UUID}
      ORDER BY created_at DESC
      LIMIT 1 BY id
    ) t
    LEFT JOIN (
      SELECT
        trace_id,
        count() AS span_count,
        sum(total_tokens) AS total_tokens,
        sum(coalesce(cost_usd, 0)) AS total_cost_usd
      FROM (
        SELECT * FROM spans_view
        WHERE organization_id = {orgId:UUID} AND trace_id = {traceId:UUID}
        ORDER BY created_at DESC
        LIMIT 1 BY id
      )
      GROUP BY trace_id
    ) s ON s.trace_id = t.id
    LIMIT 1
  `.trim()

  const spansQuery = `
    SELECT
      toString(id)                AS id,
      if(isNull(parent_span_id), NULL, toString(assumeNotNull(parent_span_id)))
                                  AS parent_span_id,
      name,
      span_type,
      status,
      toString(started_at)        AS started_at,
      if(isNull(ended_at), NULL, toString(assumeNotNull(ended_at)))
                                  AS ended_at,
      duration_ms,
      input,
      output,
      metadata,
      error_message,
      if(isNull(request_id), NULL, toString(assumeNotNull(request_id)))
                                  AS request_id,
      prompt_tokens,
      completion_tokens,
      total_tokens,
      cost_usd
    FROM (
      SELECT * FROM spans_view
      WHERE trace_id = {traceId:UUID} AND organization_id = {orgId:UUID}
      ORDER BY created_at DESC
      LIMIT 1 BY id
    )
    ORDER BY started_at ASC
  `.trim()

  const [traceRes, spansRes] = await Promise.all([
    ch.query({ query: traceQuery, query_params: params, format: 'JSONEachRow' }),
    ch.query({ query: spansQuery, query_params: params, format: 'JSONEachRow' }),
  ])

  const traceRows = (await traceRes.json()) as TraceDetailRow[]
  const spanRows = (await spansRes.json()) as SpanDetailRow[]

  // Same ISO-UTC conversion rationale as the list path (gotcha #18).
  const trace = traceRows[0]
    ? {
        ...traceRows[0],
        started_at: fromClickhouseTimestamp(traceRows[0].started_at) ?? traceRows[0].started_at,
        ended_at:
          traceRows[0].ended_at == null ? null : fromClickhouseTimestamp(traceRows[0].ended_at),
        created_at: fromClickhouseTimestamp(traceRows[0].created_at) ?? traceRows[0].created_at,
        updated_at: fromClickhouseTimestamp(traceRows[0].updated_at) ?? traceRows[0].updated_at,
        duration_ms:
          traceRows[0].duration_ms == null ? null : Number(traceRows[0].duration_ms),
        span_count: Number(traceRows[0].span_count) || 0,
        total_tokens: Number(traceRows[0].total_tokens) || 0,
        total_cost_usd: Number(traceRows[0].total_cost_usd) || 0,
      }
    : null

  const spans = spanRows.map((s) => ({
    ...s,
    started_at: fromClickhouseTimestamp(s.started_at) ?? s.started_at,
    ended_at: s.ended_at == null ? null : fromClickhouseTimestamp(s.ended_at),
    duration_ms: s.duration_ms == null ? null : Number(s.duration_ms),
    prompt_tokens: Number(s.prompt_tokens) || 0,
    completion_tokens: Number(s.completion_tokens) || 0,
    total_tokens: Number(s.total_tokens) || 0,
    cost_usd: s.cost_usd == null ? null : Number(s.cost_usd),
  }))

  return { trace, spans }
}
