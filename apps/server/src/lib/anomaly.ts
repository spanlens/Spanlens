import { getClickhouse } from './clickhouse.js'

/**
 * Anomaly detection over recent `requests` rows.
 *
 * Strategy: one ClickHouse GROUP BY scan over the requests table returns
 * pre-aggregated stats (mean, stddev, count) per (provider, model) for both
 * the observation and reference windows. The sigma threshold check runs here
 * in TypeScript so the policy stays in one place.
 *
 * Uses stddevSamp (n-1, Bessel-corrected) — matches the previous Postgres
 * STDDEV_SAMP behavior exactly.
 * Latency / cost are computed only over successful requests (status_code < 400).
 * Error rate uses ALL rows (Bernoulli proportion).
 * Error rate is one-sided: only upward spikes are flagged.
 *
 * Replaces the `detect_anomaly_stats` + `get_anomaly_factors` Postgres
 * functions that lived in Supabase before the ClickHouse migration.
 */

/**
 * ClickHouse DateTime64 won't accept the trailing 'Z' in toISOString();
 * strip it for parseDateTime64BestEffort like every other call site.
 */
function fmtTs(iso: string): string {
  return iso.replace('T', ' ').replace('Z', '')
}

export type AnomalyKind = 'latency' | 'cost' | 'error_rate'

export interface AnomalyContributingFactors {
  obsPromptTokensMean: number | null
  refPromptTokensMean: number | null
  obsCompletionTokensMean: number | null
  refCompletionTokensMean: number | null
  obsTotalTokensMean: number | null
  refTotalTokensMean: number | null
  /** Top error status codes observed in the observation window (for error_rate anomalies). */
  obsStatusDistribution: Array<{ code: number; count: number }>
}

export const ANOMALY_DEFAULTS = {
  OBSERVATION_HOURS: 1,
  REFERENCE_HOURS: 168,
  SIGMA_THRESHOLD: 3,
  MIN_SAMPLES: 30,
  HIGH_SEVERITY_SIGMA: 5,
} as const

export interface AnomalyBucket {
  provider: string
  model: string
  kind: AnomalyKind
  currentValue: number
  baselineMean: number
  baselineStdDev: number
  deviations: number
  /** Number of requests in the observation (current) window. */
  sampleCount: number
  /** Number of requests in the reference (historical) window. */
  referenceCount: number
}

export interface DetectAnomaliesOptions {
  /** Current (short, recent) window. Default 1 hour. */
  observationHours?: number
  /** Reference (long, historical) window. Default 7 days. */
  referenceHours?: number
  /** Min sigmas to flag. Default 3. */
  sigmaThreshold?: number
  /** Min reference rows per bucket for stats to be meaningful. */
  minSamples?: number
  /** Optional project scope. */
  projectId?: string
}

interface AnomalyStatsRow {
  provider: string
  model: string
  obs_latency_mean: number | null
  obs_latency_count: number
  ref_latency_mean: number | null
  ref_latency_stddev: number | null
  ref_latency_count: number
  obs_cost_mean: number | null
  obs_cost_count: number
  ref_cost_mean: number | null
  ref_cost_stddev: number | null
  ref_cost_count: number
  obs_error_rate: number | null
  obs_all_count: number
  ref_error_rate: number | null
  ref_error_stddev: number | null
  ref_all_count: number
}

