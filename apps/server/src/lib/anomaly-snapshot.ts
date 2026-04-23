import { supabaseAdmin } from './db.js'
import { detectAnomalies, type AnomalyBucket } from './anomaly.js'

/**
 * Daily snapshot job. Runs anomaly detection for every active organization
 * and persists any flagged buckets into `anomaly_events` so the dashboard
 * can show "anomalies on Tuesday at lunchtime" patterns over time.
 *
 * Idempotent per (org, day, provider, model, kind) via the table's UNIQUE
 * constraint — re-runs on the same day update the row instead of duplicating.
 *
 * Skip orgs with no traffic to keep the job fast at scale.
 */

export interface SnapshotResult {
  orgId: string
  detected: number
  errors: string[]
}

export async function snapshotAnomaliesForAllOrgs(
  now: Date = new Date(),
): Promise<SnapshotResult[]> {
  const today = now.toISOString().slice(0, 10) // YYYY-MM-DD

  // Pick orgs with at least one request in the past 24h — anomaly detection
  // needs traffic anyway, no point invoking it for inactive orgs.
  const since = new Date(now.getTime() - 86_400_000).toISOString()
  const { data: orgs } = await supabaseAdmin
    .from('requests')
    .select('organization_id')
    .gte('created_at', since)
    .returns<{ organization_id: string }[]>()

  const uniqueOrgIds = Array.from(new Set((orgs ?? []).map((r) => r.organization_id)))
  const results: SnapshotResult[] = []

  for (const orgId of uniqueOrgIds) {
    const result: SnapshotResult = { orgId, detected: 0, errors: [] }
    try {
      const anomalies = await detectAnomalies(orgId, {
        observationHours: 1,
        referenceHours: 24 * 7,
        sigmaThreshold: 3,
      })
      if (anomalies.length === 0) {
        results.push(result)
        continue
      }
      await persistSnapshot(orgId, today, anomalies)
      result.detected = anomalies.length
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : 'unknown')
    }
    results.push(result)
  }

  return results
}

async function persistSnapshot(
  orgId: string,
  detectedOn: string,
  anomalies: AnomalyBucket[],
): Promise<void> {
  const rows = anomalies.map((a) => ({
    organization_id: orgId,
    detected_on: detectedOn,
    provider: a.provider,
    model: a.model,
    kind: a.kind,
    current_value: a.currentValue,
    baseline_mean: a.baselineMean,
    baseline_stddev: a.baselineStdDev,
    deviations: a.deviations,
    sample_count: a.sampleCount,
    reference_count: a.referenceCount,
  }))

  // Upsert on the unique (org, day, provider, model, kind) tuple — re-runs
  // overwrite the same row rather than blocking on a unique violation.
  const { error } = await supabaseAdmin
    .from('anomaly_events')
    .upsert(rows, { onConflict: 'organization_id,detected_on,provider,model,kind' })

  if (error) {
    throw new Error(`persistSnapshot failed: ${error.message}`)
  }
}

interface AnomalyEventRow {
  id: string
  detected_on: string
  provider: string
  model: string
  kind: 'latency' | 'cost' | 'error_rate'
  current_value: string | number
  baseline_mean: string | number
  baseline_stddev: string | number
  deviations: string | number
  sample_count: number
  reference_count: number
}

export interface AnomalyHistoryEntry {
  id: string
  detectedOn: string
  provider: string
  model: string
  kind: 'latency' | 'cost' | 'error_rate'
  currentValue: number
  baselineMean: number
  baselineStdDev: number
  deviations: number
  sampleCount: number
  referenceCount: number
}

export async function getAnomalyHistory(
  organizationId: string,
  days = 30,
): Promise<AnomalyHistoryEntry[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  const { data, error } = await supabaseAdmin
    .from('anomaly_events')
    .select(
      'id, detected_on, provider, model, kind, current_value, baseline_mean, baseline_stddev, deviations, sample_count, reference_count',
    )
    .eq('organization_id', organizationId)
    .gte('detected_on', since)
    .order('detected_on', { ascending: false })
    .returns<AnomalyEventRow[]>()

  if (error || !data) return []

  return data.map((r) => ({
    id: r.id,
    detectedOn: r.detected_on,
    provider: r.provider,
    model: r.model,
    kind: r.kind,
    currentValue: Number(r.current_value),
    baselineMean: Number(r.baseline_mean),
    baselineStdDev: Number(r.baseline_stddev),
    deviations: Number(r.deviations),
    sampleCount: r.sample_count,
    referenceCount: r.reference_count,
  }))
}
