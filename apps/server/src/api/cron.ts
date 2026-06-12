import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { supabaseAdmin } from '../lib/db.js'
import { ApiError, serializeErrorEnvelope } from '../lib/errors.js'
// `unscopedClickhouse` is used by /cron/detect-missing-model-prices below
// to GROUP BY model across all tenants — that scan is the entire point of
// the alert and cannot be done per-org. The lint rule guards against
// tenant-blind reads from request handlers; this is operator-facing cron
// gated by CRON_SECRET, so the exception is intentional.
//
// /cron/keep-warm previously used unscopedClickhouse().query('SELECT 1')
// to warm the HTTP pool. We now use pingClickhouse() instead — same warmup
// effect, no need to reach for the raw client. See R-Q6.
// eslint-disable-next-line no-restricted-imports
import { unscopedClickhouse, getOrgClickhouse, pingClickhouse } from '../lib/clickhouse.js'
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

// Standalone router onError handler. Mirrors paddleWebhookRouter.onError
// — the cron handler unit tests call cronRouter.request() directly so
// thrown ApiError needs catching at the router level (the global
// app.onError only fires for requests that go through the parent app).
cronRouter.onError((err, c) => {
  const requestId =
    ((c as unknown as { get: (k: string) => string | undefined }).get('requestId')) ?? null
  const { status, body } = serializeErrorEnvelope(err, requestId)
  return c.json(body, status as ContentfulStatusCode)
})

/**
 * Validates the bearer token against CRON_SECRET. Throws ApiError so
 * the global onError handler serialises the standard envelope; before
 * Sprint 8 every cron handler had a two-line check-and-return that
 * accounted for 38 of the codebase's legacy `return c.json({error}, 401)`
 * sites — collapsing them into a throwing helper let the migration
 * codemod skip cron.ts entirely and the cleanup PR do this single
 * function change instead.
 *
 * Fail-closed: if CRON_SECRET is unset the endpoint refuses to run.
 * The cron scheduler (Vercel cron + GitHub Actions cron-server.yml)
 * always supplies the bearer header.
 */
function assertCronAuth(authHeader: string | undefined): void {
  const secret = process.env['CRON_SECRET']
  // The existing tests treat a missing CRON_SECRET the same as a failed
  // auth check (401), so map both to UNAUTHORIZED here to preserve the
  // contract. Operators still see CRON_SECRET not configured at startup
  // because a missing secret in production is alerted by self-monitor.
  if (!secret) throw new ApiError('UNAUTHORIZED', 'CRON_SECRET not configured')
  if (authHeader !== `Bearer ${secret}`) throw new ApiError('UNAUTHORIZED', 'invalid cron auth')
}

