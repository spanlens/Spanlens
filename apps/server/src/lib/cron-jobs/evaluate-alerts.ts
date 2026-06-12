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
import { supabaseAdmin } from '../db.js'
import { deliverToChannel, type AlertNotification } from '../notifiers.js'
import { emitWebhookEvent } from '../webhook-emit.js'
import { logError } from '../structured-logger.js'

export interface AlertRow {
  id: string
  organization_id: string
  project_id: string | null
  name: string
  type: 'budget' | 'error_rate' | 'latency_p95'
  threshold: number
  window_minutes: number
  cooldown_minutes: number
  last_triggered_at: string | null
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
}

async function computeMetric(alert: AlertRow): Promise<number | null> {
  const windowStart = new Date(Date.now() - alert.window_minutes * 60 * 1000)
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

  // Phase 1: evaluate metrics
  for (const alert of (alerts ?? []) as AlertRow[]) {
    if (alert.last_triggered_at) {
      const elapsedMin = (Date.now() - new Date(alert.last_triggered_at).getTime()) / 60_000
      if (elapsedMin < alert.cooldown_minutes) {
        report.push({ alert_id: alert.id, fired: false, reason: 'cooldown' })
        continue
      }
    }

    const current = await computeMetric(alert)
    if (current == null || current < alert.threshold) {
      report.push({ alert_id: alert.id, fired: false, reason: 'under_threshold' })
      continue
    }

    firingAlerts.push({ alert, current })
  }

  if (firingAlerts.length === 0) {
    return { success: true, evaluated: report.length, report }
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

  return { success: true, evaluated: report.length, report }
}
