import { supabaseAdmin } from './db.js'

/**
 * Anomaly detection over recent `requests` rows.
 *
 * Strategy: call the `detect_anomaly_stats` DB function which runs a single
 * GROUP BY scan over the requests table and returns pre-aggregated stats
 * (mean, stddev, count) per (provider, model) for both the observation and
 * reference windows. We then apply the sigma threshold here in TypeScript.
 *
 * Using STDDEV_SAMP (n-1, Bessel-corrected) in the DB function.
 * Latency / cost are computed only over successful requests (status_code < 400).
 * Error rate uses ALL rows (Bernoulli proportion).
 * Error rate is one-sided: only upward spikes are flagged.
 */

export type AnomalyKind = 'latency' | 'cost' | 'error_rate'

export interface AnomalyBucket {
  provider: string
  model: string
  kind: AnomalyKind
  currentValue: number
  baselineMean: number
  baselineStdDev: number
  deviations: number
  sampleCount: number
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
  const observationHours = opts.observationHours ?? 1
  const referenceHours   = opts.referenceHours  ?? 24 * 7
  const sigmaThreshold   = opts.sigmaThreshold  ?? 3
  const minSamples       = opts.minSamples       ?? 30

  const now     = Date.now()
  const obsStart = new Date(now - observationHours * 3_600_000).toISOString()
  const refStart = new Date(now - referenceHours  * 3_600_000).toISOString()

  const { data: rawData, error } = await supabaseAdmin
    .rpc('detect_anomaly_stats', {
      p_org_id:     organizationId,
      p_ref_start:  refStart,
      p_obs_start:  obsStart,
      p_project_id: opts.projectId ?? null,
    })

  if (error) {
    console.error('[detectAnomalies] rpc error:', error.message)
    return []
  }
  const data = rawData as AnomalyStatsRow[] | null
  if (!data) return []

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
      if (Math.abs(deviations) >= sigmaThreshold) {
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
      if (Math.abs(deviations) >= sigmaThreshold) {
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
