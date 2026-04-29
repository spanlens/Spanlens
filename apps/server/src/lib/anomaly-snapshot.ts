import { supabaseAdmin } from './db.js'
import { detectAnomalies, ANOMALY_DEFAULTS, type AnomalyBucket } from './anomaly.js'
import { deliverToChannel, type AlertNotification, type NotificationChannelRow } from './notifiers.js'

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

const CHUNK_SIZE = 10

export async function snapshotAnomaliesForAllOrgs(
  now: Date = new Date(),
): Promise<SnapshotResult[]> {
  const today = now.toISOString().slice(0, 10) // YYYY-MM-DD

  // Pick orgs with at least one request in the past 24h — anomaly detection
  // needs traffic anyway, no point invoking it for inactive orgs.
  const since = new Date(now.getTime() - 86_400_000).toISOString()
  // Limit prevents OOM on high-traffic instances; JS dedup handles the rest.
  // A proper DISTINCT RPC would be cleaner at very large scale.
  const { data: orgs } = await supabaseAdmin
    .from('requests')
    .select('organization_id')
    .gte('created_at', since)
    .limit(50000)
    .returns<{ organization_id: string }[]>()

  const uniqueOrgIds = Array.from(new Set((orgs ?? []).map((r) => r.organization_id)))
  const results: SnapshotResult[] = []

  // Process in parallel chunks to avoid opening 1 DB connection per org while
  // still keeping throughput high. CHUNK_SIZE = 10 is conservative enough to
  // avoid Supabase connection pool exhaustion.
  for (let i = 0; i < uniqueOrgIds.length; i += CHUNK_SIZE) {
    const chunk = uniqueOrgIds.slice(i, i + CHUNK_SIZE)
    const chunkResults = await Promise.all(
      chunk.map(async (orgId) => {
        const result: SnapshotResult = { orgId, detected: 0, errors: [] }
        try {
          const anomalies = await detectAnomalies(orgId, {
            observationHours: ANOMALY_DEFAULTS.OBSERVATION_HOURS,
            referenceHours: ANOMALY_DEFAULTS.REFERENCE_HOURS,
            sigmaThreshold: ANOMALY_DEFAULTS.SIGMA_THRESHOLD,
          })
          if (anomalies.length === 0) return result

          await persistSnapshot(orgId, today, anomalies)
          result.detected = anomalies.length

          // Send notifications for high-severity (≥5σ) anomalies via configured channels.
          const highSeverity = anomalies.filter((a) => a.deviations >= ANOMALY_DEFAULTS.HIGH_SEVERITY_SIGMA)
          if (highSeverity.length > 0) {
            await notifyHighSeverityAnomalies(orgId, highSeverity).catch((err) => {
              result.errors.push(`notify: ${err instanceof Error ? err.message : 'unknown'}`)
            })
          }
        } catch (err) {
          result.errors.push(err instanceof Error ? err.message : 'unknown')
        }
        return result
      }),
    )
    results.push(...chunkResults)
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

async function notifyHighSeverityAnomalies(
  orgId: string,
  anomalies: AnomalyBucket[],
): Promise<void> {
  const [channelsRes, orgRes] = await Promise.all([
    supabaseAdmin
      .from('notification_channels')
      .select('kind, target')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .returns<NotificationChannelRow[]>(),
    supabaseAdmin
      .from('organizations')
      .select('name')
      .eq('id', orgId)
      .single<{ name: string }>(),
  ])

  const channels = channelsRes.data ?? []
  if (channels.length === 0) return

  const orgName = orgRes.data?.name ?? orgId
  const webUrl = process.env['WEB_URL'] ?? 'https://www.spanlens.io'

  // Fan out all (anomaly × channel) pairs in parallel.
  const settled = await Promise.allSettled(
    anomalies.flatMap((anomaly) => {
      // 'cost' maps to 'budget' — AlertNotification.alertType uses Alerts enum vocabulary.
      const kindLabel =
        anomaly.kind === 'latency' ? 'latency_p95'
        : anomaly.kind === 'error_rate' ? 'error_rate'
        : 'budget'

      const notification: AlertNotification = {
        alertName: `${anomaly.provider}/${anomaly.model} · ${anomaly.kind} (${anomaly.deviations.toFixed(1)}σ)`,
        alertType: kindLabel as AlertNotification['alertType'],
        threshold: anomaly.baselineMean,
        currentValue: anomaly.currentValue,
        windowMinutes: 60,
        organizationName: orgName,
        dashboardUrl: `${webUrl}/anomalies`,
      }

      return channels.map(async (channel) => {
        const result = await deliverToChannel(channel.kind, channel.target, notification)
        if (!result.ok) {
          console.error('[anomaly-notify]', orgId, channel.kind, result.error)
        }
      })
    }),
  )

  // Re-throw aggregated delivery failures so the caller's .catch() can record them.
  const failures = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failures.length > 0) {
    const msg = failures.map((f) => f.reason instanceof Error ? f.reason.message : 'unknown').join('; ')
    throw new Error(msg)
  }
}

export async function getAnomalyHistory(
  organizationId: string,
  days = 30,
): Promise<AnomalyHistoryEntry[]> {
  const now = Date.now()
  const since = new Date(now - days * 86_400_000).toISOString().slice(0, 10)
  // Exclude today: today's state is shown in real-time detection, not history.
  const today = new Date(now).toISOString().slice(0, 10)
  const { data, error } = await supabaseAdmin
    .from('anomaly_events')
    .select(
      'id, detected_on, provider, model, kind, current_value, baseline_mean, baseline_stddev, deviations, sample_count, reference_count',
    )
    .eq('organization_id', organizationId)
    .gte('detected_on', since)
    .lt('detected_on', today)
    .order('detected_on', { ascending: false })
    .limit(5000)
    .returns<AnomalyEventRow[]>()

  if (error || !data) return []

  return data.map((r) => ({
    id: r.id,
    detectedOn: r.detected_on,
    provider: r.provider,
    model: r.model,
    kind: r.kind,
    currentValue: Number(r.current_value) || 0,
    baselineMean: Number(r.baseline_mean) || 0,
    baselineStdDev: Number(r.baseline_stddev) || 0,
    deviations: Number(r.deviations) || 0,
    sampleCount: r.sample_count,
    referenceCount: r.reference_count,
  }))
}