// GET /cron/aggregate-usage
// Rolls up `requests` → `usage_daily` for today and yesterday.
// Yesterday covers the timezone edge: a request created at 23:59 UTC may
// only get aggregated after midnight UTC, so the first run of the new day
// finalizes yesterday's totals.
cronRouter.get('/aggregate-usage', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

  const start = Date.now()
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // The Postgres function aggregate_usage_daily() used to do this work
  // back when requests lived in Postgres. P5.1 (gotcha #3, 2026-05-16)
  // moved requests to ClickHouse, but the function (and this handler)
  // were not migrated. The function still references the now-dropped
  // public.requests table, so every cron tick was returning "relation
  // requests does not exist" until this fix landed. Production logs
  // confirmed the error continuously since the migration.
  //
  // The cron-only path that needs aggregation now does ClickHouse SELECT
  // for the day window + Postgres UPSERT into usage_daily. RLS bypass
  // via service-role is OK here because aggregate-usage scans across
  // every tenant by design (it's the source of the dashboard's daily
  // rollup view).
  const results: Array<{
    date: string
    rows: number | null
    error?: string
  }> = []

  for (const date of [yesterday, today]) {
    try {
      // ClickHouse query: aggregate every successful LLM call for the
      // target day. The where clause mirrors the original SQL function:
      //   - status_code < 400 (skip errored calls)
      //   - non-empty model (skip rows we could not parse usage from)
      // Limits: none — ClickHouse aggregates in-DB so even a billion
      // rows per day stays cheap. We do not need the per-tenant
      // requestsScope helper because the cron is operator-internal and
      // by definition aggregates across every tenant.
      const sql = `
        SELECT
          organization_id,
          project_id,
          provider,
          model,
          count() AS request_count,
          sum(prompt_tokens) AS prompt_tokens,
          sum(completion_tokens) AS completion_tokens,
          sum(total_tokens) AS total_tokens,
          sum(cost_usd) AS cost_usd
        FROM requests
        WHERE created_at >= parseDateTime64BestEffort({dayStart:String})
          AND created_at <  parseDateTime64BestEffort({dayEnd:String})
          AND status_code < 400
          AND model != ''
        GROUP BY organization_id, project_id, provider, model
      `
      const dayStart = `${date} 00:00:00.000`
      const dayEnd = `${date} 23:59:59.999`
      const ch = unscopedClickhouse()
      const queryResult = await ch.query({
        query: sql,
        query_params: { dayStart, dayEnd },
        format: 'JSONEachRow',
      })
      const rows = (await queryResult.json()) as Array<{
        organization_id: string
        project_id: string
        provider: string
        model: string
        request_count: string | number
        prompt_tokens: string | number
        completion_tokens: string | number
        total_tokens: string | number
        cost_usd: string | number
      }>

      if (rows.length === 0) {
        results.push({ date, rows: 0 })
        continue
      }

      // Upsert each row into usage_daily. The UNIQUE constraint on
      // (organization_id, project_id, date, provider, model) makes
      // re-running a no-op for the same day — later hourly ticks just
      // overwrite the totals with the latest counts.
      // gotcha #19: ClickHouse JSONEachRow returns numbers as strings,
      // so wrap each numeric in Number() before writing to Postgres.
      const upserts = rows.map((r) => ({
        organization_id: r.organization_id,
        project_id: r.project_id,
        date,
        provider: r.provider,
        model: r.model,
        request_count: Number(r.request_count ?? 0),
        prompt_tokens: Number(r.prompt_tokens ?? 0),
        completion_tokens: Number(r.completion_tokens ?? 0),
        total_tokens: Number(r.total_tokens ?? 0),
        cost_usd: Number(r.cost_usd ?? 0),
        updated_at: new Date().toISOString(),
      }))
      const { error: upsertError } = await supabaseAdmin
        .from('usage_daily')
        .upsert(upserts, {
          onConflict: 'organization_id,project_id,date,provider,model',
        })
      if (upsertError) {
        results.push({ date, rows: null, error: upsertError.message })
      } else {
        results.push({ date, rows: upserts.length })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({ date, rows: null, error: msg })
    }
  }

  const hasError = results.some((r) => r.error)
  logCronRun('aggregate-usage', hasError ? 'error' : 'ok', Date.now() - start, hasError ? results.find((r) => r.error)?.error : undefined).catch(console.error)

  return c.json({
    success: !hasError,
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
  assertCronAuth(c.req.header('Authorization'))

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
  assertCronAuth(c.req.header('Authorization'))

  const start = Date.now()
  try {
    const reports = await computeAndReportOverages()
    logCronRun('report-usage-overage', 'ok', Date.now() - start).catch(console.error)
    return c.json({ success: true, count: reports.length, reports })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    logCronRun('report-usage-overage', 'error', Date.now() - start, msg).catch(console.error)
    throw new ApiError('INTERNAL_ERROR', msg)
  }
})

// ── Quota warnings (hourly) ─────────────────────────────────────
// For every org on a paid plan that crosses 80% / 100% of its monthly
// request quota, send a warning email via Resend. Idempotent per calendar
// month per threshold (tracked on organizations.quota_warning_*_sent_at).
cronRouter.get('/check-quota-warnings', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

  const start = Date.now()
  try {
    const result = await runQuotaWarningsJob()
    logCronRun('check-quota-warnings', 'ok', Date.now() - start).catch(console.error)
    return c.json({ success: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    logCronRun('check-quota-warnings', 'error', Date.now() - start, msg).catch(console.error)
    throw new ApiError('INTERNAL_ERROR', msg)
  }
})

// ── Anomaly snapshot (daily) ────────────────────────────────────
// Records detected anomalies into anomaly_events for the dashboard's
// "history" view. Idempotent per (org, day, provider, model, kind).
cronRouter.get('/snapshot-anomalies', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

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
    throw new ApiError('INTERNAL_ERROR', msg)
  }
})

// ── Log retention + rate-limit bucket cleanup (daily) ──────────
cronRouter.get('/prune-logs', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

  const start = Date.now()
  const [logsResult, bucketsResult] = await Promise.all([
    supabaseAdmin.rpc('prune_logs_by_retention'),
    supabaseAdmin.rpc('prune_rate_limit_buckets'),
  ])

  if (logsResult.error) {
    logCronRun('prune-logs', 'error', Date.now() - start, logsResult.error.message).catch(console.error)
    throw new ApiError('INTERNAL_ERROR', logsResult.error.message)
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
  assertCronAuth(c.req.header('Authorization'))

  const start = Date.now()
  try {
    const result = await runStaleKeyDigestJob()
    logCronRun('stale-key-reminders', 'ok', Date.now() - start).catch(console.error)
    return c.json({ success: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    logCronRun('stale-key-reminders', 'error', Date.now() - start, msg).catch(console.error)
    throw new ApiError('INTERNAL_ERROR', msg)
  }
})

// ── High-confidence savings recommendation alerts (daily) ────────
// For each org, run the recommendation engine. If any swap reaches
// high-confidence (≥$40/mo + ≥100 samples) and hasn't been notified yet,
// send an email to the org owner and record the notification for idempotency.
cronRouter.get('/recommend-savings-alerts', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

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
    throw new ApiError('INTERNAL_ERROR', msg)
  }
})

// ── Webhook retry (every 5 minutes) ────────────────────────────
// Re-dispatches failed webhook_deliveries whose next_retry_at is past.
// Uses exponential back-off up to MAX_ATTEMPTS (5).
cronRouter.get('/retry-webhooks', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

  const start = Date.now()
  try {
    const result = await retryFailedWebhooks()
    logCronRun('retry-webhooks', 'ok', Date.now() - start).catch(console.error)
    return c.json({ success: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    logCronRun('retry-webhooks', 'error', Date.now() - start, msg).catch(console.error)
    throw new ApiError('INTERNAL_ERROR', msg)
  }
})

// ── Provider key leak detection (daily) ─────────────────────────
// For every org with leak_detection_enabled = true, scan each active
// provider_key against GitGuardian's HasMySecretLeaked corpus and email
// admins on a fresh hit. Notification-only — keys are NOT auto-revoked.
// Per-key scan results stored in provider_key_leak_scans for dedup +
// dashboard display. Requires GITGUARDIAN_API_KEY env var.
cronRouter.get('/leak-detect-keys', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

  const start = Date.now()
  try {
    const result = await runLeakDetectionJob()
    logCronRun('leak-detect-keys', 'ok', Date.now() - start).catch(console.error)
    return c.json({ success: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    logCronRun('leak-detect-keys', 'error', Date.now() - start, msg).catch(console.error)
    throw new ApiError('INTERNAL_ERROR', msg)
  }
})

// ── ClickHouse fallback replay (every 5 minutes) ────────────────
// Drains rows queued in Supabase `requests_fallback` (populated by
// logger.ts when ClickHouse INSERT throws) back into ClickHouse. Bounded
// batch size + retry counter prevent runaway / poison payloads. See
// lib/fallback-replay.ts for full design. Schedule wired in vercel.json.
cronRouter.get('/replay-fallback', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

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
    throw new ApiError('INTERNAL_ERROR', msg)
  }
})

// ── Past-due downgrade check (daily, 10 UTC ≈ 19 KST) ───────────
// Sends D-3 / D-1 warning emails and flips orgs to free after 7 days of
// failed payments. Idempotent via the billing_downgrade_notifications
// table. See lib/billing-downgrade.ts for the policy + state machine.
cronRouter.get('/check-past-due-downgrades', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

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
    throw new ApiError('INTERNAL_ERROR', msg)
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
  assertCronAuth(c.req.header('Authorization'))

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
  assertCronAuth(c.req.header('Authorization'))

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
  assertCronAuth(c.req.header('Authorization'))

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
  assertCronAuth(c.req.header('Authorization'))

  const start = Date.now()

  // We query ClickHouse directly (not via requestsScope) on purpose —
  // this is a global health check, not a per-org read. The lint rule
  // guards against tenant-blind reads from org-facing handlers; this
  // handler is gated by CRON_SECRET, not by an org context. Same
  // exception applied as `/keep-warm`.
  try {
    const rs = await unscopedClickhouse().query({
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
      // gotcha #8: await before returning. The ClickHouse query in this
      // handler can take 30s on a cold-start ClickHouse Cloud instance,
      // eating into the lambda's budget. An unawaited supabase INSERT
      // racing the lambda shutdown loses the cron_job_runs row, which is
      // exactly what self-monitor watches — silent failures slip past.
      // The other cron handlers use the same .catch() pattern and got
      // away with it because their happy paths are sub-second; this one
      // can't. Inner .catch swallows logger failures so they don't mask
      // the original error in the response.
      await logCronRun(
        'detect-missing-model-prices',
        'error',
        Date.now() - start,
        `internal_alerts insert failed: ${insertError.message}`,
      ).catch(console.error)
      return c.json({ ok: false, error: 'failed to insert alert' }, 500)
    }

    await logCronRun('detect-missing-model-prices', 'ok', Date.now() - start).catch(console.error)
    return c.json({ ok: true, missing: models.length, models })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await logCronRun('detect-missing-model-prices', 'error', Date.now() - start, message).catch(console.error)
    return c.json({ ok: false, error: message }, 500)
  }
})

// GET /cron/self-monitor
//
// Production-side watchdog. Scans cron_job_runs for failures in the
// last hour and writes a single internal_alerts row of kind
// `cron_failure` summarising what broke. Replaces the
// "keep a Claude session open for 24h" pattern with something that
// works even when the operator's laptop is closed.
//
// Why a separate cron instead of generic monitoring:
//
//   - The existing alert pipeline (internal_alerts → /settings/alerts)
//     is the single place to triage production issues. Writing into
//     it keeps everything in one queue.
//   - Vercel cron + CRON_SECRET is enough infrastructure on its own.
//     Adding Sentry / Datadog / Slack would be more moving parts for
//     the level of signal we need at this scale.
//   - The watchdog runs after most other crons (xx:00 / xx:05 / xx:15
//     etc.) so any failure they logged in this hour is visible.
//
// Dedup: skip the INSERT when an unresolved cron_failure row already
// exists. The same broken cron firing every 5 minutes would otherwise
// flood /settings/alerts. The operator resolves the existing row when
// they push the fix; the next watchdog run after that re-fires if the
// issue is still happening (same pattern as missing_model_prices).
cronRouter.get('/self-monitor', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

  const start = Date.now()

  try {
    // 1) Find cron_job_runs failures in the last hour, grouped by job.
    //    Includes the most recent error_message for triage.
    const { data: failures, error: failuresErr } = await supabaseAdmin
      .from('cron_job_runs')
      .select('job_name, status, error_message, ran_at')
      .eq('status', 'error')
      .gte('ran_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .order('ran_at', { ascending: false })

    if (failuresErr) {
      logCronRun('self-monitor', 'error', Date.now() - start, `cron_job_runs query failed: ${failuresErr.message}`).catch(console.error)
      return c.json({ ok: false, error: 'query failed' }, 500)
    }

    const failureRows = failures ?? []
    if (failureRows.length === 0) {
      logCronRun('self-monitor', 'ok', Date.now() - start).catch(console.error)
      return c.json({ ok: true, failures: 0 })
    }

    // 2) Aggregate by job_name. Count of failures + most recent error_message
    //    per job goes into the alert details JSON.
    const byJob = new Map<string, { count: number; lastError: string | null; lastRanAt: string }>()
    for (const row of failureRows) {
      const existing = byJob.get(row.job_name)
      if (existing) {
        existing.count += 1
      } else {
        byJob.set(row.job_name, {
          count: 1,
          lastError: row.error_message ?? null,
          lastRanAt: row.ran_at,
        })
      }
    }
    const jobs = Array.from(byJob.entries()).map(([job_name, summary]) => ({
      job_name,
      count: summary.count,
      last_error: summary.lastError,
      last_ran_at: summary.lastRanAt,
    }))
    const totalFailures = failureRows.length

    // 3) Dedup: don't write a new alert if an unresolved cron_failure
    //    row already exists. The operator resolves it; the next watchdog
    //    re-fires if the issue persists.
    const { data: existing } = await supabaseAdmin
      .from('internal_alerts')
      .select('id')
      .eq('kind', 'cron_failure')
      .is('resolved_at', null)
      .limit(1)
      .maybeSingle()

    if (existing) {
      logCronRun('self-monitor', 'ok', Date.now() - start).catch(console.error)
      return c.json({ ok: true, failures: totalFailures, deduped: true, existing_alert_id: existing.id })
    }

    const { error: insertError } = await supabaseAdmin.from('internal_alerts').insert({
      kind: 'cron_failure',
      severity: 'error',
      message: `${jobs.length} cron job(s) failed in the last 1h (${totalFailures} run${totalFailures === 1 ? '' : 's'})`,
      details: { jobs, window_minutes: 60 },
    })

    if (insertError) {
      logCronRun('self-monitor', 'error', Date.now() - start, `internal_alerts insert failed: ${insertError.message}`).catch(console.error)
      return c.json({ ok: false, error: 'failed to insert alert' }, 500)
    }

    logCronRun('self-monitor', 'ok', Date.now() - start).catch(console.error)
    return c.json({ ok: true, failures: totalFailures, jobs })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logCronRun('self-monitor', 'error', Date.now() - start, message).catch(console.error)
    return c.json({ ok: false, error: message }, 500)
  }
})

// GET /cron/detect-orphan-spans
// R-14 (Sprint 5/6) watchdog. The `orphan-span-link` background migration
// is supposed to resolve external_parent_span_id → parent_span_id for OTLP
// spans whose parent arrived in a later batch. If that job is stuck (lock
// stolen by a crashed worker, registry mismatch, or just genuinely too
// many orphans for the chunk budget) we want a single internal_alerts row
// rather than silent data drift.
//
// Threshold logic: count orphans older than 1h (anything younger may still
// be in flight from a recently-arrived sibling batch). Alert when the
// count exceeds 100 — picked low enough that a real backlog surfaces fast,
// high enough that one slow OTLP batch doesn't page the operator.
// Dedup against unresolved alerts of the same kind so the operator gets
// one chip, not one per cron tick.
cronRouter.get('/detect-orphan-spans', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

  const start = Date.now()
  const THRESHOLD = 100
  const olderThan = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  try {
    const { count, error: countError } = await supabaseAdmin
      .from('spans')
      .select('id', { count: 'exact', head: true })
      .is('parent_span_id', null)
      .not('external_parent_span_id', 'is', null)
      .lt('created_at', olderThan)

    if (countError) {
      logCronRun('detect-orphan-spans', 'error', Date.now() - start, countError.message).catch(console.error)
      return c.json({ ok: false, error: countError.message }, 500)
    }

    const orphanCount = count ?? 0

    if (orphanCount <= THRESHOLD) {
      logCronRun('detect-orphan-spans', 'ok', Date.now() - start).catch(console.error)
      return c.json({ ok: true, count: orphanCount, threshold: THRESHOLD, alerted: false })
    }

    const { data: existing } = await supabaseAdmin
      .from('internal_alerts')
      .select('id')
      .eq('kind', 'orphan_spans')
      .is('resolved_at', null)
      .limit(1)
      .maybeSingle()

    if (existing) {
      logCronRun('detect-orphan-spans', 'ok', Date.now() - start).catch(console.error)
      return c.json({ ok: true, count: orphanCount, threshold: THRESHOLD, alerted: false, deduped: true, existing_alert_id: existing.id })
    }

    const { error: insertError } = await supabaseAdmin.from('internal_alerts').insert({
      kind: 'orphan_spans',
      severity: 'warn',
      message: `${orphanCount} orphan spans > 1h old (threshold ${THRESHOLD})`,
      details: { count: orphanCount, threshold: THRESHOLD, older_than: olderThan },
    })

    if (insertError) {
      logCronRun('detect-orphan-spans', 'error', Date.now() - start, `internal_alerts insert failed: ${insertError.message}`).catch(console.error)
      return c.json({ ok: false, error: 'failed to insert alert' }, 500)
    }

    logCronRun('detect-orphan-spans', 'ok', Date.now() - start).catch(console.error)
    return c.json({ ok: true, count: orphanCount, threshold: THRESHOLD, alerted: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logCronRun('detect-orphan-spans', 'error', Date.now() - start, message).catch(console.error)
    return c.json({ ok: false, error: message }, 500)
  }
})

// All three steps run in parallel via Promise.allSettled — one slow / failing
// dependency doesn't block the others, and we never throw (cron retries are
// noisy and a transient warmup failure is not worth alerting on). No
// logCronRun call: this fires every 5min and would spam cron_runs.
cronRouter.get('/keep-warm', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

  const started = Date.now()
  const results = await Promise.allSettled([
    // Supabase: cheapest possible read against an indexed PK. `limit(1)` +
    // `head: true` skips the row body, so the request is HEAD-shaped and
    // doesn't transfer payload — just warms the pool.
    supabaseAdmin.from('organizations').select('id', { count: 'exact', head: true }).limit(1),
    // ClickHouse: pingClickhouse() under the hood runs `.ping()` against
    // the singleton client, which exercises HTTP keep-alive, auth, and
    // the client's connection pool — exactly what keep-warm needs. Less
    // verbose than a synthetic SELECT and survives the no-restricted-imports
    // tightening from R-Q6.
    pingClickhouse(),
  ])

  const supabaseOk = results[0].status === 'fulfilled'
  // pingClickhouse() swallows its own errors and resolves to false, so the
  // outer settled-status is always 'fulfilled'. Look at the resolved value
  // instead — that's where the actual reachability signal lives.
  const clickhouseOk =
    results[1].status === 'fulfilled' && results[1].value === true
  return c.json({
    ok: supabaseOk && clickhouseOk,
    ts: new Date().toISOString(),
    durationMs: Date.now() - started,
    warmed: { supabase: supabaseOk, clickhouse: clickhouseOk },
  })
})