export async function detectAnomalies(
  organizationId: string,
  opts: DetectAnomaliesOptions = {},
): Promise<AnomalyBucket[]> {
  const observationHours = opts.observationHours ?? ANOMALY_DEFAULTS.OBSERVATION_HOURS
  const referenceHours   = opts.referenceHours  ?? ANOMALY_DEFAULTS.REFERENCE_HOURS
  const sigmaThreshold   = opts.sigmaThreshold  ?? ANOMALY_DEFAULTS.SIGMA_THRESHOLD
  const minSamples       = opts.minSamples       ?? ANOMALY_DEFAULTS.MIN_SAMPLES

  const now     = Date.now()
  const obsStart = fmtTs(new Date(now - observationHours * 3_600_000).toISOString())
  const refStart = fmtTs(new Date(now - referenceHours  * 3_600_000).toISOString())

  const params: Record<string, unknown> = {
    orgId: organizationId,
    obsStart,
    refStart,
  }
  let projectClause = ''
  if (opts.projectId) {
    projectClause = ' AND project_id = {projectId:UUID}'
    params['projectId'] = opts.projectId
  }

  // One GROUP BY scan computes all 16 columns. The Postgres function used
  // FILTER (WHERE …); ClickHouse's countIf/avgIf/stddevSampIf is the analog.
  // success-only filters cover latency/cost (status_code < 400); error_rate
  // averages a Bernoulli indicator across all rows.
  const sql = `
    SELECT
      provider,
      model,
      avgIf(latency_ms,        created_at >= parseDateTime64BestEffort({obsStart:String}) AND status_code < 400 AND latency_ms > 0) AS obs_latency_mean,
      countIf(                  created_at >= parseDateTime64BestEffort({obsStart:String}) AND status_code < 400 AND latency_ms > 0) AS obs_latency_count,
      avgIf(latency_ms,        created_at <  parseDateTime64BestEffort({obsStart:String}) AND status_code < 400 AND latency_ms > 0) AS ref_latency_mean,
      stddevSampIf(latency_ms, created_at <  parseDateTime64BestEffort({obsStart:String}) AND status_code < 400 AND latency_ms > 0) AS ref_latency_stddev,
      countIf(                  created_at <  parseDateTime64BestEffort({obsStart:String}) AND status_code < 400 AND latency_ms > 0) AS ref_latency_count,
      avgIf(cost_usd,          created_at >= parseDateTime64BestEffort({obsStart:String}) AND status_code < 400 AND isNotNull(cost_usd)) AS obs_cost_mean,
      countIf(                  created_at >= parseDateTime64BestEffort({obsStart:String}) AND status_code < 400 AND isNotNull(cost_usd)) AS obs_cost_count,
      avgIf(cost_usd,          created_at <  parseDateTime64BestEffort({obsStart:String}) AND status_code < 400 AND isNotNull(cost_usd)) AS ref_cost_mean,
      stddevSampIf(cost_usd,   created_at <  parseDateTime64BestEffort({obsStart:String}) AND status_code < 400 AND isNotNull(cost_usd)) AS ref_cost_stddev,
      countIf(                  created_at <  parseDateTime64BestEffort({obsStart:String}) AND status_code < 400 AND isNotNull(cost_usd)) AS ref_cost_count,
      avgIf(if(status_code >= 400, 1.0, 0.0),       created_at >= parseDateTime64BestEffort({obsStart:String})) AS obs_error_rate,
      countIf(                                       created_at >= parseDateTime64BestEffort({obsStart:String})) AS obs_all_count,
      avgIf(if(status_code >= 400, 1.0, 0.0),       created_at <  parseDateTime64BestEffort({obsStart:String})) AS ref_error_rate,
      stddevSampIf(if(status_code >= 400, 1.0, 0.0),created_at <  parseDateTime64BestEffort({obsStart:String})) AS ref_error_stddev,
      countIf(                                       created_at <  parseDateTime64BestEffort({obsStart:String})) AS ref_all_count
    FROM requests
    WHERE organization_id = {orgId:UUID}
      AND created_at >= parseDateTime64BestEffort({refStart:String})${projectClause}
    GROUP BY provider, model
    HAVING obs_all_count > 0 OR ref_all_count > 0`

  let data: AnomalyStatsRow[]
  try {
    const result = await getClickhouse().query({
      query: sql,
      query_params: params,
      format: 'JSONEachRow',
    })
    const rawRows = (await result.json()) as Array<Record<string, string | number | null>>
    data = rawRows.map((r) => ({
      provider: String(r['provider'] ?? ''),
      model: String(r['model'] ?? ''),
      obs_latency_mean:   r['obs_latency_mean']   == null ? null : Number(r['obs_latency_mean']),
      obs_latency_count:  Number(r['obs_latency_count']  ?? 0),
      ref_latency_mean:   r['ref_latency_mean']   == null ? null : Number(r['ref_latency_mean']),
      ref_latency_stddev: r['ref_latency_stddev'] == null ? null : Number(r['ref_latency_stddev']),
      ref_latency_count:  Number(r['ref_latency_count']  ?? 0),
      obs_cost_mean:      r['obs_cost_mean']      == null ? null : Number(r['obs_cost_mean']),
      obs_cost_count:     Number(r['obs_cost_count']     ?? 0),
      ref_cost_mean:      r['ref_cost_mean']      == null ? null : Number(r['ref_cost_mean']),
      ref_cost_stddev:    r['ref_cost_stddev']    == null ? null : Number(r['ref_cost_stddev']),
      ref_cost_count:     Number(r['ref_cost_count']     ?? 0),
      obs_error_rate:     r['obs_error_rate']     == null ? null : Number(r['obs_error_rate']),
      obs_all_count:      Number(r['obs_all_count']      ?? 0),
      ref_error_rate:     r['ref_error_rate']     == null ? null : Number(r['ref_error_rate']),
      ref_error_stddev:   r['ref_error_stddev']   == null ? null : Number(r['ref_error_stddev']),
      ref_all_count:      Number(r['ref_all_count']      ?? 0),
    }))
  } catch (err) {
    console.error('[detectAnomalies] ClickHouse query failed:', err instanceof Error ? err.message : err)
    return []
  }
  if (data.length === 0) return []

  const anomalies: AnomalyBucket[] = []

  for (const row of data) {
    // ── Latency (success-only) ──────────────────────────────────────────
    if (
      row.obs_latency_mean    !== null &&
      row.obs_latency_count    >  0   &&
      row.ref_latency_mean    !== null &&
      row.ref_latency_stddev  !== null &&
      row.ref_latency_stddev   >  0   &&
      row.ref_latency_count   >= minSamples
    ) {
      const deviations = (row.obs_latency_mean - row.ref_latency_mean) / row.ref_latency_stddev
      // One-sided: only flag SPIKES (improvements are not anomalies).
      if (deviations >= sigmaThreshold) {
        anomalies.push({
          provider:       row.provider,
          model:          row.model,
          kind:           'latency',
          currentValue:   row.obs_latency_mean,
          baselineMean:   row.ref_latency_mean,
          baselineStdDev: row.ref_latency_stddev,
          deviations,
          sampleCount:    row.obs_latency_count,
          referenceCount: row.ref_latency_count,
        })
      }
    }

    // ── Cost (success-only) ─────────────────────────────────────────────
    if (
      row.obs_cost_mean    !== null &&
      row.obs_cost_count    >  0   &&
      row.ref_cost_mean    !== null &&
      row.ref_cost_stddev  !== null &&
      row.ref_cost_stddev   >  0   &&
      row.ref_cost_count   >= minSamples
    ) {
      const deviations = (row.obs_cost_mean - row.ref_cost_mean) / row.ref_cost_stddev
      // One-sided: only flag SPIKES (cost drops are not anomalies).
      if (deviations >= sigmaThreshold) {
        anomalies.push({
          provider:       row.provider,
          model:          row.model,
          kind:           'cost',
          currentValue:   row.obs_cost_mean,
          baselineMean:   row.ref_cost_mean,
          baselineStdDev: row.ref_cost_stddev,
          deviations,
          sampleCount:    row.obs_cost_count,
          referenceCount: row.ref_cost_count,
        })
      }
    }

    // ── Error rate (all rows, one-sided) ────────────────────────────────
    if (
      row.obs_error_rate    !== null &&
      row.obs_all_count      >  0   &&
      row.ref_error_rate    !== null &&
      row.ref_error_stddev  !== null &&
      row.ref_error_stddev   >  0   &&
      row.ref_all_count     >= minSamples
    ) {
      const deviations = (row.obs_error_rate - row.ref_error_rate) / row.ref_error_stddev
      // One-sided: only flag SPIKES (more errors than baseline).
      if (deviations >= sigmaThreshold) {
        anomalies.push({
          provider:       row.provider,
          model:          row.model,
          kind:           'error_rate',
          currentValue:   row.obs_error_rate,
          baselineMean:   row.ref_error_rate,
          baselineStdDev: row.ref_error_stddev,
          deviations,
          sampleCount:    row.obs_all_count,
          referenceCount: row.ref_all_count,
        })
      }
    }
  }

  // Most anomalous first
  anomalies.sort((a, b) => Math.abs(b.deviations) - Math.abs(a.deviations))
  return anomalies
}

