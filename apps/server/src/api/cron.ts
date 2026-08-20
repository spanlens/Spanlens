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
import { runLeakDetectionJob } from '../lib/leak-detection.js'
import { sendHighConfidenceRecommendationAlerts } from '../lib/recommendation-notify.js'
import { logCronRun } from '../lib/cron-logger.js'
// Cadence guard for the four crons that aggregate `requests`. Three schedulers
// fire every endpoint (gotcha #32), and for these four each extra firing
// repeats a full scan of the log. See lib/cron-cadence.ts.
import {
  ranSuccessfullyWithin,
  cadenceSkipResponse,
  SCAN_CRON_MIN_INTERVAL_MINUTES,
} from '../lib/cron-cadence.js'
import { maintainRequestPartitions } from '../lib/cron-jobs/maintain-request-partitions.js'
import { purgeExpiredProxyCache } from '../lib/proxy-cache.js'
import { replayFallbackQueue, alertOnFallbackBacklog } from '../lib/fallback-replay.js'
import { runDowngradeCheck } from '../lib/billing-downgrade.js'
import { executePendingDeletions } from './pendingDeletions.js'
// Inline cron job bodies were extracted to lib/cron-jobs/ in the 2026-06-12
// tech-debt pass. The 6 jobs below carried non-trivial logic (aggregate
// queries, multi-phase delivery, batched DB writes); the remaining 13 were
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
 *
 * Logging convention: every handler MUST `await logCronRun(...)` before
 * returning. A naked fire-and-forget (`logCronRun(...).catch(...)`) is
 * dropped by Vercel once the response returns (CLAUDE.md gotcha #8), which
 * silently loses the `cron_job_runs` row and makes the cron-health
 * monitoring (gotcha #32) misread "cron never fired". Cron endpoints are
 * scheduler-invoked and not latency-sensitive, so awaiting the single
 * INSERT is free; `logCronRun` never throws, so awaiting cannot flip a
 * successful run into a 500.
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

  // `?force=1` re-runs the rollup even when the debounce or the activity
  // watermark would skip it — the operator path for rebuilding usage_daily
  // after rows are edited by hand.
  const force = c.req.query('force') === '1'

  if (!force && (await ranSuccessfullyWithin('aggregate-usage', SCAN_CRON_MIN_INTERVAL_MINUTES))) {
    return c.json(cadenceSkipResponse('aggregate-usage', SCAN_CRON_MIN_INTERVAL_MINUTES))
  }

  const start = Date.now()
  const result = await runAggregateUsageJob({ force })
  const errorMsg = result.success ? undefined : result.results.find((r) => r.error)?.error
  await logCronRun('aggregate-usage', result.success ? 'ok' : 'error', Date.now() - start, errorMsg)
  return c.json(result)
})

// ── /evaluate-alerts — body in lib/cron-jobs/evaluate-alerts.ts ──
// Runs at the full every-15-minutes cadence and is deliberately NOT
// debounced. The job checks the activity watermark before it scans
// `requests`, so a quiet window costs one indexed lookup and there is nothing
// worth throttling. When there IS traffic the alerts should fire promptly,
// which is the whole point of the 15-minute cadence.
cronRouter.get('/evaluate-alerts', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

  const start = Date.now()
  const result = await runEvaluateAlertsJob()
  // A run where a metric could not be computed is not a success. Budget
  // alerts gate their scan on "anything new since the last successful run"
  // (lib/cron-jobs/evaluate-alerts.ts gateStartFor), so
  // stamping a partial run as ok would move that gate past alerts this run
  // never actually evaluated, silencing them until new traffic arrived.
  const failed = result.metric_errors > 0
  await logCronRun(
    'evaluate-alerts',
    failed ? 'error' : 'ok',
    Date.now() - start,
    failed ? `${result.metric_errors} metric(s) failed to compute` : undefined,
  )
  return c.json({ ...result, success: !failed })
})

// ── Paddle usage overage reporting (daily) ──────────────────────
cronRouter.get('/report-usage-overage', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

  const start = Date.now()
  try {
    const reports = await computeAndReportOverages()
    await logCronRun('report-usage-overage', 'ok', Date.now() - start)
    return c.json({ success: true, count: reports.length, reports })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    await logCronRun('report-usage-overage', 'error', Date.now() - start, msg)
    throw new ApiError('INTERNAL_ERROR', msg)
  }
})

