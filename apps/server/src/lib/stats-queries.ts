import { pgQuery } from './postgres.js'
import { requestsScope } from './requests-query.js'

/**
 * The 8 analytic reads behind the dashboard, expressed as Postgres SQL.
 *
 * api/stats.ts, api/users.ts and api/sessions.ts read these fields by name,
 * so the SELECT aliases are a contract, not an implementation detail. Renaming
 * one here silently blanks a dashboard card.
 *
 * Plan retention applies, because these are user-facing dashboard reads, not
 * billing. `requestsScope` injects both the `organization_id` filter and the
 * retention clip; every query here must include `scope.whereScope`.
 *
 * ## Numeric coercion still matters
 *
 * The `Number(...)` wrapping on every field is load-bearing. node-postgres
 * hands back `numeric` (cost_usd, avg, the percentiles) and `int8` (every
 * count) as strings, deliberately, because neither fits a JS number without
 * risking precision loss. Dropping a `Number()` turns arithmetic into string
 * concatenation, silently: `"0.001" + 1 === "0.0011"` (gotcha #19).
 */

// ─── Common timestamp handling ──────────────────────────────────────────────
// Bounds arrive as ISO-8601 strings and are bound as parameters, cast with
// `::timestamptz` at the placeholder. Postgres parses the trailing `Z`
// itself, so the bound value crosses untouched and the offset is explicit in
// the literal rather than implied by the session timezone. Nothing here should
// reformat an incoming ISO string.
function tsBound(iso: string | null | undefined): string | null {
  return iso ? iso : null
}

/** Shape node-postgres returns: every column is a string, number, or null. */
type PgRow = Record<string, string | number | null>

// ─── Overview ───────────────────────────────────────────────────────────────

export interface OverviewRow {
  total_requests: number
  success_requests: number
  error_requests: number
  total_cost_usd: number
  total_tokens: number
  prompt_tokens: number
  completion_tokens: number
  avg_latency_ms: number
}

export interface OverviewOptions {
  projectId?: string | null | undefined
  /** ISO timestamp lower bound. Defaults to "30 days ago" inside the query. */
  from?: string | null | undefined
  /** ISO timestamp upper bound. Defaults to now. */
  to?: string | null | undefined
}

export async function getStatsOverview(
  organizationId: string,
  options: OverviewOptions = {},
): Promise<OverviewRow> {
  const scope = await requestsScope(organizationId)
  const filters: string[] = []
  const params: Record<string, unknown> = { ...scope.scopeParams }

  if (options.projectId) {
    filters.push('project_id = {projectId}')
    params['projectId'] = options.projectId
  }
  const fromTs = tsBound(options.from)
  if (fromTs) {
    filters.push('created_at >= {fromTs}::timestamptz')
    params['fromTs'] = fromTs
  } else {
    // Match the original function's "default last 30 days" behavior.
    filters.push("created_at >= now() - INTERVAL '30 days'")
  }
  const toTs = tsBound(options.to)
  if (toTs) {
    filters.push('created_at <= {toTs}::timestamptz')
    params['toTs'] = toTs
  }

  const where = [scope.whereScope, ...filters].join(' AND ')
  const sql = `
    SELECT
      count(*)                                    AS total_requests,
      count(*) FILTER (WHERE status_code <  400)  AS success_requests,
      count(*) FILTER (WHERE status_code >= 400)  AS error_requests,
      sum(cost_usd)                               AS total_cost_usd,
      sum(total_tokens)                           AS total_tokens,
      sum(prompt_tokens)                          AS prompt_tokens,
      sum(completion_tokens)                      AS completion_tokens,
      avg(latency_ms)                             AS avg_latency_ms
    FROM requests
    WHERE ${where}`

  const rows = await pgQuery<PgRow>({ query: sql, params })
  const row = rows[0]
  return {
    total_requests:    Number(row?.['total_requests']   ?? 0),
    success_requests:  Number(row?.['success_requests'] ?? 0),
    error_requests:    Number(row?.['error_requests']   ?? 0),
    total_cost_usd:    Number(row?.['total_cost_usd']   ?? 0),
    total_tokens:      Number(row?.['total_tokens']     ?? 0),
    prompt_tokens:     Number(row?.['prompt_tokens']    ?? 0),
    completion_tokens: Number(row?.['completion_tokens'] ?? 0),
    avg_latency_ms:    Number(row?.['avg_latency_ms']   ?? 0),
  }
}

