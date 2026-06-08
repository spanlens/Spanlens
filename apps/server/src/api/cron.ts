import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/db.js'
// `getClickhouse` is used by the /cron/keep-warm handler below to run
// `SELECT 1` with no org context. The lint rule guards against multi-tenant
// leaks via tenant-blind reads; this call site can't leak because it returns
// no rows. The org-scoped helpers all require an orgId we don't have at
// warmup time, so this is the only viable client for the warmup ping.
// eslint-disable-next-line no-restricted-imports
import { getClickhouse, getOrgClickhouse } from '../lib/clickhouse.js'
import { deliverToChannel, type AlertNotification } from '../lib/notifiers.js'
import { emitWebhookEvent } from '../lib/webhook-emit.js'
import { retryFailedWebhooks } from '../lib/webhook-dispatch.js'
import { computeAndReportOverages } from '../lib/paddle-usage.js'
import { runQuotaWarningsJob } from '../lib/quota-warnings.js'
import { snapshotAnomaliesForAllOrgs } from '../lib/anomaly-snapshot.js'
import { runStaleKeyDigestJob } from '../lib/stale-key-digest.js'
import { runDueMigrations } from '../lib/background-migrations/runner.js'
import { runReconciliationCron } from '../lib/events-reconciliation.js'
import { runLeakDetectionJob } from '../lib/leak-detection.js'
import { sendHighConfidenceRecommendationAlerts } from '../lib/recommendation-notify.js'
import { logCronRun } from '../lib/cron-logger.js'
import { replayFallbackQueue, replayEventsFallbackQueue } from '../lib/fallback-replay.js'
import { runDowngradeCheck } from '../lib/billing-downgrade.js'
import { executePendingDeletions } from './pendingDeletions.js'

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
  // Use the canonical WEB_URL (matches anomaly-snapshot, leak-detection,
  // recommendation-notify, stale-key-digest). Avoid introducing a parallel
  // DASHBOARD_URL env var that would silently drift from WEB_URL on rename.
  const webUrl = process.env['WEB_URL'] ?? 'https://www.spanlens.io'

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
      // Send users to /alerts (where the firing rule lives) instead of the
      // generic /dashboard — fewer clicks to silence or adjust the threshold.
      dashboardUrl: `${webUrl}/alerts`,
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

    // Outbound webhook: alert.triggered. Awaited (cron is a batch job, not
    // latency-sensitive); best-effort so a webhook failure never aborts the run.
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
    // 5.3 lite — drain both backstop queues in one cron tick. Independent
    // promises so a CH outage on one path doesn't block the other.
    const [requestsResult, eventsResult] = await Promise.all([
      replayFallbackQueue(),
      replayEventsFallbackQueue(),
    ])
    // Treat partial failure (some rows still queued after retry++) as success
    // for the cron infra — the rows will be retried next run. Only a top-level
    // result.error (e.g. Supabase SELECT failed) is a hard cron failure.
    const topErr = requestsResult.error ?? eventsResult.error
    const status = topErr ? 'error' : 'ok'
    logCronRun('replay-fallback', status, Date.now() - start, topErr).catch(console.error)
    return c.json({
      success: !topErr,
      requests: requestsResult,
      events: eventsResult,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    logCronRun('replay-fallback', 'error', Date.now() - start, msg).catch(console.error)
    return c.json({ error: msg }, 500)
  }
})

