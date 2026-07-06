import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { supabaseAdmin } from '../lib/db.js'
import { ApiError, serializeErrorEnvelope } from '../lib/errors.js'
import { retryFailedWebhooks } from '../lib/webhook-dispatch.js'
import { computeAndReportOverages } from '../lib/paddle-usage.js'
import { runQuotaWarningsJob } from '../lib/quota-warnings.js'
import { snapshotAnomaliesForAllOrgs } from '../lib/anomaly-snapshot.js'
import { runStaleKeyDigestJob } from '../lib/stale-key-digest.js'
import { runDataSilenceJob } from '../lib/data-silence.js'
import { runWeeklyDigestJob } from '../lib/weekly-digest.js'
import { runDueMigrations } from '../lib/background-migrations/runner.js'
import { runReconciliationCron } from '../lib/events-reconciliation.js'
import { runLeakDetectionJob } from '../lib/leak-detection.js'
import { sendHighConfidenceRecommendationAlerts } from '../lib/recommendation-notify.js'
import { logCronRun } from '../lib/cron-logger.js'
import { purgeExpiredProxyCache } from '../lib/proxy-cache.js'
import { replayFallbackQueue, replayEventsFallbackQueue, alertOnFallbackBacklog } from '../lib/fallback-replay.js'
import { runDowngradeCheck } from '../lib/billing-downgrade.js'
import { executePendingDeletions } from './pendingDeletions.js'
// Inline cron job bodies were extracted to lib/cron-jobs/ in the 2026-06-12
// tech-debt pass. The 6 jobs below carried non-trivial logic (CH queries,
// multi-phase delivery, batched DB writes); the remaining 13 jobs were already
// lib-function-call thin and stay inline.
import { runAggregateUsageJob } from '../lib/cron-jobs/aggregate-usage.js'
import { runEvaluateAlertsJob } from '../lib/cron-jobs/evaluate-alerts.js'
import { runDetectMissingModelPricesJob } from '../lib/cron-jobs/detect-missing-model-prices.js'
import { runSelfMonitorJob } from '../lib/cron-jobs/self-monitor.js'
import { runDetectOrphanSpansJob } from '../lib/cron-jobs/detect-orphan-spans.js'
import { runPruneJudgeCacheJob } from '../lib/cron-jobs/prune-judge-cache.js'
import { runKeepWarmJob } from '../lib/cron-jobs/keep-warm.js'

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
 * the global onError handler serialises the standard envelope. Fail-closed:
 * if CRON_SECRET is unset the endpoint refuses to run. The cron scheduler
 * (Vercel cron + GitHub Actions cron-server.yml) always supplies the header.
 */
function assertCronAuth(authHeader: string | undefined): void {
  const secret = process.env['CRON_SECRET']
  if (!secret) throw new ApiError('UNAUTHORIZED', 'CRON_SECRET not configured')
  if (authHeader !== `Bearer ${secret}`) throw new ApiError('UNAUTHORIZED', 'invalid cron auth')
}

// ── /aggregate-usage — body in lib/cron-jobs/aggregate-usage.ts ───
cronRouter.get('/aggregate-usage', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

  const start = Date.now()
  const result = await runAggregateUsageJob()
  const errorMsg = result.success ? undefined : result.results.find((r) => r.error)?.error
  logCronRun('aggregate-usage', result.success ? 'ok' : 'error', Date.now() - start, errorMsg).catch(() => undefined)
  return c.json(result)
})