// ─── Per-model breakdown ────────────────────────────────────────────────────

export interface ModelsRow {
  provider: string
  model: string
  requests: number
  total_cost_usd: number
  avg_latency_ms: number
  error_rate: number
}

export interface ModelsOptions {
  projectId?: string | null | undefined
  /** ISO timestamp lower bound — typically "N hours ago". Required. */
  from: string
}

export async function getStatsModels(
  organizationId: string,
  options: ModelsOptions,
): Promise<ModelsRow[]> {
  const scope = await requestsScope(organizationId)
  const filters: string[] = []
  const params: Record<string, unknown> = {
    ...scope.scopeParams,
    fromTs: options.from,
  }
  filters.push('created_at >= {fromTs}::timestamptz')
  if (options.projectId) {
    filters.push('project_id = {projectId}')
    params['projectId'] = options.projectId
  }
  const where = [scope.whereScope, ...filters].join(' AND ')
  // `sum(cost_usd)` is NULL for a group whose every row has a null cost, and
  // `ORDER BY total_cost_usd DESC` sorts those first because Postgres treats
  // NULL as larger than any value. Priced groups therefore rank below unpriced
  // ones; the `?? 0` below only normalises what the caller reads, not the
  // order. Add `NULLS LAST` if that ever needs to change.
  const sql = `
    SELECT
      provider,
      model,
      count(*)                                                 AS requests,
      sum(cost_usd)                                            AS total_cost_usd,
      avg(latency_ms)                                          AS avg_latency_ms,
      avg(CASE WHEN status_code >= 400 THEN 1.0 ELSE 0.0 END)  AS error_rate
    FROM requests
    WHERE ${where}
    GROUP BY provider, model
    ORDER BY total_cost_usd DESC`

  const rows = await pgQuery<PgRow>({ query: sql, params })
  return rows.map((r) => ({
    provider:       String(r['provider'] ?? ''),
    model:          String(r['model'] ?? ''),
    requests:       Number(r['requests'] ?? 0),
    total_cost_usd: Number(r['total_cost_usd'] ?? 0),
    avg_latency_ms: Number(r['avg_latency_ms'] ?? 0),
    error_rate:     Number(r['error_rate'] ?? 0),
  }))
}

// ─── Time series ────────────────────────────────────────────────────────────

export interface TimeseriesRow {
  /** ISO-8601 timestamp at the start of the bucket. */
  day: string
  requests: number
  cost: number
  /** Total tokens (prompt + completion) — kept for backward compatibility. */
  tokens: number
  /** Prompt-side tokens — input to the model. Powers the token-trends chart. */
  prompt_tokens: number
  /** Completion-side tokens — output from the model. Powers the token-trends chart. */
  completion_tokens: number
  errors: number
  errors_4xx: number
  errors_5xx: number
  /** 429 specifically — split out from 4xx so the dashboard can flag rate
   * limiting as a distinct failure mode (an account-quota issue, not a
   * client-error). count(*) FILTER (WHERE status_code = 429). */
  errors_429: number
  /** p50 latency in milliseconds. Null when the bucket has zero requests. */
  p50_latency_ms: number | null
  /** p95 latency in milliseconds. Null when the bucket has zero requests. */
  p95_latency_ms: number | null
}

export interface BucketBreakdownEntry {
  value: string
  count: number
}

export interface BucketBreakdownRow {
  day: string
  /** Top-N status codes for this bucket, sorted by count descending. */
  top_status: BucketBreakdownEntry[]
  /** Top-N (provider, model) values for this bucket, sorted by count descending. */
  top_models: BucketBreakdownEntry[]
}

export interface TimeseriesOptions {
  projectId?: string | null | undefined
  from?: string | null | undefined
  to?: string | null | undefined
  /** 'hour' | 'day' — matches the Postgres date_trunc unit. */
  granularity?: 'hour' | 'day' | undefined
}