// ── Quota warnings (hourly) ─────────────────────────────────────
cronRouter.get('/check-quota-warnings', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

  if (await ranSuccessfullyWithin('check-quota-warnings', SCAN_CRON_MIN_INTERVAL_MINUTES)) {
    return c.json(cadenceSkipResponse('check-quota-warnings', SCAN_CRON_MIN_INTERVAL_MINUTES))
  }

  const start = Date.now()
  try {
    const result = await runQuotaWarningsJob()
    // A run that could not count every org is NOT a success. The job gates
    // its counting on "anything new since the last successful run"
    // (lib/quota-warnings.ts), so recording a partial run as ok would move
    // that gate past orgs it never actually checked, and one transient
    // failure could park an org just under its cap until its next request.
    // Logging the error keeps the gate where it was and re-checks everyone.
    const failed = result.errors > 0
    await logCronRun(
      'check-quota-warnings',
      failed ? 'error' : 'ok',
      Date.now() - start,
      failed ? `${result.errors} org(s) failed to check` : undefined,
    )
    return c.json({ success: !failed, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    await logCronRun('check-quota-warnings', 'error', Date.now() - start, msg)
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
    await logCronRun('snapshot-anomalies', 'ok', Date.now() - start)
    return c.json({ success: true, orgs: results.length, anomalies: total, errors: errored, results })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    await logCronRun('snapshot-anomalies', 'error', Date.now() - start, msg)
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
    await logCronRun('prune-logs', 'error', Date.now() - start, logsResult.error.message)
    throw new ApiError('INTERNAL_ERROR', logsResult.error.message)
  }

  await logCronRun('prune-logs', 'ok', Date.now() - start)
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
    await logCronRun('stale-key-reminders', 'ok', Date.now() - start)
    return c.json({ success: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    await logCronRun('stale-key-reminders', 'error', Date.now() - start, msg)
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
    await logCronRun('detect-data-silence', status, Date.now() - start, errSummary)
    return c.json({ success: result.errors.length === 0, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    await logCronRun('detect-data-silence', 'error', Date.now() - start, msg)
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
    await logCronRun('weekly-digest', status, Date.now() - start, errSummary)
    return c.json({ success: result.completed, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    await logCronRun('weekly-digest', 'error', Date.now() - start, msg)
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
    await logCronRun('recommend-savings-alerts', 'ok', Date.now() - start)
    return c.json({ success: true, orgs: results.length, sent: totalSent, skipped: totalSkipped, errors: totalErrors, results })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    await logCronRun('recommend-savings-alerts', 'error', Date.now() - start, msg)
    throw new ApiError('INTERNAL_ERROR', msg)
  }
})

// ── Webhook retry (every 5 minutes when scheduled) ─────────────
// INTENTIONALLY UNSCHEDULED as of 2026-07-22: no scheduler (vercel.json,
// cron-server.yml, or Better Stack) fires this, and cron_job_runs shows
// zero executions. Safe because the outbound-webhooks feature has zero
// production usage (0 configured, 0 deliveries). When webhooks ship to
// customers, add a `*/5 * * * *` job for /cron/retry-webhooks to
// .github/workflows/cron-server.yml (and/or Better Stack) so failed
// deliveries actually retry — otherwise a failed delivery never retries.
cronRouter.get('/retry-webhooks', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

  const start = Date.now()
  try {
    const result = await retryFailedWebhooks()
    await logCronRun('retry-webhooks', 'ok', Date.now() - start)
    return c.json({ success: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    await logCronRun('retry-webhooks', 'error', Date.now() - start, msg)
    throw new ApiError('INTERNAL_ERROR', msg)
  }
})

// ── Provider key leak detection (daily) ─────────────────────────
cronRouter.get('/leak-detect-keys', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

  const start = Date.now()
  try {
    const result = await runLeakDetectionJob()
    await logCronRun('leak-detect-keys', 'ok', Date.now() - start)
    return c.json({ success: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    await logCronRun('leak-detect-keys', 'error', Date.now() - start, msg)
    throw new ApiError('INTERNAL_ERROR', msg)
  }
})

// ── Request-log fallback replay (every 5 minutes) ───────────────
cronRouter.get('/replay-fallback', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

  const start = Date.now()
  try {
    const requestsResult = await replayFallbackQueue()
    // Post-drain backlog check: if the queue is still four-figures after
    // replaying a batch, the `requests` INSERT keeps failing and queued rows
    // are heading for the 7-day expiry — raise an operator alert (deduped,
    // never throws).
    const backlog = await alertOnFallbackBacklog()
    const topErr = requestsResult.error
    const status = topErr ? 'error' : 'ok'
    await logCronRun('replay-fallback', status, Date.now() - start, topErr)
    return c.json({
      success: !topErr,
      requests: requestsResult,
      backlog,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    await logCronRun('replay-fallback', 'error', Date.now() - start, msg)
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
    await logCronRun('check-past-due-downgrades', status, Date.now() - start, errSummary)
    return c.json({ success: result.errors.length === 0, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    await logCronRun('check-past-due-downgrades', 'error', Date.now() - start, msg)
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
// ── /detect-missing-model-prices — body in lib/cron-jobs ────────
cronRouter.get('/detect-missing-model-prices', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

  if (await ranSuccessfullyWithin('detect-missing-model-prices', SCAN_CRON_MIN_INTERVAL_MINUTES)) {
    return c.json(cadenceSkipResponse('detect-missing-model-prices', SCAN_CRON_MIN_INTERVAL_MINUTES))
  }

  const start = Date.now()
  const result = await runDetectMissingModelPricesJob()
  // Match the legacy call shape: only pass `errorMessage` when there IS one
  // (test spies use `toHaveBeenCalledWith` which rejects an undefined 4th arg).
  const dur = Date.now() - start
  await (result.ok
    ? logCronRun('detect-missing-model-prices', 'ok', dur)
    : logCronRun('detect-missing-model-prices', 'error', dur, result.error))
  return c.json(result, result.ok ? 200 : 500)
})

// ── /self-monitor — body in lib/cron-jobs/self-monitor.ts ───────
cronRouter.get('/self-monitor', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

  const start = Date.now()
  const result = await runSelfMonitorJob()
  const dur = Date.now() - start
  await (result.ok
    ? logCronRun('self-monitor', 'ok', dur)
    : logCronRun('self-monitor', 'error', dur, result.error))
  return c.json(result, result.ok ? 200 : 500)
})

// ── /detect-orphan-spans — body in lib/cron-jobs ────────────────
cronRouter.get('/detect-orphan-spans', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

  const start = Date.now()
  const result = await runDetectOrphanSpansJob()
  const dur = Date.now() - start
  await (result.ok
    ? logCronRun('detect-orphan-spans', 'ok', dur)
    : logCronRun('detect-orphan-spans', 'error', dur, result.error))
  return c.json(result, result.ok ? 200 : 500)
})

// ── /prune-judge-cache (P3-18) — TTL-delete stale judge_cache rows ─
cronRouter.get('/prune-judge-cache', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

  const start = Date.now()
  const result = await runPruneJudgeCacheJob()
  const dur = Date.now() - start
  await (result.ok
    ? logCronRun('prune-judge-cache', 'ok', dur)
    : logCronRun('prune-judge-cache', 'error', dur, result.error))
  return c.json(result, result.ok ? 200 : 500)
})

// ── /keep-warm — body in lib/cron-jobs/keep-warm.ts ─────────────
// No logCronRun: every-5-min cadence would flood cron_job_runs.
cronRouter.get('/keep-warm', async (c) => {
  assertCronAuth(c.req.header('Authorization'))
  const result = await runKeepWarmJob()
  return c.json(result)
})

// ── /maintain-request-partitions (daily 03:20 UTC) ──────────────────
// Creates the next few months of `requests` partitions and drops the ones
// past retention. Daily rather than monthly on purpose: the work is a no-op
// on all but a couple of days a month, and a monthly schedule would mean one
// missed firing (gotcha #32) puts rows in the catch-all partition, which then
// blocks creating the real one behind an exclusive lock.
cronRouter.get('/maintain-request-partitions', async (c) => {
  assertCronAuth(c.req.header('Authorization'))

  const start = Date.now()
  const result = await maintainRequestPartitions()
  // Creation failing is the serious half: next month's rows have nowhere to
  // go. A failed drop only means old data lingers, so it does not mark the
  // run as failed and page anyone.
  const status = result.createError ? 'error' : 'ok'
  await logCronRun('maintain-request-partitions', status, Date.now() - start, result.createError)
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
  await logCronRun('purge-proxy-cache', 'ok', Date.now() - start)
  return c.json({ deleted })
})
