import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/db.js'
import { getOrgClickhouse } from '../lib/clickhouse.js'
import { deliverToChannel, type AlertNotification } from '../lib/notifiers.js'
import { retryFailedWebhooks } from '../lib/webhook-dispatch.js'
import { computeAndReportOverages } from '../lib/paddle-usage.js'
import { runQuotaWarningsJob } from '../lib/quota-warnings.js'
import { snapshotAnomaliesForAllOrgs } from '../lib/anomaly-snapshot.js'
import { runStaleKeyDigestJob } from '../lib/stale-key-digest.js'
import { runLeakDetectionJob } from '../lib/leak-detection.js'
import { sendHighConfidenceRecommendationAlerts } from '../lib/recommendation-notify.js'
import { logCronRun } from '../lib/cron-logger.js'
import { replayFallbackQueue } from '../lib/fallback-replay.js'

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

  const start = Date.now()
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

  const hasError = results.some((r) => r.error)
  logCronRun('aggregate-usage', hasError ? 'error' : 'ok', Date.now() - start, hasError ? results.find((r) => r.error)?.error : undefined).catch(console.error)

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
      // sum(cost_usd) — no row limit needed, ClickHouse aggregates over the
      // whole window in-DB. Earlier Supabase implementation capped at 10k rows
      // which silently under-reported large alert windows.
      const result = await ch.query({
        query: `SELECT sum(cost_usd) AS total FROM requests WHERE ${where}`,
        query_params: params,
        format: 'JSONEachRow',
      })
      const rows = (await result.json()) as Array<{ total: string | number | null }>
      return Number(rows[0]?.total ?? 0)
    }

    if (alert.type === 'error_rate') {
      // Single GROUP-less aggregation returns both numerator and denominator.
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

    // latency_p95 — ClickHouse's quantile() computes in-DB. Replaces the old
    // "pull 10k sorted rows, index into array" pattern (also subject to the
    // 10k cap which silently under-estimated p95 at scale).
    const result = await ch.query({
      query: `SELECT quantileIf(0.95)(latency_ms, latency_ms > 0) AS p95 FROM requests WHERE ${where}`,
      query_params: params,
      format: 'JSONEachRow',
    })
    const rows = (await result.json()) as Array<{ p95: string | number | null }>
    return Number(rows[0]?.p95 ?? 0)
  } catch (err) {
    console.error('[computeMetric] ClickHouse query failed:', err instanceof Error ? err.message : err, { alert_id: alert.id })
    return null
  }
}

cronRouter.get('/evaluate-alerts', async (c) => {
  const authFail = assertCronAuth(c.req.header('Authorization'))
  if (authFail) return c.json({ error: authFail }, 401)

  const start = Date.now()
  const dashboardBase = process.env['DASHBOARD_URL'] ?? 'https://spanlens-web.vercel.app'

  const { data: alerts } = await supabaseAdmin
    .from('alerts')
    .select('id, organization_id, project_id, name, type, threshold, window_minutes, cooldown_minutes, last_triggered_at')
    .eq('is_active', true)

  const report: Array<{ alert_id: string; fired: boolean; reason?: string }> = []

  // Phase 1: evaluate metrics, skip cooldowns and under-threshold alerts.
  const firingAlerts: { alert: AlertRow; current: number }[] = []

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
    return c.json({ success: true, evaluated: report.length, report })
  }

  // Phase 2: batch-fetch channels + org names for all firing orgs (eliminates N+1).
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

  // Phase 3: deliver notifications and stamp last_triggered_at.
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
      dashboardUrl: `${dashboardBase}/dashboard`,
    }

    if (channels.length === 0) {
      // Metric exceeded threshold but no channels configured — skip cooldown stamp
      // so the alert fires immediately once channels are added.
      report.push({ alert_id: alert.id, fired: false, reason: 'no_channels' })
      continue
    }

    // Fan out to every active channel; log each delivery
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

    // Stamp last_triggered_at only after delivery was attempted.
    await supabaseAdmin
      .from('alerts')
      .update({ last_triggered_at: new Date().toISOString() })
      .eq('id', alert.id)

    report.push({ alert_id: alert.id, fired: true })
  }

  logCronRun('evaluate-alerts', 'ok', Date.now() - start).catch(console.error)
  return c.json({ success: true, evaluated: report.length, report })
})