/**
 * Renders a bucket start as the ISO-8601 instant the dashboard expects.
 *
 * `AT TIME ZONE 'UTC'` is load-bearing: without it `to_char` formats in the
 * session timezone while the literal `Z` in the pattern keeps claiming UTC,
 * so every bucket silently shifts by the session offset. The pool pins the
 * session to UTC (lib/postgres.ts), which makes this belt-and-braces rather
 * than the only defence — but it is the half that survives someone changing
 * the pool options.
 */
function bucketExpr(unit: 'hour' | 'day'): string {
  return `to_char(date_trunc('${unit}', created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`
}

export async function getStatsTimeseries(
  organizationId: string,
  options: TimeseriesOptions = {},
): Promise<TimeseriesRow[]> {
  const granularity = options.granularity ?? 'day'
  const bucket = bucketExpr(granularity === 'hour' ? 'hour' : 'day')

  const scope = await requestsScope(organizationId)
  const filters: string[] = []
  const params: Record<string, unknown> = { ...scope.scopeParams }
  if (options.projectId) {
    filters.push('project_id = {projectId}')
    params['projectId'] = options.projectId
  }
  const fromTs = tsBound(options.from)
  if (fromTs) {
    filters.push('created_at >= {fromTs}::timestamptz')
    params['fromTs'] = fromTs
  } else {
    filters.push("created_at >= now() - INTERVAL '30 days'")
  }
  const toTs = tsBound(options.to)
  if (toTs) {
    filters.push('created_at <= {toTs}::timestamptz')
    params['toTs'] = toTs
  }

  const where = [scope.whereScope, ...filters].join(' AND ')
  // The bucket is formatted back to ISO with 'Z' so the dashboard timeline
  // code (which treats `day` as a UTC instant) keeps working unchanged.
  // 4xx and 5xx are split to power the chart's error toggle; p50/p95 latency
  // is computed per bucket so the chart can overlay a latency trend line.
  const sql = `
    SELECT
      ${bucket}                                                     AS day,
      count(*)                                                      AS requests,
      sum(cost_usd)                                                 AS cost,
      sum(total_tokens)                                             AS tokens,
      sum(prompt_tokens)                                            AS prompt_tokens,
      sum(completion_tokens)                                        AS completion_tokens,
      count(*) FILTER (WHERE status_code >= 400)                    AS errors,
      count(*) FILTER (WHERE status_code >= 400
                         AND status_code <  500)                    AS errors_4xx,
      count(*) FILTER (WHERE status_code >= 500)                    AS errors_5xx,
      count(*) FILTER (WHERE status_code =  429)                    AS errors_429,
      percentile_cont(0.5)  WITHIN GROUP (ORDER BY latency_ms)      AS p50_latency_ms,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)      AS p95_latency_ms
    FROM requests
    WHERE ${where}
    GROUP BY day
    ORDER BY day ASC`

  const rows = await pgQuery<PgRow>({ query: sql, params })
  return rows.map((r) => ({
    day:               String(r['day'] ?? ''),
    requests:          Number(r['requests'] ?? 0),
    cost:              Number(r['cost'] ?? 0),
    tokens:            Number(r['tokens'] ?? 0),
    prompt_tokens:     Number(r['prompt_tokens'] ?? 0),
    completion_tokens: Number(r['completion_tokens'] ?? 0),
    errors:            Number(r['errors'] ?? 0),
    errors_4xx:        Number(r['errors_4xx'] ?? 0),
    errors_5xx:        Number(r['errors_5xx'] ?? 0),
    errors_429:        Number(r['errors_429'] ?? 0),
    p50_latency_ms:    r['p50_latency_ms'] == null ? null : Number(r['p50_latency_ms']),
    p95_latency_ms:    r['p95_latency_ms'] == null ? null : Number(r['p95_latency_ms']),
  }))
}

// ─── Per-bucket breakdown (top status codes + models) ────────────────────────
//
// Used by the Requests page chart tooltip to explain "why did errors spike at
// 14:00?" — top 3 status codes and top 3 models per bucket. One query returns
// both kinds via UNION ALL; the API layer keeps only the top N per (bucket, kind).