// ── Past-due downgrade check (daily, 10 UTC ≈ 19 KST) ───────────
// Sends D-3 / D-1 warning emails and flips orgs to free after 7 days of
// failed payments. Idempotent via the billing_downgrade_notifications
// table. See lib/billing-downgrade.ts for the policy + state machine.
cronRouter.get('/check-past-due-downgrades', async (c) => {
  const authFail = assertCronAuth(c.req.header('Authorization'))
  if (authFail) return c.json({ error: authFail }, 401)

  const start = Date.now()
  try {
    const result = await runDowngradeCheck()
    const status = result.errors.length > 0 ? 'error' : 'ok'
    const errSummary = result.errors.length > 0 ? result.errors.join('; ').slice(0, 500) : undefined
    logCronRun('check-past-due-downgrades', status, Date.now() - start, errSummary).catch(console.error)
    return c.json({ success: result.errors.length === 0, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    logCronRun('check-past-due-downgrades', 'error', Date.now() - start, msg).catch(console.error)
    return c.json({ error: msg }, 500)
  }
})

// GET /cron/keep-warm
// Lightweight ping that keeps the api/index.ts Lambda + DB connection pools
// warm. Vercel hibernates idle functions after ~10min (4-6s cold start cost)
// AND first-query latency to Supabase/ClickHouse pays connection setup even
// on a warm Lambda. This cron fires every 5min and touches both layers so
// the first real user request hits an already-paved path.
//
// What it does:
//   1. Lambda CPU/memory: just executing the handler keeps the instance hot.
//   2. Supabase Postgres: one trivial select. Warms the connection pool.
//   3. ClickHouse: SELECT 1 against the shared (no-org) client. Warms HTTP
//      keep-alive + auth token cache. Per-org clients lazily init on first
//      org request — those still pay first-call latency but the underlying
//      ClickHouse cluster cache is hot from this ping.
//
// GET /cron/execute-pending-deletions
// Walks the soft-delete queue: rows whose scheduled_for has elapsed get
// hard-deleted from their source table and stamped `executed_at`. Runs
// every 6 hours — the resolution of the grace window doesn't need to be
// tighter than that for UX, and infrequent runs keep cron_runs noise down.
cronRouter.get('/execute-pending-deletions', async (c) => {
  const authFail = assertCronAuth(c.req.header('Authorization'))
  if (authFail) return c.json({ error: authFail }, 401)

  const started = Date.now()
  const result = await executePendingDeletions({ batchSize: 100 })
  const durationMs = Date.now() - started

  await logCronRun(
    'execute-pending-deletions',
    result.failed === 0 ? 'ok' : 'error',
    durationMs,
    result.failed === 0
      ? undefined
      : `${result.failed} failures: ${result.errors.map((e) => e.error).slice(0, 3).join('; ')}`,
  )

  return c.json({
    ok: result.failed === 0,
    ts: new Date().toISOString(),
    durationMs,
    ...result,
  })
})

// GET /cron/run-background-migrations
// Picks one eligible row from `background_migrations` and runs it in a
// chunked loop until either complete or close to the function timeout
// (CHUNK_BUDGET_MS = 240s; Vercel Pro cap is 300s). Idempotent — a
// concurrent firing acquires no advisory lock and returns 'skipped'.
// Runs every 5 minutes so a paused migration resumes promptly.
cronRouter.get('/run-background-migrations', async (c) => {
  const authFail = assertCronAuth(c.req.header('Authorization'))
  if (authFail) return c.json({ error: authFail }, 401)

  const started = Date.now()
  const result = await runDueMigrations()
  const durationMs = Date.now() - started

  await logCronRun(
    'run-background-migrations',
    result.status === 'failed' ? 'error' : 'ok',
    durationMs,
    result.errorMessage,
  )

  return c.json({
    ok: result.status !== 'failed',
    ts: new Date().toISOString(),
    durationMs,
    ...result,
  })
})

// GET /cron/events-reconciliation
// Phase 5.1 Stage 3 — daily integrity check that the dual-write hasn't
// drifted. Compares the row count of `requests` vs `events` (filtered
// to event_type='generation') over a recent 24h window. Out-of-tolerance
// drift (>1%) marks the cron run failed so it surfaces in Vercel logs
// and the cron_job_runs table. Schedule: 02:00 UTC daily so it runs
// after the day's traffic has settled but before the operator's
// morning dashboard glance.
cronRouter.get('/events-reconciliation', async (c) => {
  const authFail = assertCronAuth(c.req.header('Authorization'))
  if (authFail) return c.json({ error: authFail }, 401)

  const started = Date.now()
  try {
    const result = await runReconciliationCron()
    await logCronRun('events-reconciliation', 'ok', Date.now() - started)
    return c.json({ ok: true, ts: new Date().toISOString(), ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    await logCronRun('events-reconciliation', 'error', Date.now() - started, message)
    return c.json({ ok: false, ts: new Date().toISOString(), error: message }, 200)
  }
})

// GET /cron/detect-missing-model-prices
//
// Hourly scan over the last hour's `requests` table for rows where `model`
// is populated but `cost_usd` is NULL. That combination means lib/cost.ts'
// `calculateCost()` couldn't resolve a price row for the model — almost
// always because `model_prices` doesn't have the SKU yet (gotcha #2: new
// LLM releases land in production before our price seed catches up).
//
// Threshold: 100 missing rows / hour / model. Below that, transient
// hiccups (mis-spelled model in a customer request, model in the middle
// of being deprecated, etc.) fire too many false-positives. 100/hour
// represents a real customer routing real traffic through an unpriced
// model and losing cost attribution every minute they wait.
//
// Output: one `internal_alerts` row of kind `missing_model_prices` per
// run when at least one model crosses the threshold. The details JSONB
// carries the per-model breakdown so the operator can decide which seed
// rows to add first. Multiple runs against the same unseeded model
// produce multiple alerts — we don't de-dup, because the operator clicks
// Resolve when they fix it and the next hour either re-fires (still
// broken) or stays quiet (fixed). De-duping with "skip if unresolved
// alert exists" would mask a still-failing fix.
//
// gotcha #32: this cron is internal ops, not org-scoped, so the
// events/requests feature-flag dual-read pattern does not apply.
// When Phase 5.1 Stage 4 lands and `requests` is dropped, the query
// here moves to `events` in the same PR.
cronRouter.get('/detect-missing-model-prices', async (c) => {
  const authFail = assertCronAuth(c.req.header('Authorization'))
  if (authFail) return c.json({ error: authFail }, 401)

  const start = Date.now()

  // We query ClickHouse directly (not via requestsScope) on purpose —
  // this is a global health check, not a per-org read. The lint rule
  // guards against tenant-blind reads from org-facing handlers; this
  // handler is gated by CRON_SECRET, not by an org context. Same
  // exception applied as `/keep-warm`.
  try {
    const rs = await getClickhouse().query({
      query: `
        SELECT model, count() AS missing_count
        FROM requests
        WHERE created_at >= now() - INTERVAL 1 HOUR
          AND cost_usd IS NULL
          AND model != ''
        GROUP BY model
        HAVING missing_count > 100
        ORDER BY missing_count DESC
      `,
      format: 'JSONEachRow',
    }).then((r) => r.json<{ model: string; missing_count: string }>())

    // ClickHouse JSONEachRow returns numbers as strings (gotcha #19).
    const models = rs.map((row) => ({
      model: row.model,
      count: Number(row.missing_count),
    }))

    if (models.length === 0) {
      logCronRun('detect-missing-model-prices', 'ok', Date.now() - start).catch(console.error)
      return c.json({ ok: true, missing: 0 })
    }

    const totalRows = models.reduce((sum, m) => sum + m.count, 0)
    const { error: insertError } = await supabaseAdmin.from('internal_alerts').insert({
      kind: 'missing_model_prices',
      severity: 'warn',
      message: `${models.length} model(s) missing prices in last 1h (${totalRows} rows)`,
      details: { models, threshold: 100 },
    })

    if (insertError) {
      logCronRun(
        'detect-missing-model-prices',
        'error',
        Date.now() - start,
        `internal_alerts insert failed: ${insertError.message}`,
      ).catch(console.error)
      return c.json({ ok: false, error: 'failed to insert alert' }, 500)
    }

    logCronRun('detect-missing-model-prices', 'ok', Date.now() - start).catch(console.error)
    return c.json({ ok: true, missing: models.length, models })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logCronRun('detect-missing-model-prices', 'error', Date.now() - start, message).catch(console.error)
    return c.json({ ok: false, error: message }, 500)
  }
})

// All three steps run in parallel via Promise.allSettled — one slow / failing
// dependency doesn't block the others, and we never throw (cron retries are
// noisy and a transient warmup failure is not worth alerting on). No
// logCronRun call: this fires every 5min and would spam cron_runs.
cronRouter.get('/keep-warm', async (c) => {
  const authFail = assertCronAuth(c.req.header('Authorization'))
  if (authFail) return c.json({ error: authFail }, 401)

  const started = Date.now()
  const results = await Promise.allSettled([
    // Supabase: cheapest possible read against an indexed PK. `limit(1)` +
    // `head: true` skips the row body, so the request is HEAD-shaped and
    // doesn't transfer payload — just warms the pool.
    supabaseAdmin.from('organizations').select('id', { count: 'exact', head: true }).limit(1),
    // ClickHouse: `SELECT 1` is the canonical no-op query. Bypasses any
    // table cache but exercises HTTP keep-alive, auth, and the cluster's
    // query parser. Format `JSONEachRow` matches our normal calls so the
    // shared client doesn't switch modes on the first real call.
    getClickhouse().query({ query: 'SELECT 1 AS ok', format: 'JSONEachRow' }).then((r) => r.json()),
  ])

  const supabaseOk = results[0].status === 'fulfilled'
  const clickhouseOk = results[1].status === 'fulfilled'
  return c.json({
    ok: supabaseOk && clickhouseOk,
    ts: new Date().toISOString(),
    durationMs: Date.now() - started,
    warmed: { supabase: supabaseOk, clickhouse: clickhouseOk },
  })
})
