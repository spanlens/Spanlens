import { pgQuery } from './postgres.js'
import { requestsScope } from './requests-query.js'

/**
 * Anomaly detection over recent `requests` rows.
 *
 * Strategy: one GROUP BY scan over the requests table returns pre-aggregated
 * stats (mean, stddev, count) per (provider, model) for both the observation
 * and reference windows. The sigma threshold check runs here in TypeScript so
 * the policy stays in one place.
 *
 * Uses stddev_samp (n-1, Bessel-corrected).
 * Latency / cost are computed only over successful requests (status_code < 400).
 * Error rate uses ALL rows (Bernoulli proportion).
 * Error rate is one-sided: only upward spikes are flagged.
 *
 * Window splitting is done with aggregate `FILTER (WHERE …)` clauses, so the
 * observation and reference windows come out of a single pass over the rows
 * rather than one query each.
 *
 * Timestamps are bound as ISO-8601 strings (with the trailing `Z`) and cast
 * with `::timestamptz`, so the comparison is unambiguously UTC regardless of
 * the session timezone.
 */

export type AnomalyKind = 'latency' | 'cost' | 'error_rate'

/**
 * How statistically reliable this anomaly is, gated by the size of the
 * reference window:
 *
 *   • 'low'    — 10 to 29 reference samples. Surface as informational only;
 *                σ math is still mathematically valid but the small-sample
 *                estimate of the population stddev is wide.
 *   • 'medium' — 30 to 99. Roughly the cutoff where standard textbook
 *                "n ≥ 30" approximation of normality kicks in.
 *   • 'high'   — 100+. Both the mean and the stddev are well-estimated;
 *                the σ count is trustworthy enough to page on.
 *
 * Before P3.2 the detector required ≥30 samples to flag *anything*, so brand
 * new orgs (which have <30 historical samples for their first week) saw
 * zero anomalies. Surfacing 'low' confidence at 10 samples lets them see
 * directional signal while not making us look certain about a noisy stat.
 */
export type AnomalyConfidence = 'low' | 'medium' | 'high'

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
  /**
   * Minimum reference samples needed to surface an anomaly at any
   * confidence level. Below this threshold, the stddev estimate is too
   * noisy to be useful even with a clear "low confidence" label.
   */
  MIN_SAMPLES_LOW: 10,
  /**
   * Threshold for medium confidence — the historical "n ≥ 30 normality"
   * cutoff. Pre-P3.2 this was the hard `MIN_SAMPLES` gate.
   */
  MIN_SAMPLES_MEDIUM: 30,
  /** Threshold for high confidence — well-estimated mean + stddev. */
  MIN_SAMPLES_HIGH: 100,
  HIGH_SEVERITY_SIGMA: 5,
} as const

/**
 * Pure function so it's trivially testable. Returns null when the count
 * is too small to surface as an anomaly at all (caller filters out).
 */