/**
 * Fetches contributing factor data for a single anomaly — token averages
 * (obs vs reference window) and error status code distribution.
 * Called after anomaly detection to explain *why* the anomaly occurred.
 *
 * Replaces the old `get_anomaly_factors` Postgres function. We now run two
 * small ClickHouse queries (token CTE + status_code CTE) in parallel since
 * they shape into different output formats — simpler than the original
 * single-query approach and faster to add new factor columns later.
 */
export async function fetchContributingFactors(
  organizationId: string,
  provider: string,
  model: string,
  obsStart: string,
  refStart: string,
  projectId?: string,
): Promise<AnomalyContributingFactors | null> {
  const obsTs = fmtTs(obsStart)
  const refTs = fmtTs(refStart)
  const baseParams: Record<string, unknown> = {
    orgId: organizationId,
    provider,
    model,
    obsStart: obsTs,
    refStart: refTs,
  }
  let projectClause = ''
  if (projectId) {
    projectClause = ' AND project_id = {projectId:UUID}'
    baseParams['projectId'] = projectId
  }

  const tokensSql = `
    SELECT
      avgIf(prompt_tokens,     created_at >= parseDateTime64BestEffort({obsStart:String})) AS obs_prompt_tokens_mean,
      avgIf(prompt_tokens,     created_at <  parseDateTime64BestEffort({obsStart:String})) AS ref_prompt_tokens_mean,
      avgIf(completion_tokens, created_at >= parseDateTime64BestEffort({obsStart:String})) AS obs_completion_tokens_mean,
      avgIf(completion_tokens, created_at <  parseDateTime64BestEffort({obsStart:String})) AS ref_completion_tokens_mean,
      avgIf(total_tokens,      created_at >= parseDateTime64BestEffort({obsStart:String})) AS obs_total_tokens_mean,
      avgIf(total_tokens,      created_at <  parseDateTime64BestEffort({obsStart:String})) AS ref_total_tokens_mean
    FROM requests
    WHERE organization_id = {orgId:UUID}
      AND provider = {provider:String}
      AND model    = {model:String}
      AND created_at >= parseDateTime64BestEffort({refStart:String})${projectClause}`

  const errorsSql = `
    SELECT status_code AS code, count() AS cnt
    FROM requests
    WHERE organization_id = {orgId:UUID}
      AND provider = {provider:String}
      AND model    = {model:String}
      AND created_at >= parseDateTime64BestEffort({obsStart:String})
      AND status_code >= 400${projectClause}
    GROUP BY status_code
    ORDER BY cnt DESC
    LIMIT 5`

  try {
    const ch = getClickhouse()
    const [tokensResult, errorsResult] = await Promise.all([
      ch.query({ query: tokensSql, query_params: baseParams, format: 'JSONEachRow' }),
      ch.query({ query: errorsSql, query_params: baseParams, format: 'JSONEachRow' }),
    ])
    const tokenRows = (await tokensResult.json()) as Array<Record<string, string | number | null>>
    const errorRows = (await errorsResult.json()) as Array<{ code: string | number; cnt: string | number }>

    const tokenRow = tokenRows[0]
    if (!tokenRow) return null

    return {
      obsPromptTokensMean:     tokenRow['obs_prompt_tokens_mean']     == null ? null : Number(tokenRow['obs_prompt_tokens_mean']),
      refPromptTokensMean:     tokenRow['ref_prompt_tokens_mean']     == null ? null : Number(tokenRow['ref_prompt_tokens_mean']),
      obsCompletionTokensMean: tokenRow['obs_completion_tokens_mean'] == null ? null : Number(tokenRow['obs_completion_tokens_mean']),
      refCompletionTokensMean: tokenRow['ref_completion_tokens_mean'] == null ? null : Number(tokenRow['ref_completion_tokens_mean']),
      obsTotalTokensMean:      tokenRow['obs_total_tokens_mean']      == null ? null : Number(tokenRow['obs_total_tokens_mean']),
      refTotalTokensMean:      tokenRow['ref_total_tokens_mean']      == null ? null : Number(tokenRow['ref_total_tokens_mean']),
      obsStatusDistribution:   errorRows.map((r) => ({ code: Number(r.code), count: Number(r.cnt) })),
    }
  } catch (err) {
    console.error('[fetchContributingFactors] ClickHouse query failed:', err instanceof Error ? err.message : err)
    return null
  }
}
