import { supabaseAdmin } from './db.js'
import { computeStats, groupByBucket } from './anomaly-stats.js'

/**
 * Anomaly detection over recent `requests` rows.
 *
 * Strategy: for each (provider, model) bucket in the observation window,
 * compute baseline mean + stddev from the preceding "reference window",
 * then flag current-window requests whose latency, cost, OR error rate
 * sits beyond `sigmaThreshold` standard deviations from baseline.
 *
 * Using sample stddev (n-1). We skip buckets with fewer than `minSamples`
 * reference rows — statistically meaningless.
 *
 * Latency / cost are computed only over successful requests so a 500-storm
 * doesn't poison the latency baseline (errors typically return fast).
 * Error rate uses ALL rows (success + failure) and tracks the fraction.
 */

export type AnomalyKind = 'latency' | 'cost' | 'error_rate'

export interface AnomalyBucket {
  provider: string
  model: string
  kind: AnomalyKind
  currentValue: number         // observation-window mean
  baselineMean: number         // reference-window mean
  baselineStdDev: number       // reference-window stddev (sample, n-1)
  deviations: number           // (currentValue - mean) / stddev
  sampleCount: number          // observation-window size
  referenceCount: number       // reference-window size
}

export interface DetectAnomaliesOptions {
  /** Current (short, recent) window. Default 1 hour. */
  observationHours?: number
  /** Reference (long, historical) window. Default 7 days. */
  referenceHours?: number
  /** Min sigmas to flag. Default 3 (conventional 3-sigma). */
  sigmaThreshold?: number
  /** Min reference rows per bucket for stats to be meaningful. */
  minSamples?: number
  /** Optional project scope. */
  projectId?: string
}

interface RequestRow {
  provider: string
  model: string
  latency_ms: number | null
  cost_usd: number | null
  status_code: number
  created_at: string
}

/**
 * Detect anomalous buckets. Returns one AnomalyBucket per (provider,model,kind)
 * that deviates past the threshold. Empty array = everything normal.
 */
export async function detectAnomalies(
  organizationId: string,
  opts: DetectAnomaliesOptions = {},
): Promise<AnomalyBucket[]> {
  const observationHours = opts.observationHours ?? 1
  const referenceHours = opts.referenceHours ?? 24 * 7
  const sigmaThreshold = opts.sigmaThreshold ?? 3
  const minSamples = opts.minSamples ?? 30

  const now = Date.now()
  const observationStart = new Date(now - observationHours * 3_600_000).toISOString()
  const referenceStart = new Date(now - referenceHours * 3_600_000).toISOString()

  // Pull ALL status codes — error_rate detection needs both success and
  // failure rows. Per-kind filters below decide which subset each metric
  // uses (success-only for latency/cost, all for error_rate).
  let query = supabaseAdmin
    .from('requests')
    .select('provider, model, latency_ms, cost_usd, status_code, created_at')
    .eq('organization_id', organizationId)
    .gte('created_at', referenceStart)
    .not('model', 'is', null)

  if (opts.projectId) query = query.eq('project_id', opts.projectId)

  const { data, error } = await query
  if (error || !data) return []

  const allRows = data as RequestRow[]
  if (allRows.length < minSamples) return []

  // Split into observation vs reference
  const observationRows: RequestRow[] = []
  const referenceRows: RequestRow[] = []
  for (const r of allRows) {
    if (r.created_at >= observationStart) observationRows.push(r)
    else referenceRows.push(r)
  }

  const observationBuckets = groupByBucket(observationRows)
  const referenceBuckets = groupByBucket(referenceRows)

  const anomalies: AnomalyBucket[] = []

  for (const [key, obsRows] of observationBuckets) {
    const refRows = referenceBuckets.get(key) ?? []
    if (refRows.length < minSamples) continue

    const [provider = '', model = ''] = key.split('|')

    // Success-only subsets — used for latency + cost so a 500-storm doesn't
    // skew the latency baseline (errors usually return fast = artificially low).
    const obsSuccess = obsRows.filter((r) => r.status_code < 400)
    const refSuccess = refRows.filter((r) => r.status_code < 400)

    // ── Latency (success-only) ─────────────────────────────────────────
    const obsLatencies = obsSuccess
      .map((r) => r.latency_ms)
      .filter((v): v is number => v !== null)
    const refLatencies = refSuccess
      .map((r) => r.latency_ms)
      .filter((v): v is number => v !== null)

    if (obsLatencies.length > 0 && refLatencies.length >= minSamples) {
      const obsStats = computeStats(obsLatencies)
      const refStats = computeStats(refLatencies)
      if (refStats.stdDev > 0) {
        const deviations = (obsStats.mean - refStats.mean) / refStats.stdDev
        if (Math.abs(deviations) >= sigmaThreshold) {
          anomalies.push({
            provider,
            model,
            kind: 'latency',
            currentValue: obsStats.mean,
            baselineMean: refStats.mean,
            baselineStdDev: refStats.stdDev,
            deviations,
            sampleCount: obsStats.count,
            referenceCount: refStats.count,
          })
        }
      }
    }

    // ── Cost (success-only) ─────────────────────────────────────────────
    const obsCosts = obsSuccess
      .map((r) => r.cost_usd)
      .filter((v): v is number => v !== null)
    const refCosts = refSuccess
      .map((r) => r.cost_usd)
      .filter((v): v is number => v !== null)

    if (obsCosts.length > 0 && refCosts.length >= minSamples) {
      const obsStats = computeStats(obsCosts)
      const refStats = computeStats(refCosts)
      if (refStats.stdDev > 0) {
        const deviations = (obsStats.mean - refStats.mean) / refStats.stdDev
        if (Math.abs(deviations) >= sigmaThreshold) {
          anomalies.push({
            provider,
            model,
            kind: 'cost',
            currentValue: obsStats.mean,
            baselineMean: refStats.mean,
            baselineStdDev: refStats.stdDev,
            deviations,
            sampleCount: obsStats.count,
            referenceCount: refStats.count,
          })
        }
      }
    }

    // ── Error rate (all rows: success + failure) ────────────────────────
    // Each request encoded as 1 (error) or 0 (success). Mean = error rate;
    // stddev approximates √(p(1-p)) — Bernoulli proportion variance.
    if (obsRows.length > 0 && refRows.length >= minSamples) {
      const obsErrors = obsRows.map((r) => (r.status_code >= 400 ? 1 : 0))
      const refErrors = refRows.map((r) => (r.status_code >= 400 ? 1 : 0))
      const obsStats = computeStats(obsErrors)
      const refStats = computeStats(refErrors)
      if (refStats.stdDev > 0) {
        const deviations = (obsStats.mean - refStats.mean) / refStats.stdDev
        // One-sided: only flag SPIKES (more errors than baseline). A drop
        // in error rate is good news, not an incident.
        if (deviations >= sigmaThreshold) {
          anomalies.push({
            provider,
            model,
            kind: 'error_rate',
            currentValue: obsStats.mean,
            baselineMean: refStats.mean,
            baselineStdDev: refStats.stdDev,
            deviations,
            sampleCount: obsStats.count,
            referenceCount: refStats.count,
          })
        }
      }
    }
  }

  // Sort by magnitude of deviation (most anomalous first)
  anomalies.sort((a, b) => Math.abs(b.deviations) - Math.abs(a.deviations))

  return anomalies
}
