/**
 * /cron/evaluate-alerts — fire customer-configured alerts on threshold breach.
 *
 * Extracted from api/cron.ts. Three-phase: (1) evaluate every active alert
 * metric and skip cooldowns / under-threshold, (2) batch-fetch channels +
 * org names for firing orgs (eliminates the N+1 that the inline version
 * had before R-A8), (3) deliver + stamp last_triggered_at + emit
 * webhook event.
 *
 * The ClickHouse aggregation here is per-org (uses getOrgClickhouse) so
 * one tenant's noisy window cannot starve others. computeMetric inlines
 * the three alert types (budget / error_rate / latency_p95) into a single
 * function instead of a strategy class — the three are stable, the type
 * union is tiny, and the strategy boilerplate would add more lines than
 * it saves.
 */

import { getOrgClickhouse } from '../clickhouse.js'
import { getOrgActivitySince, orgActiveSince, type OrgActivityMap } from '../org-activity.js'
import { lastSuccessfulRunAt } from '../cron-cadence.js'
import { supabaseAdmin } from '../db.js'
import { deliverToChannel, type AlertNotification } from '../notifiers.js'
import { emitWebhookEvent } from '../webhook-emit.js'
import { logError } from '../structured-logger.js'

export type AlertType = 'budget' | 'error_rate' | 'latency_p95' | 'eval_score'

export interface AlertRow {
  id: string
  organization_id: string
  project_id: string | null
  name: string
  type: AlertType
  threshold: number
  window_minutes: number
  cooldown_minutes: number
  last_triggered_at: string | null
}

/**
 * Whether `current` breaches the alert threshold. Direction depends on the
 * metric: budget / error_rate / latency_p95 are CEILINGS (breach when the
 * value rises to/above the threshold), while eval_score is a quality FLOOR
 * (breach when the score drops to/below it). Exported + pure so the
 * inverted eval_score direction is unit-testable without the full cron.
 */
export function isAlertBreached(type: AlertType, current: number, threshold: number): boolean {
  if (type === 'eval_score') return current <= threshold
  return current >= threshold
}

export interface ChannelRow {
  id: string
  kind: 'email' | 'slack' | 'discord'
  target: string
}

export interface EvaluateAlertsJobResult {
  success: boolean
  evaluated: number
  report: Array<{ alert_id: string; fired: boolean; reason?: string }>
  /**
   * Metrics that could not be computed (ClickHouse or Supabase error), as
   * opposed to metrics that legitimately found no data. The caller logs the
   * run as failed when this is non-zero so `lastSuccessfulRunAt` does not
   * advance — budget alerts gate on it, and moving it past a run that never
   * actually evaluated them would silence them until new traffic arrived.
   */
  metric_errors: number
}

/** Mutable per-run counters threaded through computeMetric. */
interface RunStats {
  metricErrors: number
}

/**
 * Earliest moment new traffic could change this alert's verdict.
 *
 * For most metrics that is simply the start of the alert's window. `budget`
 * is the exception, and it matters because budget alerts are the ones with
 * long windows — a monthly spend cap runs a 30-day window, which any org
 * that sent a single request in the last month falls inside. Gating on the
 * window alone leaves those alerts querying ClickHouse every 15 minutes
 * forever, which is the whole cost problem (lib/org-activity.ts).
 *
 * A budget metric is `sum(cost_usd)` over a sliding window, so with no new
 * rows it can only fall as old rows age out. If the previous run did not
 * breach, neither can this one. So for budget the gate moves forward to the
 * last successful run.
 *
 * error_rate and latency_p95 deliberately keep the window as their gate:
 * both are ratios or quantiles that CAN rise as old rows leave, so "no new
 * traffic" does not imply "no new breach". Their natural windows are short
 * anyway (an hour), which the watermark already handles well.
 */
function gateStartFor(alert: AlertRow, windowStart: Date, lastRun: Date | null): Date {
  if (alert.type !== 'budget') return windowStart
  if (!lastRun || lastRun.getTime() <= windowStart.getTime()) return windowStart
  return lastRun
}

