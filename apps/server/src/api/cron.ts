import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/db.js'
import { deliverToChannel, type AlertNotification } from '../lib/notifiers.js'

/**
 * Vercel cron endpoints. Invoked hourly via `crons` entry in `vercel.json`.
 *
 * Security: Vercel injects an `Authorization: Bearer ${CRON_SECRET}` header
 * on cron-triggered requests. Every handler checks the header against the
 * `CRON_SECRET` env var so external callers cannot trigger these endpoints.
 *
 * If `CRON_SECRET` is unset, the endpoints refuse to run (fail-closed).
 */

export const cronRouter = new Hono()

function assertCronAuth(authHeader: string | undefined): string | null {
  const secret = process.env['CRON_SECRET']
  if (!secret) return 'CRON_SECRET not configured'
  if (authHeader !== `Bearer ${secret}`) return 'invalid cron auth'
  return null
}

// GET /cron/aggregate-usage
// Rolls up `requests` → `usage_daily` for today and yesterday.
// Yesterday covers the timezone edge: a request created at 23:59 UTC may
// only get aggregated after midnight UTC, so the first run of the new day
// finalizes yesterday's totals.
cronRouter.get('/aggregate-usage', async (c) => {
  const authFail = assertCronAuth(c.req.header('Authorization'))
  if (authFail) return c.json({ error: authFail }, 401)

  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const results: { date: string; rows: number | null; error?: string }[] = []

  for (const date of [yesterday, today]) {
    const { data, error } = await supabaseAdmin.rpc('aggregate_usage_daily', {
      target_date: date,
    })
    if (error) {
      results.push({ date, rows: null, error: error.message })
    } else {
      results.push({ date, rows: data as number })
    }
  }

  return c.json({
    success: true,
    ran_at: now.toISOString(),
    results,
  })
})

// ── Alert evaluator ────────────────────────────────────────────
// For each active alert, compute the metric over its window and fire if
// over threshold (respecting cooldown). Logs to alert_deliveries.

interface AlertRow {
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

interface ChannelRow {
  id: string
  kind: 'email' | 'slack' | 'discord'
  target: string
}

async function computeMetric(alert: AlertRow): Promise<number | null> {
  const windowStart = new Date(Date.now() - alert.window_minutes * 60 * 1000).toISOString()

  let query = supabaseAdmin
    .from('requests')
    .select('cost_usd, status_code, latency_ms', { count: 'exact' })
    .eq('organization_id', alert.organization_id)
    .gte('created_at', windowStart)

  if (alert.project_id) query = query.eq('project_id', alert.project_id)

  const { data, count, error } = await query
  if (error || !data) return null

  if (alert.type === 'budget') {
    return data.reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0)
  }
  if (alert.type === 'error_rate') {
    if (!count || count === 0) return 0
    const errors = data.filter((r) => Number(r.status_code) >= 400).length
    return errors / count
  }
  // latency_p95
  const latencies = data.map((r) => Number(r.latency_ms)).sort((a, b) => a - b)
  if (latencies.length === 0) return 0
  const idx = Math.ceil(latencies.length * 0.95) - 1
  return latencies[Math.max(0, idx)] ?? 0
}

cronRouter.get('/evaluate-alerts', async (c) => {
  const authFail = assertCronAuth(c.req.header('Authorization'))
  if (authFail) return c.json({ error: authFail }, 401)

  const dashboardBase = process.env['DASHBOARD_URL'] ?? 'https://spanlens-web.vercel.app'

  const { data: alerts } = await supabaseAdmin
    .from('alerts')
    .select('id, organization_id, project_id, name, type, threshold, window_minutes, cooldown_minutes, last_triggered_at')
    .eq('is_active', true)

  const report: Array<{ alert_id: string; fired: boolean; reason?: string }> = []

  for (const alert of (alerts ?? []) as AlertRow[]) {
    // Cooldown
    if (alert.last_triggered_at) {
      const lastMs = new Date(alert.last_triggered_at).getTime()
      const elapsedMin = (Date.now() - lastMs) / (60 * 1000)
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

    // Fetch channels for this org
    const { data: channels } = await supabaseAdmin
      .from('notification_channels')
      .select('id, kind, target')
      .eq('organization_id', alert.organization_id)
      .eq('is_active', true)

    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('name')
      .eq('id', alert.organization_id)
      .single()

    const notification: AlertNotification = {
      alertName: alert.name,
      alertType: alert.type,
      threshold: alert.threshold,
      currentValue: current,
      windowMinutes: alert.window_minutes,
      organizationName: (org?.name as string) ?? 'Your organization',
      dashboardUrl: `${dashboardBase}/dashboard`,
    }

    // Fan out to every active channel; log each delivery
    for (const ch of (channels ?? []) as ChannelRow[]) {
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

    // Stamp last_triggered_at
    await supabaseAdmin
      .from('alerts')
      .update({ last_triggered_at: new Date().toISOString() })
      .eq('id', alert.id)

    report.push({ alert_id: alert.id, fired: true })
  }

  return c.json({ success: true, evaluated: report.length, report })
})
