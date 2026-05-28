import { getClickhouse } from './clickhouse.js'
import { requestsScope } from './requests-query.js'

/**
 * ClickHouse replacements for the 4 stats RPCs that used to live in Postgres:
 *   - stats_overview    → getStatsOverview
 *   - stats_models      → getStatsModels
 *   - stats_timeseries  → getStatsTimeseries
 *   - (latency endpoint pulled 5K rows + JS percentile) → getLatencyPercentiles
 *
 * Plan retention applies — these are user-facing dashboard reads, not billing.
 *
 * The row shapes mirror the Postgres RETURNS TABLE definitions exactly so
 * the API layer (api/stats.ts) didn't need to change its response contract.
 */

// ─── Common timestamp formatting ────────────────────────────────────────────
// ClickHouse DateTime64 rejects the trailing 'Z' in Date.toISOString().
// parseDateTime64BestEffort handles both forms but we pass the space form
// uniformly to match logger.ts / countMonthlyRequests style.
function fmt(iso: string | null | undefined): string | null {
  if (!iso) return null
  return iso.replace('T', ' ').replace('Z', '')
}

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
    filters.push('project_id = {projectId:UUID}')
    params['projectId'] = options.projectId
  }
  const fromTs = fmt(options.from)
  if (fromTs) {
    filters.push('created_at >= parseDateTime64BestEffort({fromTs:String})')
    params['fromTs'] = fromTs
  } else {
    // Match the Postgres function's "default last 30 days" behavior.
    filters.push('created_at >= now() - INTERVAL 30 DAY')
  }
  const toTs = fmt(options.to)
  if (toTs) {
    filters.push('created_at <= parseDateTime64BestEffort({toTs:String})')
    params['toTs'] = toTs
  }

  const where = [scope.whereScope, ...filters].join(' AND ')
  const sql = `
    SELECT
      count()                                AS total_requests,
      countIf(status_code <  400)            AS success_requests,
      countIf(status_code >= 400)            AS error_requests,
      sum(cost_usd)                          AS total_cost_usd,
      sum(total_tokens)                      AS total_tokens,
      sum(prompt_tokens)                     AS prompt_tokens,
      sum(completion_tokens)                 AS completion_tokens,
      avg(latency_ms)                        AS avg_latency_ms
    FROM requests
    WHERE ${where}`

  const result = await getClickhouse().query({
    query: sql,
    query_params: params,
    format: 'JSONEachRow',
  })
  const rows = (await result.json()) as Array<Record<string, string | number | null>>
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
    fromTs: fmt(options.from)!,
  }
  filters.push('created_at >= parseDateTime64BestEffort({fromTs:String})')
  if (options.projectId) {
    filters.push('project_id = {projectId:UUID}')
    params['projectId'] = options.projectId
  }
  const where = [scope.whereScope, ...filters].join(' AND ')
  const sql = `
    SELECT
      provider,
      model,
      count()                                          AS requests,
      sum(cost_usd)                                    AS total_cost_usd,
      avg(latency_ms)                                  AS avg_latency_ms,
      avg(if(status_code >= 400, 1.0, 0.0))            AS error_rate
    FROM requests
    WHERE ${where}
    GROUP BY provider, model
    ORDER BY total_cost_usd DESC`

  const result = await getClickhouse().query({
    query: sql,
    query_params: params,
    format: 'JSONEachRow',
  })
  const rows = (await result.json()) as Array<Record<string, string | number | null>>
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
  tokens: number
  errors: number
}

export interface TimeseriesOptions {
  projectId?: string | null | undefined
  from?: string | null | undefined
  to?: string | null | undefined
  /** 'hour' | 'day' — matches Postgres date_trunc unit. */
  granularity?: 'hour' | 'day' | undefined
}

export async function getStatsTimeseries(
  organizationId: string,
  options: TimeseriesOptions = {},
): Promise<TimeseriesRow[]> {
  const granularity = options.granularity ?? 'day'
  const bucket = granularity === 'hour' ? 'toStartOfHour' : 'toStartOfDay'

  const scope = await requestsScope(organizationId)
  const filters: string[] = []
  const params: Record<string, unknown> = { ...scope.scopeParams }
  if (options.projectId) {
    filters.push('project_id = {projectId:UUID}')
    params['projectId'] = options.projectId
  }
  const fromTs = fmt(options.from)
  if (fromTs) {
    filters.push('created_at >= parseDateTime64BestEffort({fromTs:String})')
    params['fromTs'] = fromTs
  } else {
    filters.push('created_at >= now() - INTERVAL 30 DAY')
  }
  const toTs = fmt(options.to)
  if (toTs) {
    filters.push('created_at <= parseDateTime64BestEffort({toTs:String})')
    params['toTs'] = toTs
  }

  const where = [scope.whereScope, ...filters].join(' AND ')
  // Re-format the bucket back to ISO with 'Z' so the dashboard timeline code
  // (which treats `day` as a UTC instant) keeps working unchanged.
  const sql = `
    SELECT
      formatDateTime(${bucket}(created_at), '%Y-%m-%dT%H:%i:%SZ') AS day,
      count()                                                    AS requests,
      sum(cost_usd)                                              AS cost,
      sum(total_tokens)                                          AS tokens,
      countIf(status_code >= 400)                                AS errors
    FROM requests
    WHERE ${where}
    GROUP BY day
    ORDER BY day ASC`

  const result = await getClickhouse().query({
    query: sql,
    query_params: params,
    format: 'JSONEachRow',
  })
  const rows = (await result.json()) as Array<Record<string, string | number | null>>
  return rows.map((r) => ({
    day:      String(r['day'] ?? ''),
    requests: Number(r['requests'] ?? 0),
    cost:     Number(r['cost'] ?? 0),
    tokens:   Number(r['tokens'] ?? 0),
    errors:   Number(r['errors'] ?? 0),
  }))
}