async function computeMetric(
  alert: AlertRow,
  activity: OrgActivityMap | null,
  lastRun: Date | null,
  stats: RunStats,
): Promise<number | null> {
  // eval_score reads from Supabase (eval_runs), not ClickHouse. It is the
  // mean of completed runs' avg_score over the window. Returns null when no
  // completed runs scored in the window (no data → don't fire). eval_runs has
  // no project_id, so project-scoped eval_score alerts fall back to org-level.
  if (alert.type === 'eval_score') {
    const windowStartIso = new Date(Date.now() - alert.window_minutes * 60 * 1000).toISOString()
    const { data, error } = await supabaseAdmin
      .from('eval_runs')
      .select('avg_score')
      .eq('organization_id', alert.organization_id)
      .eq('status', 'completed')
      .gte('completed_at', windowStartIso)
      .not('avg_score', 'is', null)
    if (error) {
      logError('CRON_JOB_FAILED', {
        jobName: 'evaluate-alerts',
        orgId: alert.organization_id,
        alertId: alert.id,
        kind: 'compute_metric_eval_score',
      }, error)
      stats.metricErrors++
      return null
    }
    const scores = (data ?? [])
      .map((r) => r.avg_score)
      .filter((s): s is number => s != null)
    if (scores.length === 0) return null
    return scores.reduce((a, b) => a + b, 0) / scores.length
  }

  const windowStartDate = new Date(Date.now() - alert.window_minutes * 60 * 1000)

  // No new traffic since the gate, so this alert cannot newly breach and the
  // ClickHouse query is skipped. That is not just an optimisation: querying
  // anyway resets ClickHouse Cloud's 15-minute idle timer, which is what kept
  // the service billed around the clock (lib/org-activity.ts).
  //
  // 0 is the right stand-in for two different reasons depending on the gate.
  // When the gate is the window start, it is literally what ClickHouse would
  // have returned: budget sums nothing, error_rate divides by a zero total,
  // p95 of an empty set reads as 0. When the gate is the last run (budget
  // only — see gateStartFor), the true sum may still be non-zero, but it is
  // no higher than it was on the run that already decided not to fire, so 0
  // reaches the same verdict. The value is not surfaced on a non-firing
  // alert, so nothing downstream reads it.
  if (!orgActiveSince(activity, alert.organization_id, gateStartFor(alert, windowStartDate, lastRun)))
    return 0

  const windowStart = windowStartDate
    .toISOString()
    .replace('T', ' ')
    .replace('Z', '')
  const params: Record<string, unknown> = {
    orgId: alert.organization_id,
    windowStart,
  }
  let projectClause = ''
  if (alert.project_id) {
    projectClause = ' AND project_id = {projectId:UUID}'
    params['projectId'] = alert.project_id
  }
  const where =
    'organization_id = {orgId:UUID} ' +
    'AND created_at >= parseDateTime64BestEffort({windowStart:String})' +
    projectClause

  const { client: ch } = getOrgClickhouse(alert.organization_id)
  try {
    if (alert.type === 'budget') {
      const result = await ch.query({
        query: `SELECT sum(cost_usd) AS total FROM requests WHERE ${where}`,
        query_params: params,
        format: 'JSONEachRow',
      })
      const rows = (await result.json()) as Array<{ total: string | number | null }>
      return Number(rows[0]?.total ?? 0)
    }

    if (alert.type === 'error_rate') {
      const result = await ch.query({
        query: `
          SELECT count() AS total, countIf(status_code >= 400) AS errors
          FROM requests WHERE ${where}`,
        query_params: params,
        format: 'JSONEachRow',
      })
      const rows = (await result.json()) as Array<{ total: string | number; errors: string | number }>
      const total = Number(rows[0]?.total ?? 0)
      if (total === 0) return 0
      return Number(rows[0]?.errors ?? 0) / total
    }

    // latency_p95 — ClickHouse's quantile() computes in-DB.
    const result = await ch.query({
      query: `SELECT quantileIf(0.95)(latency_ms, latency_ms > 0) AS p95 FROM requests WHERE ${where}`,
      query_params: params,
      format: 'JSONEachRow',
    })
    const rows = (await result.json()) as Array<{ p95: string | number | null }>
    return Number(rows[0]?.p95 ?? 0)
  } catch (err) {
    logError('CRON_JOB_FAILED', {
      jobName: 'evaluate-alerts',
      orgId: alert.organization_id,
      alertId: alert.id,
      kind: 'compute_metric',
    }, err)
    stats.metricErrors++
    return null
  }
}