export async function getTimeseriesBreakdown(
  organizationId: string,
  options: TimeseriesOptions = {},
): Promise<BucketBreakdownRow[]> {
  const granularity = options.granularity ?? 'day'
  const bucket = bucketExpr(granularity === 'hour' ? 'hour' : 'day')

  const scope = await requestsScope(organizationId)
  const filters: string[] = []
  const params: Record<string, unknown> = { ...scope.scopeParams }
  if (options.projectId) {
    filters.push('project_id = {projectId}')
    params['projectId'] = options.projectId
  }
  const fromTs = tsBound(options.from)
  if (fromTs) {
    filters.push('created_at >= {fromTs}::timestamptz')
    params['fromTs'] = fromTs
  } else {
    filters.push("created_at >= now() - INTERVAL '30 days'")
  }
  const toTs = tsBound(options.to)
  if (toTs) {
    filters.push('created_at <= {toTs}::timestamptz')
    params['toTs'] = toTs
  }

  const where = [scope.whereScope, ...filters].join(' AND ')

  // The WHERE clause appears in both arms of the UNION; `toPositional` reuses
  // one `$n` per parameter name, so the values are still bound exactly once.
  const sql = `
    SELECT day, kind, value, c FROM (
      SELECT
        ${bucket}             AS day,
        'status'              AS kind,
        status_code::text     AS value,
        count(*)              AS c
      FROM requests
      WHERE ${where}
      GROUP BY day, value
      UNION ALL
      SELECT
        ${bucket}                       AS day,
        'model'                         AS kind,
        concat(provider, ' / ', model)  AS value,
        count(*)                        AS c
      FROM requests
      WHERE ${where}
      GROUP BY day, value
    ) AS breakdown
    ORDER BY day ASC, kind ASC, c DESC`

  const rows = await pgQuery<{ day: string; kind: 'status' | 'model'; value: string; c: string | number }>({
    query: sql,
    params,
  })

  const byBucket = new Map<string, BucketBreakdownRow>()
  const TOP_N = 3

  for (const r of rows) {
    const day = String(r.day ?? '')
    if (!day) continue
    let row = byBucket.get(day)
    if (!row) {
      row = { day, top_status: [], top_models: [] }
      byBucket.set(day, row)
    }
    const list = r.kind === 'status' ? row.top_status : row.top_models
    if (list.length < TOP_N) {
      list.push({ value: String(r.value), count: Number(r.c) })
    }
  }

  return Array.from(byBucket.values())
}

// ─── Per-user analytics ─────────────────────────────────────────────────────
//
// Groups by user_id with total counts, cost, tokens, latency, error rate,
// distinct models, and first/last-seen markers. The sort column is
// parameterized; we whitelist here (the column name lands in the SQL string,
// so it MUST be validated).

export interface UserAnalyticsRow {
  user_id: string
  total_requests: number
  total_tokens: number
  total_cost_usd: number
  avg_latency_ms: number | null
  first_seen: string
  last_seen: string
  error_requests: number
  distinct_models: number
  total_count: number
}

export interface UserAnalyticsOptions {
  projectId?: string | null | undefined
  search?: string | null | undefined
  from?: string | null | undefined
  to?: string | null | undefined
  sortBy: 'cost' | 'requests' | 'tokens' | 'last_seen' | 'latency'
  sortDir: 'asc' | 'desc'
  limit: number
  offset: number
}

const USER_SORT_COL: Record<UserAnalyticsOptions['sortBy'], string> = {
  cost:      'total_cost_usd',
  requests:  'total_requests',
  tokens:    'total_tokens',
  last_seen: 'last_seen',
  latency:   'avg_latency_ms',
}