export function classifyConfidence(referenceCount: number): AnomalyConfidence | null {
  if (referenceCount >= ANOMALY_DEFAULTS.MIN_SAMPLES_HIGH) return 'high'
  if (referenceCount >= ANOMALY_DEFAULTS.MIN_SAMPLES_MEDIUM) return 'medium'
  if (referenceCount >= ANOMALY_DEFAULTS.MIN_SAMPLES_LOW) return 'low'
  return null
}

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
  /**
   * How trustworthy the σ count is, given the size of the reference window.
   * Always present — even 'low' anomalies are surfaced (with a clear UI
   * marker) so new orgs see directional signal. See `classifyConfidence`
   * for the tier thresholds.
   */
  confidence: AnomalyConfidence
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
  // Gate at the LOW threshold — anomalies between 10..29 reference samples
  // still surface but are tagged `confidence: 'low'` for the UI to render
  // less prominently. Callers can override `minSamples` to suppress low
  // confidence entirely (e.g., the alert cron that only pages on
  // medium/high).
  const minSamples       = opts.minSamples       ?? ANOMALY_DEFAULTS.MIN_SAMPLES_LOW

  const now     = Date.now()
  const obsStart = new Date(now - observationHours * 3_600_000).toISOString()
  const refStart = new Date(now - referenceHours  * 3_600_000).toISOString()

  // Org isolation + plan retention (free=14d / pro=90d / team=365d). The
  // retention bound is enforced in addition to refStart, so a caller-supplied
  // referenceHours larger than the org's retention can never read past it
  // (gotcha #3 — every `requests` read must go through requestsScope).
  const { whereScope, scopeParams } = await requestsScope(organizationId)
  const params: Record<string, unknown> = {
    ...scopeParams,
    obsStart,
    refStart,
  }
  let projectClause = ''
  if (opts.projectId) {
    projectClause = ' AND project_id = {projectId}'
    params['projectId'] = opts.projectId
  }

  // One GROUP BY scan computes all 16 columns, split into the observation and
  // reference windows by per-aggregate FILTER clauses. Success-only filters
  // cover latency/cost (status_code < 400); error_rate averages a Bernoulli
  // indicator across all rows.
  //
  // `latency_ms > 0` (not `IS NOT NULL`) is deliberate and unchanged: the
  // column is NOT NULL DEFAULT 0, so 0 is the "never measured" sentinel and
  // `> 0` is what "has a real value" means here.
  //
  // The aggregate is wrapped in a subquery because the original HAVING
  // referenced the SELECT aliases `obs_all_count` / `ref_all_count`, which
  // Postgres does not allow in HAVING. Filtering in an outer WHERE keeps the
  // predicate readable instead of repeating two long count(*) FILTER
  // expressions.
  const sql = `
    SELECT * FROM (
      SELECT
        provider,
        model,
        avg(latency_ms)         FILTER (WHERE created_at >= {obsStart}::timestamptz AND status_code < 400 AND latency_ms > 0) AS obs_latency_mean,
        count(*)                FILTER (WHERE created_at >= {obsStart}::timestamptz AND status_code < 400 AND latency_ms > 0) AS obs_latency_count,
        avg(latency_ms)         FILTER (WHERE created_at <  {obsStart}::timestamptz AND status_code < 400 AND latency_ms > 0) AS ref_latency_mean,
        stddev_samp(latency_ms) FILTER (WHERE created_at <  {obsStart}::timestamptz AND status_code < 400 AND latency_ms > 0) AS ref_latency_stddev,
        count(*)                FILTER (WHERE created_at <  {obsStart}::timestamptz AND status_code < 400 AND latency_ms > 0) AS ref_latency_count,
        avg(cost_usd)           FILTER (WHERE created_at >= {obsStart}::timestamptz AND status_code < 400 AND cost_usd IS NOT NULL) AS obs_cost_mean,
        count(*)                FILTER (WHERE created_at >= {obsStart}::timestamptz AND status_code < 400 AND cost_usd IS NOT NULL) AS obs_cost_count,
        avg(cost_usd)           FILTER (WHERE created_at <  {obsStart}::timestamptz AND status_code < 400 AND cost_usd IS NOT NULL) AS ref_cost_mean,
        stddev_samp(cost_usd)   FILTER (WHERE created_at <  {obsStart}::timestamptz AND status_code < 400 AND cost_usd IS NOT NULL) AS ref_cost_stddev,
        count(*)                FILTER (WHERE created_at <  {obsStart}::timestamptz AND status_code < 400 AND cost_usd IS NOT NULL) AS ref_cost_count,
        avg(CASE WHEN status_code >= 400 THEN 1.0 ELSE 0.0 END)         FILTER (WHERE created_at >= {obsStart}::timestamptz) AS obs_error_rate,
        count(*)                                                        FILTER (WHERE created_at >= {obsStart}::timestamptz) AS obs_all_count,
        avg(CASE WHEN status_code >= 400 THEN 1.0 ELSE 0.0 END)         FILTER (WHERE created_at <  {obsStart}::timestamptz) AS ref_error_rate,
        stddev_samp(CASE WHEN status_code >= 400 THEN 1.0 ELSE 0.0 END) FILTER (WHERE created_at <  {obsStart}::timestamptz) AS ref_error_stddev,
        count(*)                                                        FILTER (WHERE created_at <  {obsStart}::timestamptz) AS ref_all_count
      FROM requests
      WHERE ${whereScope}
        AND created_at >= {refStart}::timestamptz${projectClause}
      GROUP BY provider, model
    ) s
    WHERE s.obs_all_count > 0 OR s.ref_all_count > 0`

  let data: AnomalyStatsRow[]
  try {
    // `numeric` / `int8` come back as strings (postgres.ts documents why) —
    // every column is coerced here, at the boundary.
    const rawRows = await pgQuery<Record<string, string | number | null>>({
      query: sql,
      params,
    })
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
    console.error('[detectAnomalies] Postgres query failed:', err instanceof Error ? err.message : err)
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
        const confidence = classifyConfidence(row.ref_latency_count)
        if (confidence !== null) {
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
            confidence,
          })
        }
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
        const confidence = classifyConfidence(row.ref_cost_count)
        if (confidence !== null) {
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
            confidence,
          })
        }
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
        const confidence = classifyConfidence(row.ref_all_count)
        if (confidence !== null) {
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
            confidence,
          })
        }
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
 * Two small queries (token averages + status_code distribution) run in
 * parallel since they shape into different output formats — simpler than a
 * single combined query and faster to add new factor columns later.
 */