export async function runEvaluateAlertsJob(): Promise<EvaluateAlertsJobResult> {
  const webUrl = process.env['WEB_URL'] ?? 'https://www.spanlens.io'

  const { data: alerts } = await supabaseAdmin
    .from('alerts')
    .select('id, organization_id, project_id, name, type, threshold, window_minutes, cooldown_minutes, last_triggered_at')
    .eq('is_active', true)

  const report: Array<{ alert_id: string; fired: boolean; reason?: string }> = []
  const firingAlerts: { alert: AlertRow; current: number }[] = []

  const alertRows = (alerts ?? []) as AlertRow[]

  // One activity lookup for the whole run, using the widest alert window so a
  // single query serves every per-alert check. `computeMetric` narrows from
  // here; a null map means the watermark was unreadable and every org is
  // treated as active, which is exactly the pre-watermark behaviour.
  const widestWindowMinutes = alertRows.reduce((max, a) => Math.max(max, a.window_minutes), 0)
  const activity =
    widestWindowMinutes > 0
      ? await getOrgActivitySince(new Date(Date.now() - widestWindowMinutes * 60 * 1000))
      : null

  // Budget alerts gate on the later of their window and this — see
  // gateStartFor. Only fetched when there is something to evaluate.
  const lastRun = alertRows.length > 0 ? await lastSuccessfulRunAt('evaluate-alerts') : null
  const stats: RunStats = { metricErrors: 0 }

  // Phase 1: evaluate metrics
  for (const alert of alertRows) {
    if (alert.last_triggered_at) {
      const elapsedMin = (Date.now() - new Date(alert.last_triggered_at).getTime()) / 60_000
      if (elapsedMin < alert.cooldown_minutes) {
        report.push({ alert_id: alert.id, fired: false, reason: 'cooldown' })
        continue
      }
    }

    const current = await computeMetric(alert, activity, lastRun, stats)
    if (current == null) {
      // No data in the window (or a metric error) — can't assert a breach.
      report.push({ alert_id: alert.id, fired: false, reason: 'no_data' })
      continue
    }
    if (!isAlertBreached(alert.type, current, alert.threshold)) {
      report.push({ alert_id: alert.id, fired: false, reason: 'under_threshold' })
      continue
    }

    firingAlerts.push({ alert, current })
  }

  if (firingAlerts.length === 0) {
    return { success: true, evaluated: report.length, report, metric_errors: stats.metricErrors }
  }

  // Phase 2: batch-fetch channels + org names
  const firingOrgIds = [...new Set(firingAlerts.map((fa) => fa.alert.organization_id))]
  const [channelsRes, orgsRes] = await Promise.all([
    supabaseAdmin
      .from('notification_channels')
      .select('id, organization_id, kind, target')
      .in('organization_id', firingOrgIds)
      .eq('is_active', true),
    supabaseAdmin
      .from('organizations')
      .select('id, name')
      .in('id', firingOrgIds),
  ])

  const channelsByOrg = new Map<string, (ChannelRow & { organization_id: string })[]>()
  for (const ch of (channelsRes.data ?? []) as (ChannelRow & { organization_id: string })[]) {
    const list = channelsByOrg.get(ch.organization_id) ?? []
    list.push(ch)
    channelsByOrg.set(ch.organization_id, list)
  }

  const orgNameById = new Map<string, string>()
  for (const org of (orgsRes.data ?? []) as { id: string; name: string }[]) {
    orgNameById.set(org.id, org.name)
  }

  // Phase 3: deliver
  for (const { alert, current } of firingAlerts) {
    const channels = channelsByOrg.get(alert.organization_id) ?? []
    const orgName = orgNameById.get(alert.organization_id) ?? 'Your organization'

    const notification: AlertNotification = {
      alertName: alert.name,
      alertType: alert.type,
      threshold: alert.threshold,
      currentValue: current,
      windowMinutes: alert.window_minutes,
      organizationName: orgName,
      dashboardUrl: `${webUrl}/alerts`,
    }

    if (channels.length === 0) {
      report.push({ alert_id: alert.id, fired: false, reason: 'no_channels' })
      continue
    }

    for (const ch of channels) {
      const result = await deliverToChannel(ch.kind, ch.target, notification)
      await supabaseAdmin.from('alert_deliveries').insert({
        organization_id: alert.organization_id,
        alert_id: alert.id,
        channel_id: ch.id,
        status: result.ok ? 'sent' : 'failed',
        error_message: result.error ?? null,
        payload: notification as unknown as Record<string, unknown>,
      })
    }

    await supabaseAdmin
      .from('alerts')
      .update({ last_triggered_at: new Date().toISOString() })
      .eq('id', alert.id)

    await emitWebhookEvent(alert.organization_id, 'alert.triggered', {
      alert: {
        id: alert.id,
        name: alert.name,
        type: alert.type,
        threshold: alert.threshold,
        current_value: current,
        window_minutes: alert.window_minutes,
      },
      organization: { name: orgName },
    })

    report.push({ alert_id: alert.id, fired: true })
  }

  return { success: true, evaluated: report.length, report, metric_errors: stats.metricErrors }
}