// ── Paddle usage overage reporting (daily) ──────────────────────
cronRouter.get('/report-usage-overage', async (c) => {
  const authFail = assertCronAuth(c.req.header('Authorization'))
  if (authFail) return c.json({ error: authFail }, 401)

  const start = Date.now()
  try {
    const reports = await computeAndReportOverages()
    logCronRun('report-usage-overage', 'ok', Date.now() - start).catch(console.error)
    return c.json({ success: true, count: reports.length, reports })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    logCronRun('report-usage-overage', 'error', Date.now() - start, msg).catch(console.error)
    return c.json({ error: msg }, 500)
  }
})

// ── Quota warnings (hourly) ─────────────────────────────────────
// For every org on a paid plan that crosses 80% / 100% of its monthly
// request quota, send a warning email via Resend. Idempotent per calendar
// month per threshold (tracked on organizations.quota_warning_*_sent_at).
cronRouter.get('/check-quota-warnings', async (c) => {
  const authFail = assertCronAuth(c.req.header('Authorization'))
  if (authFail) return c.json({ error: authFail }, 401)

  const start = Date.now()
  try {
    const result = await runQuotaWarningsJob()
    logCronRun('check-quota-warnings', 'ok', Date.now() - start).catch(console.error)
    return c.json({ success: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    logCronRun('check-quota-warnings', 'error', Date.now() - start, msg).catch(console.error)
    return c.json({ error: msg }, 500)
  }
})

// ── Anomaly snapshot (daily) ────────────────────────────────────
// Records detected anomalies into anomaly_events for the dashboard's
// "history" view. Idempotent per (org, day, provider, model, kind).
cronRouter.get('/snapshot-anomalies', async (c) => {
  const authFail = assertCronAuth(c.req.header('Authorization'))
  if (authFail) return c.json({ error: authFail }, 401)

  const start = Date.now()
  try {
    const results = await snapshotAnomaliesForAllOrgs()
    const total = results.reduce((s, r) => s + r.detected, 0)
    const errored = results.filter((r) => r.errors.length > 0).length
    logCronRun('snapshot-anomalies', 'ok', Date.now() - start).catch(console.error)
    return c.json({ success: true, orgs: results.length, anomalies: total, errors: errored, results })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    logCronRun('snapshot-anomalies', 'error', Date.now() - start, msg).catch(console.error)
    return c.json({ error: msg }, 500)
  }
})

// ── Log retention + rate-limit bucket cleanup (daily) ──────────
cronRouter.get('/prune-logs', async (c) => {
  const authFail = assertCronAuth(c.req.header('Authorization'))
  if (authFail) return c.json({ error: authFail }, 401)

  const start = Date.now()
  const [logsResult, bucketsResult] = await Promise.all([
    supabaseAdmin.rpc('prune_logs_by_retention'),
    supabaseAdmin.rpc('prune_rate_limit_buckets'),
  ])

  if (logsResult.error) {
    logCronRun('prune-logs', 'error', Date.now() - start, logsResult.error.message).catch(console.error)
    return c.json({ error: logsResult.error.message }, 500)
  }

  logCronRun('prune-logs', 'ok', Date.now() - start).catch(console.error)
  return c.json({
    success: true,
    logs: logsResult.data,
    rate_limit_buckets_pruned: bucketsResult.error ? null : bucketsResult.data,
  })
})

// ── Stale provider key reminders (weekly) ───────────────────────
// For every org with stale_key_alerts_enabled = true, find provider_keys
// idle past their threshold (default 90d) and email a digest to admins.
// Notification-only — keys are NOT auto-revoked. Schedule weekly via
// Vercel cron (Mondays 9am UTC) — see apps/server/vercel.json.
cronRouter.get('/stale-key-reminders', async (c) => {
  const authFail = assertCronAuth(c.req.header('Authorization'))
  if (authFail) return c.json({ error: authFail }, 401)

  const start = Date.now()
  try {
    const result = await runStaleKeyDigestJob()
    logCronRun('stale-key-reminders', 'ok', Date.now() - start).catch(console.error)
    return c.json({ success: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    logCronRun('stale-key-reminders', 'error', Date.now() - start, msg).catch(console.error)
    return c.json({ error: msg }, 500)
  }
})

// ── High-confidence savings recommendation alerts (daily) ────────
// For each org, run the recommendation engine. If any swap reaches
// high-confidence (≥$40/mo + ≥100 samples) and hasn't been notified yet,
// send an email to the org owner and record the notification for idempotency.
cronRouter.get('/recommend-savings-alerts', async (c) => {
  const authFail = assertCronAuth(c.req.header('Authorization'))
  if (authFail) return c.json({ error: authFail }, 401)

  const start = Date.now()
  try {
    const results = await sendHighConfidenceRecommendationAlerts()
    const totalSent    = results.reduce((s, r) => s + r.sent, 0)
    const totalSkipped = results.reduce((s, r) => s + r.skipped, 0)
    const totalErrors  = results.reduce((s, r) => s + r.errors.length, 0)
    logCronRun('recommend-savings-alerts', 'ok', Date.now() - start).catch(console.error)
    return c.json({ success: true, orgs: results.length, sent: totalSent, skipped: totalSkipped, errors: totalErrors, results })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    logCronRun('recommend-savings-alerts', 'error', Date.now() - start, msg).catch(console.error)
    return c.json({ error: msg }, 500)
  }
})

// ── Webhook retry (every 5 minutes) ────────────────────────────
// Re-dispatches failed webhook_deliveries whose next_retry_at is past.
// Uses exponential back-off up to MAX_ATTEMPTS (5).
cronRouter.get('/retry-webhooks', async (c) => {
  const authFail = assertCronAuth(c.req.header('Authorization'))
  if (authFail) return c.json({ error: authFail }, 401)

  const start = Date.now()
  try {
    const result = await retryFailedWebhooks()
    logCronRun('retry-webhooks', 'ok', Date.now() - start).catch(console.error)
    return c.json({ success: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    logCronRun('retry-webhooks', 'error', Date.now() - start, msg).catch(console.error)
    return c.json({ error: msg }, 500)
  }
})

// ── Provider key leak detection (daily) ─────────────────────────
// For every org with leak_detection_enabled = true, scan each active
// provider_key against GitGuardian's HasMySecretLeaked corpus and email
// admins on a fresh hit. Notification-only — keys are NOT auto-revoked.
// Per-key scan results stored in provider_key_leak_scans for dedup +
// dashboard display. Requires GITGUARDIAN_API_KEY env var.
cronRouter.get('/leak-detect-keys', async (c) => {
  const authFail = assertCronAuth(c.req.header('Authorization'))
  if (authFail) return c.json({ error: authFail }, 401)

  const start = Date.now()
  try {
    const result = await runLeakDetectionJob()
    logCronRun('leak-detect-keys', 'ok', Date.now() - start).catch(console.error)
    return c.json({ success: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    logCronRun('leak-detect-keys', 'error', Date.now() - start, msg).catch(console.error)
    return c.json({ error: msg }, 500)
  }
})

// ── ClickHouse fallback replay (every 5 minutes) ────────────────
// Drains rows queued in Supabase `requests_fallback` (populated by
// logger.ts when ClickHouse INSERT throws) back into ClickHouse. Bounded
// batch size + retry counter prevent runaway / poison payloads. See
// lib/fallback-replay.ts for full design. Schedule wired in vercel.json.
cronRouter.get('/replay-fallback', async (c) => {
  const authFail = assertCronAuth(c.req.header('Authorization'))
  if (authFail) return c.json({ error: authFail }, 401)

  const start = Date.now()
  try {
    const result = await replayFallbackQueue()
    // Treat partial failure (some rows still queued after retry++) as success
    // for the cron infra — the rows will be retried next run. Only a top-level
    // result.error (e.g. Supabase SELECT failed) is a hard cron failure.
    const status = result.error ? 'error' : 'ok'
    logCronRun('replay-fallback', status, Date.now() - start, result.error).catch(console.error)
    return c.json({ success: !result.error, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    logCronRun('replay-fallback', 'error', Date.now() - start, msg).catch(console.error)
    return c.json({ error: msg }, 500)
  }
})