export async function fetchContributingFactors(
  organizationId: string,
  provider: string,
  model: string,
  obsStart: string,
  refStart: string,
  projectId?: string,
): Promise<AnomalyContributingFactors | null> {
  // Same org + retention scoping as detectAnomalies (gotcha #3).
  const { whereScope, scopeParams } = await requestsScope(organizationId)
  const baseParams: Record<string, unknown> = {
    ...scopeParams,
    provider,
    model,
    obsStart,
    refStart,
  }
  let projectClause = ''
  if (projectId) {
    projectClause = ' AND project_id = {projectId}'
    baseParams['projectId'] = projectId
  }

  const tokensSql = `
    SELECT
      avg(prompt_tokens)     FILTER (WHERE created_at >= {obsStart}::timestamptz) AS obs_prompt_tokens_mean,
      avg(prompt_tokens)     FILTER (WHERE created_at <  {obsStart}::timestamptz) AS ref_prompt_tokens_mean,
      avg(completion_tokens) FILTER (WHERE created_at >= {obsStart}::timestamptz) AS obs_completion_tokens_mean,
      avg(completion_tokens) FILTER (WHERE created_at <  {obsStart}::timestamptz) AS ref_completion_tokens_mean,
      avg(total_tokens)      FILTER (WHERE created_at >= {obsStart}::timestamptz) AS obs_total_tokens_mean,
      avg(total_tokens)      FILTER (WHERE created_at <  {obsStart}::timestamptz) AS ref_total_tokens_mean
    FROM requests
    WHERE ${whereScope}
      AND provider = {provider}
      AND model    = {model}
      AND created_at >= {refStart}::timestamptz${projectClause}`

  const errorsSql = `
    SELECT status_code AS code, count(*) AS cnt
    FROM requests
    WHERE ${whereScope}
      AND provider = {provider}
      AND model    = {model}
      AND created_at >= {obsStart}::timestamptz
      AND status_code >= 400${projectClause}
    GROUP BY status_code
    ORDER BY cnt DESC
    LIMIT 5`

  try {
    // `refStart` is only referenced by tokensSql and `obsStart` only partly by
    // errorsSql, but both share `baseParams`; unused names are simply never
    // bound, so the shared object is safe.
    const [tokenRows, errorRows] = await Promise.all([
      pgQuery<Record<string, string | number | null>>({ query: tokensSql, params: baseParams }),
      pgQuery<{ code: string | number; cnt: string | number }>({ query: errorsSql, params: baseParams }),
    ])

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
    console.error('[fetchContributingFactors] Postgres query failed:', err instanceof Error ? err.message : err)
    return null
  }
}
