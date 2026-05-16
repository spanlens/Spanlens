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
