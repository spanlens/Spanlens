import { supabaseAdmin } from './db.js'
import { computeStats, groupByBucket } from './anomaly-stats.js'

/**
 * Anomaly detection over recent `requests` rows.
 *
 * Strategy: for each (provider, model) bucket in the observation window,
 * compute baseline mean + stddev from the preceding "reference window",
 * then flag current-window requests whose latency or cost sits beyond
 * `sigmaThreshold` standard deviations.
 *
 * Using sample stddev (n-1). We skip buckets with fewer than `minSamples`
 * reference rows — statistically meaningless.
 */

export type AnomalyKind = 'latency' | 'cost'

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

  let query = supabaseAdmin
    .from('requests')
    .select('provider, model, latency_ms, cost_usd, created_at')
    .eq('organization_id', organizationId)
    .gte('created_at', referenceStart)
    .in('status_code', [200, 201, 202, 204])
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

    // Latency
    const obsLatencies = obsRows
      .map((r) => r.latency_ms)
      .filter((v): v is number => v !== null)
    const refLatencies = refRows
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

    // Cost
    const obsCosts = obsRows
      .map((r) => r.cost_usd)
      .filter((v): v is number => v !== null)
    const refCosts = refRows
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
  }

  // Sort by magnitude of deviation (most anomalous first)
  anomalies.sort((a, b) => Math.abs(b.deviations) - Math.abs(a.deviations))

  return anomalies
}