// ── /evaluate-alerts — body in lib/cron-jobs/evaluate-alerts.ts ──
cronRouter.get('/evaluate-alerts', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

  const start = Date.now()
  const result = await runEvaluateAlertsJob()
  logCronRun('evaluate-alerts', 'ok', Date.now() - start).catch(() => undefined)
  return c.json(result)
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

// ── Data silence detection (every 6h) ───────────────────────────
cronRouter.get('/detect-data-silence', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

  const start = Date.now()
  try {
    const result = await runDataSilenceJob()
    const status = result.errors.length > 0 ? 'error' : 'ok'
    const errSummary = result.errors.length > 0 ? result.errors.join('; ').slice(0, 500) : undefined
    logCronRun('detect-data-silence', status, Date.now() - start, errSummary).catch(console.error)
    return c.json({ success: result.errors.length === 0, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    logCronRun('detect-data-silence', 'error', Date.now() - start, msg).catch(console.error)
    throw new ApiError('INTERNAL_ERROR', msg)
  }
})

// ── Weekly usage digest (Monday 09 UTC) ─────────────────────────
cronRouter.get('/weekly-digest', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

  const start = Date.now()
  try {
    const result = await runWeeklyDigestJob()
    // `completed` = the aggregation phase ran; per-org email errors don't
    // flip the status because the ISO-week dedup keys off an 'ok' row and a
    // retry would double-send to every org that already succeeded.
    const status = result.completed ? 'ok' : 'error'
    const errSummary = result.errors.length > 0 ? result.errors.join('; ').slice(0, 500) : undefined
    logCronRun('weekly-digest', status, Date.now() - start, errSummary).catch(console.error)
    return c.json({ success: result.completed, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    logCronRun('weekly-digest', 'error', Date.now() - start, msg).catch(console.error)
    throw new ApiError('INTERNAL_ERROR', msg)
  }
})

// ── High-confidence savings recommendation alerts (daily) ────────
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
cronRouter.get('/replay-fallback', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

  const start = Date.now()
  try {
    const [requestsResult, eventsResult] = await Promise.all([
      replayFallbackQueue(),
      replayEventsFallbackQueue(),
    ])
    // Post-drain backlog check: if the queue is still four-figures after
    // replaying a batch, ClickHouse is likely down and rows are accumulating
    // toward the 7-day TTL — raise an operator alert (deduped, never throws).
    const backlog = await alertOnFallbackBacklog()
    const topErr = requestsResult.error ?? eventsResult.error
    const status = topErr ? 'error' : 'ok'
    logCronRun('replay-fallback', status, Date.now() - start, topErr).catch(console.error)
    return c.json({
      success: !topErr,
      requests: requestsResult,
      events: eventsResult,
      backlog,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    logCronRun('replay-fallback', 'error', Date.now() - start, msg).catch(console.error)
    throw new ApiError('INTERNAL_ERROR', msg)
  }
})

// ── Past-due downgrade check (daily, 10 UTC ≈ 19 KST) ───────────
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

// ── Soft-delete queue execution (every 6h) ──────────────────────
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

// ── Background migrations runner (every 5 minutes) ──────────────
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

// ── Events ↔ requests reconciliation (daily 02 UTC) ─────────────
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

// ── /detect-missing-model-prices — body in lib/cron-jobs ────────
cronRouter.get('/detect-missing-model-prices', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

  const start = Date.now()
  const result = await runDetectMissingModelPricesJob()
  // Match the legacy call shape: only pass `errorMessage` when there IS one
  // (test spies use `toHaveBeenCalledWith` which rejects an undefined 4th arg).
  const dur = Date.now() - start
  const p = result.ok
    ? logCronRun('detect-missing-model-prices', 'ok', dur)
    : logCronRun('detect-missing-model-prices', 'error', dur, result.error)
  await p.catch(() => undefined)
  return c.json(result, result.ok ? 200 : 500)
})

// ── /self-monitor — body in lib/cron-jobs/self-monitor.ts ───────
cronRouter.get('/self-monitor', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

  const start = Date.now()
  const result = await runSelfMonitorJob()
  const dur = Date.now() - start
  const p = result.ok
    ? logCronRun('self-monitor', 'ok', dur)
    : logCronRun('self-monitor', 'error', dur, result.error)
  p.catch(() => undefined)
  return c.json(result, result.ok ? 200 : 500)
})

// ── /detect-orphan-spans — body in lib/cron-jobs ────────────────
cronRouter.get('/detect-orphan-spans', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

  const start = Date.now()
  const result = await runDetectOrphanSpansJob()
  const dur = Date.now() - start
  const p = result.ok
    ? logCronRun('detect-orphan-spans', 'ok', dur)
    : logCronRun('detect-orphan-spans', 'error', dur, result.error)
  p.catch(() => undefined)
  return c.json(result, result.ok ? 200 : 500)
})

// ── /prune-judge-cache (P3-18) — TTL-delete stale judge_cache rows ─
cronRouter.get('/prune-judge-cache', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

  const start = Date.now()
  const result = await runPruneJudgeCacheJob()
  const dur = Date.now() - start
  const p = result.ok
    ? logCronRun('prune-judge-cache', 'ok', dur)
    : logCronRun('prune-judge-cache', 'error', dur, result.error)
  p.catch(() => undefined)
  return c.json(result, result.ok ? 200 : 500)
})

// ── /keep-warm — body in lib/cron-jobs/keep-warm.ts ─────────────
// No logCronRun: every-5-min cadence would flood cron_job_runs.
cronRouter.get('/keep-warm', async (c) => {
  assertCronAuth(c.req.header('Authorization'))
  const result = await runKeepWarmJob()
  return c.json(result)
})

// ── /purge-proxy-cache (daily 03:15 UTC) — reclaim expired opt-in
// proxy_response_cache rows. The opportunistic miss-path cleanup only
// reclaims rows for keys that are still being hit; keys that go quiet
// leave their expired rows behind, so this sweep collects the rest.
cronRouter.get('/purge-proxy-cache', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

  const start = Date.now()
  // purgeExpiredProxyCache is fail-open: it never throws and returns the
  // count deleted so far, so this handler always logs 'ok'.
  const deleted = await purgeExpiredProxyCache()
  logCronRun('purge-proxy-cache', 'ok', Date.now() - start).catch(console.error)
  return c.json({ deleted })
})