// ─── Per-user analytics ─────────────────────────────────────────────────────
//
// Replaces the Postgres `get_user_analytics` function. Groups by user_id with
// total counts, cost, tokens, latency, error rate, distinct models, and
// first/last-seen markers. The sort column is parameterized; we whitelist
// here (the column name lands in the SQL string, so it MUST be validated).

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

  const filters: string[] = ['isNotNull(user_id)']
  const params: Record<string, unknown> = { ...scope.scopeParams }
  if (options.projectId) {
    filters.push('project_id = {projectId:UUID}')
    params['projectId'] = options.projectId
  }
  if (options.search) {
    filters.push('positionCaseInsensitive(user_id, {search:String}) > 0')
    params['search'] = options.search
  }
  const fromTs = fmt(options.from)
  if (fromTs) {
    filters.push('created_at >= parseDateTime64BestEffort({fromTs:String})')
    params['fromTs'] = fromTs
  }
  const toTs = fmt(options.to)
  if (toTs) {
    filters.push('created_at <= parseDateTime64BestEffort({toTs:String})')
    params['toTs'] = toTs
  }

  const where = [scope.whereScope, ...filters].join(' AND ')
  // count() OVER () provides the windowed total so the list endpoint can
  // paginate without a second roundtrip (matches the old Postgres behavior).
  const sql = `
    SELECT
      user_id,
      count()                                          AS total_requests,
      sum(total_tokens)                                AS total_tokens,
      sum(cost_usd)                                    AS total_cost_usd,
      avg(latency_ms)                                  AS avg_latency_ms,
      min(created_at)                                  AS first_seen,
      max(created_at)                                  AS last_seen,
      countIf(status_code >= 400)                      AS error_requests,
      uniqExact(model)                                 AS distinct_models,
      count() OVER ()                                  AS total_count
    FROM requests
    WHERE ${where}
    GROUP BY user_id
    ORDER BY ${sortCol} ${sortDir} NULLS LAST
    LIMIT {limit:UInt32} OFFSET {offset:UInt32}`

  params['limit'] = options.limit
  params['offset'] = options.offset

  const result = await getClickhouse().query({
    query: sql,
    query_params: params,
    format: 'JSONEachRow',
  })
  const rows = (await result.json()) as Array<Record<string, string | number | null>>
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

// ─── Security flag summary ──────────────────────────────────────────────────
//
// Replaces the Postgres `security_summary` function. ClickHouse stores the
// `flags` column as a JSON string (not JSONB); we unroll with ARRAY JOIN +
// JSONExtractArrayRaw, then pull each flag object's type + pattern fields.

export interface SecuritySummaryRow {
  flag_type: string
  pattern: string
  count: number
}

export async function getSecuritySummary(
  organizationId: string,
  hours: number,
): Promise<SecuritySummaryRow[]> {
  const scope = await requestsScope(organizationId, { ignoreRetention: true })
  const sql = `
    SELECT
      JSONExtractString(flag, 'type')    AS flag_type,
      JSONExtractString(flag, 'pattern') AS pattern,
      count()                            AS count
    FROM requests
    ARRAY JOIN JSONExtractArrayRaw(flags) AS flag
    WHERE ${scope.whereScope}
      AND has_security_flags = 1
      AND created_at >= now() - INTERVAL {hours:UInt32} HOUR
    GROUP BY flag_type, pattern
    ORDER BY count DESC`

  const result = await getClickhouse().query({
    query: sql,
    query_params: { ...scope.scopeParams, hours },
    format: 'JSONEachRow',
  })
  const rows = (await result.json()) as Array<Record<string, string | number>>
  return rows.map((r) => ({
    flag_type: String(r['flag_type'] ?? ''),
    pattern:   String(r['pattern'] ?? ''),
    count:     Number(r['count'] ?? 0),
  }))
}

// ─── Latency percentiles ────────────────────────────────────────────────────
//
// The old endpoint pulled 5,000 raw rows and computed p50/p95/p99 in JS.
// ClickHouse's native `quantile()` does the same work without the round-trip;
// we now return one aggregated row instead.

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
  const sinceTs = fmt(new Date(Date.now() - hours * 3_600_000).toISOString())!
  const sql = `
    SELECT
      count()                                                                  AS sample_count,
      countIf(isNotNull(proxy_overhead_ms))                                    AS overhead_sample_count,
      quantileIf(0.50)(latency_ms, latency_ms > 0)                             AS p50_provider,
      quantileIf(0.95)(latency_ms, latency_ms > 0)                             AS p95_provider,
      quantileIf(0.99)(latency_ms, latency_ms > 0)                             AS p99_provider,
      avgIf(latency_ms, latency_ms > 0)                                        AS avg_provider,
      quantileIf(0.50)(proxy_overhead_ms, isNotNull(proxy_overhead_ms))        AS p50_overhead,
      quantileIf(0.95)(proxy_overhead_ms, isNotNull(proxy_overhead_ms))        AS p95_overhead,
      quantileIf(0.99)(proxy_overhead_ms, isNotNull(proxy_overhead_ms))        AS p99_overhead,
      avgIf(proxy_overhead_ms, isNotNull(proxy_overhead_ms))                   AS avg_overhead
    FROM requests
    WHERE ${scope.whereScope}
      AND created_at >= parseDateTime64BestEffort({sinceTs:String})`

  const result = await getClickhouse().query({
    query: sql,
    query_params: { ...scope.scopeParams, sinceTs },
    format: 'JSONEachRow',
  })
  const rows = (await result.json()) as Array<Record<string, string | number | null>>
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