export async function getUserAnalytics(
  organizationId: string,
  options: UserAnalyticsOptions,
): Promise<UserAnalyticsRow[]> {
  const scope = await requestsScope(organizationId)

  // Whitelist sort inputs — they're concatenated into SQL below.
  const sortCol = USER_SORT_COL[options.sortBy] ?? 'total_cost_usd'
  const sortDir = options.sortDir === 'asc' ? 'ASC' : 'DESC'

  const filters: string[] = ['user_id IS NOT NULL']
  const params: Record<string, unknown> = { ...scope.scopeParams }
  if (options.projectId) {
    filters.push('project_id = {projectId}')
    params['projectId'] = options.projectId
  }
  if (options.search) {
    // Literal case-insensitive substring match. Deliberately NOT ILIKE:
    // ILIKE would read `%`
    // and `_` in the caller's search string as wildcards, so a user id
    // containing an underscore would start matching its neighbours.
    filters.push('position(lower({search}) in lower(user_id)) > 0')
    params['search'] = options.search
  }
  const fromTs = tsBound(options.from)
  if (fromTs) {
    filters.push('created_at >= {fromTs}::timestamptz')
    params['fromTs'] = fromTs
  }
  const toTs = tsBound(options.to)
  if (toTs) {
    filters.push('created_at <= {toTs}::timestamptz')
    params['toTs'] = toTs
  }

  const where = [scope.whereScope, ...filters].join(' AND ')
  // `count(*) OVER ()` runs after grouping, so it counts groups rather than
  // rows. That windowed total is what lets the list endpoint paginate without
  // a second roundtrip for the count.
  const sql = `
    SELECT
      user_id,
      count(*)                                    AS total_requests,
      sum(total_tokens)                           AS total_tokens,
      sum(cost_usd)                               AS total_cost_usd,
      avg(latency_ms)                             AS avg_latency_ms,
      min(created_at)                             AS first_seen,
      max(created_at)                             AS last_seen,
      count(*) FILTER (WHERE status_code >= 400)  AS error_requests,
      count(DISTINCT model)                       AS distinct_models,
      count(*) OVER ()                            AS total_count
    FROM requests
    WHERE ${where}
    GROUP BY user_id
    ORDER BY ${sortCol} ${sortDir} NULLS LAST
    LIMIT {limit} OFFSET {offset}`

  params['limit'] = options.limit
  params['offset'] = options.offset

  const rows = await pgQuery<PgRow>({ query: sql, params })
  return rows.map((r) => ({
    user_id:         String(r['user_id'] ?? ''),
    total_requests:  Number(r['total_requests'] ?? 0),
    total_tokens:    Number(r['total_tokens'] ?? 0),
    total_cost_usd:  Number(r['total_cost_usd'] ?? 0),
    avg_latency_ms:  r['avg_latency_ms'] == null ? null : Number(r['avg_latency_ms']),
    first_seen:      String(r['first_seen'] ?? ''),
    last_seen:       String(r['last_seen'] ?? ''),
    error_requests:  Number(r['error_requests'] ?? 0),
    distinct_models: Number(r['distinct_models'] ?? 0),
    total_count:     Number(r['total_count'] ?? 0),
  }))
}

// ─── Per-session analytics ──────────────────────────────────────────────────
//
// Groups requests by session_id — the conversation/session IDs the customer
// attaches via x-spanlens-session. One row per distinct (org, session_id) with
// totals, latency, error rate, distinct models, a representative user_id, and
// first/last-seen markers. Mirrors getUserAnalytics; the sort column is
// whitelisted because it lands in the SQL string.

export interface SessionAnalyticsRow {
  session_id: string
  user_id: string | null
  total_requests: number
  total_tokens: number
  total_cost_usd: number
  avg_latency_ms: number | null
  first_seen: string
  last_seen: string
  error_requests: number
  distinct_models: number
  total_count: number
}

export interface SessionAnalyticsOptions {
  projectId?: string | null | undefined
  userId?: string | null | undefined
  search?: string | null | undefined
  from?: string | null | undefined
  to?: string | null | undefined
  sortBy: 'cost' | 'requests' | 'tokens' | 'last_seen' | 'latency'
  sortDir: 'asc' | 'desc'
  limit: number
  offset: number
}

const SESSION_SORT_COL: Record<SessionAnalyticsOptions['sortBy'], string> = {
  cost:      'total_cost_usd',
  requests:  'total_requests',
  tokens:    'total_tokens',
  last_seen: 'last_seen',
  latency:   'avg_latency_ms',
}

export async function getSessionAnalytics(
  organizationId: string,
  options: SessionAnalyticsOptions,
): Promise<SessionAnalyticsRow[]> {
  const scope = await requestsScope(organizationId)

  // Whitelist sort inputs — they're concatenated into SQL below.
  const sortCol = SESSION_SORT_COL[options.sortBy] ?? 'last_seen'
  const sortDir = options.sortDir === 'asc' ? 'ASC' : 'DESC'

  const filters: string[] = ['session_id IS NOT NULL']
  const params: Record<string, unknown> = { ...scope.scopeParams }
  if (options.projectId) {
    filters.push('project_id = {projectId}')
    params['projectId'] = options.projectId
  }
  if (options.userId) {
    filters.push('user_id = {userId}')
    params['userId'] = options.userId
  }
  if (options.search) {
    // Literal substring match, not ILIKE — see the note in getUserAnalytics.
    filters.push('position(lower({search}) in lower(session_id)) > 0')
    params['search'] = options.search
  }
  const fromTs = tsBound(options.from)
  if (fromTs) {
    filters.push('created_at >= {fromTs}::timestamptz')
    params['fromTs'] = fromTs
  }
  const toTs = tsBound(options.to)
  if (toTs) {
    filters.push('created_at <= {toTs}::timestamptz')
    params['toTs'] = toTs
  }

  const where = [scope.whereScope, ...filters].join(' AND ')
  // `min(user_id)` gives a representative end-user for the session — sessions
  // are virtually always single-user, so any member of the group is fine for
  // display. `min` rather than an arbitrary pick because it is deterministic:
  // a mixed-user session renders the *same* id on every reload instead of
  // flickering between them.
  //
  // The `AS user_id` alias shadows the column of the same name, but only in
  // the SELECT list. Postgres does not resolve output aliases in WHERE, so
  // the `user_id = {userId}` filter above still reads the real column.
  // `count(*) OVER ()` returns the windowed total for paging.
  const sql = `
    SELECT
      session_id,
      min(user_id)                                AS user_id,
      count(*)                                    AS total_requests,
      sum(total_tokens)                           AS total_tokens,
      sum(cost_usd)                               AS total_cost_usd,
      avg(latency_ms)                             AS avg_latency_ms,
      min(created_at)                             AS first_seen,
      max(created_at)                             AS last_seen,
      count(*) FILTER (WHERE status_code >= 400)  AS error_requests,
      count(DISTINCT model)                       AS distinct_models,
      count(*) OVER ()                            AS total_count
    FROM requests
    WHERE ${where}
    GROUP BY session_id
    ORDER BY ${sortCol} ${sortDir} NULLS LAST
    LIMIT {limit} OFFSET {offset}`

  params['limit'] = options.limit
  params['offset'] = options.offset

  const rows = await pgQuery<PgRow>({ query: sql, params })
  return rows.map((r) => ({
    session_id:      String(r['session_id'] ?? ''),
    user_id:         r['user_id'] == null || r['user_id'] === '' ? null : String(r['user_id']),
    total_requests:  Number(r['total_requests'] ?? 0),
    total_tokens:    Number(r['total_tokens'] ?? 0),
    total_cost_usd:  Number(r['total_cost_usd'] ?? 0),
    avg_latency_ms:  r['avg_latency_ms'] == null ? null : Number(r['avg_latency_ms']),
    first_seen:      String(r['first_seen'] ?? ''),
    last_seen:       String(r['last_seen'] ?? ''),
    error_requests:  Number(r['error_requests'] ?? 0),
    distinct_models: Number(r['distinct_models'] ?? 0),
    total_count:     Number(r['total_count'] ?? 0),
  }))
}

// ─── Security flag summary ──────────────────────────────────────────────────
//
// `flags` is a jsonb array column, so the unrolling is a lateral join over
// jsonb_array_elements and each element's fields come out with `->>`. Rows
// whose array is empty produce no lateral rows and drop out of the result,
// which is what makes the summary count flagged requests only.

export interface SecuritySummaryRow {
  flag_type: string
  pattern: string
  count: number
}

export async function getSecuritySummary(
  organizationId: string,
  hours: number,
): Promise<SecuritySummaryRow[]> {
  // User-facing security dashboard read: respect plan retention like other
  // dashboard reads. Do NOT bypass retention here — a Free org (14d) must not
  // aggregate flags up to the 720h (30d) query window.
  const scope = await requestsScope(organizationId)
  // `INTERVAL {hours} HOUR` is a syntax error — the unit cannot be
  // parameterised in Postgres. make_interval() takes the count as a named
  // argument instead, so the value stays bound rather than interpolated
  // (same shape as the retention clip in requests-query.ts).
  const sql = `
    SELECT
      flag->>'type'     AS flag_type,
      flag->>'pattern'  AS pattern,
      count(*)          AS count
    FROM requests
    CROSS JOIN LATERAL jsonb_array_elements(flags) AS flag
    WHERE ${scope.whereScope}
      AND has_security_flags
      AND created_at >= now() - make_interval(hours => {hours})
    GROUP BY flag_type, pattern
    ORDER BY count DESC`

  const rows = await pgQuery<PgRow>({
    query: sql,
    params: { ...scope.scopeParams, hours },
  })
  return rows.map((r) => ({
    flag_type: String(r['flag_type'] ?? ''),
    pattern:   String(r['pattern'] ?? ''),
    count:     Number(r['count'] ?? 0),
  }))
}

// ─── Latency percentiles ────────────────────────────────────────────────────
//
// `percentile_cont` computes p50/p95/p99 in the database and returns one
// aggregated row. Do not go back to pulling raw rows and computing them in JS:
// the sample is capped only by the time window, so it grows with traffic.

export interface LatencyPercentilesRow {
  sample_count: number
  overhead_sample_count: number
  p50_provider: number
  p95_provider: number
  p99_provider: number
  avg_provider: number
  p50_overhead: number
  p95_overhead: number
  p99_overhead: number
  avg_overhead: number
}

export async function getLatencyPercentiles(
  organizationId: string,
  hours: number,
): Promise<LatencyPercentilesRow> {
  const scope = await requestsScope(organizationId)
  const sinceTs = new Date(Date.now() - hours * 3_600_000).toISOString()
  // The proxy_overhead_ms filters are belt-and-braces, since percentile_cont
  // already skips NULLs in its ORDER BY input. They stay because they keep the
  // sample set visibly identical to the count above them.
  const sql = `
    SELECT
      count(*)                                                                       AS sample_count,
      count(*) FILTER (WHERE proxy_overhead_ms IS NOT NULL)                          AS overhead_sample_count,
      percentile_cont(0.50) WITHIN GROUP (ORDER BY latency_ms)
        FILTER (WHERE latency_ms > 0)                                                AS p50_provider,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)
        FILTER (WHERE latency_ms > 0)                                                AS p95_provider,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms)
        FILTER (WHERE latency_ms > 0)                                                AS p99_provider,
      avg(latency_ms) FILTER (WHERE latency_ms > 0)                                  AS avg_provider,
      percentile_cont(0.50) WITHIN GROUP (ORDER BY proxy_overhead_ms)
        FILTER (WHERE proxy_overhead_ms IS NOT NULL)                                 AS p50_overhead,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY proxy_overhead_ms)
        FILTER (WHERE proxy_overhead_ms IS NOT NULL)                                 AS p95_overhead,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY proxy_overhead_ms)
        FILTER (WHERE proxy_overhead_ms IS NOT NULL)                                 AS p99_overhead,
      avg(proxy_overhead_ms) FILTER (WHERE proxy_overhead_ms IS NOT NULL)            AS avg_overhead
    FROM requests
    WHERE ${scope.whereScope}
      AND created_at >= {sinceTs}::timestamptz`

  const rows = await pgQuery<PgRow>({
    query: sql,
    params: { ...scope.scopeParams, sinceTs },
  })
  const r = rows[0]
  return {
    sample_count:          Number(r?.['sample_count'] ?? 0),
    overhead_sample_count: Number(r?.['overhead_sample_count'] ?? 0),
    p50_provider:          Number(r?.['p50_provider'] ?? 0),
    p95_provider:          Number(r?.['p95_provider'] ?? 0),
    p99_provider:          Number(r?.['p99_provider'] ?? 0),
    avg_provider:          Number(r?.['avg_provider'] ?? 0),
    p50_overhead:          Number(r?.['p50_overhead'] ?? 0),
    p95_overhead:          Number(r?.['p95_overhead'] ?? 0),
    p99_overhead:          Number(r?.['p99_overhead'] ?? 0),
    avg_overhead:          Number(r?.['avg_overhead'] ?? 0),
  }
}
