import { Hono } from 'hono'

/**
 * Health-check routes (R-22).
 *
 * Three-level surface:
 *
 *   /health        — liveness. Always 200 while the process is up. Vercel
 *                    polls this internally; do not add DB pings here or the
 *                    cold-start budget blows up. Now includes `version`
 *                    (Vercel commit SHA) so we can correlate dashboards with
 *                    the deployed build at a glance.
 *
 *   /health/ready  — readiness. Pings Postgres + ClickHouse + Upstash in
 *                    parallel. Returns 503 if any dependency is unreachable
 *                    so the load balancer / docker healthcheck can route
 *                    around a half-broken instance. Cheap enough to run on
 *                    every 30s docker healthcheck (no aggregate queries,
 *                    one round-trip per dep). Upstash is best-effort — when
 *                    KV_REST_API_URL is unset we report `skipped`, not a
 *                    failure (local dev / preview environments often run
 *                    without the KV store).
 *
 *   /health/deep   — components view + R-11 entry-trigger metrics. Adds the
 *                    `crons.max_runtime_ms` (24h MAX duration_ms from
 *                    cron_job_runs) and `webhooks.backlog_count`
 *                    (webhook_deliveries that missed their retry window)
 *                    fields so external monitoring (Better Stack,
 *                    UptimeRobot, our own dashboards) can page on slow cron
 *                    drift or webhook delivery failure spikes before they
 *                    show up as customer complaints. `concurrent_count` is
 *                    intentionally NOT here — cron_job_runs only INSERTs on
 *                    completion, so in-progress count requires either an
 *                    extra `cron_in_progress` table or Postgres advisory
 *                    locks. Tracked as R-22 follow-up; the 503 path doesn't
 *                    depend on it.
 *
 * Why split readiness from deep: readiness must be fast enough to run
 * every 30s on a tight container loop without melting Supabase. The deep
 * endpoint aggregates last-24h MAX(duration_ms) etc. which is fine to call
 * every 5 min but not every 30 sec.
 *
 * Extracted into its own router (instead of inlined in app.ts) so unit
 * tests can import just this surface without spinning up every API
 * router and its transitive dependencies.
 */
export const healthRouter = new Hono()

healthRouter.get('/health', (c) =>
  c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    // VERCEL_GIT_COMMIT_SHA is injected by Vercel on every deploy and is
    // null in local / docker-compose runs. Surface it directly so on-call
    // can confirm which commit a misbehaving instance is running without
    // diff-checking the Vercel dashboard.
    version: process.env['VERCEL_GIT_COMMIT_SHA'] ?? null,
  }),
)

healthRouter.get('/health/ready', async (c) => {
  const { supabaseAdmin } = await import('../lib/db.js')
  const { pingClickhouse } = await import('../lib/clickhouse.js')
  // Lazy import keeps the cold-start cheap when the Redis singleton hasn't
  // been touched yet. getRedis() falls through to null when env is missing,
  // which is the local-dev / preview-without-KV path — reported as
  // 'skipped', not failed, so the local healthcheck doesn't 503 spuriously.
  const { getRedis } = await import('../lib/prompt-cache.js')
  const redis = getRedis()

  const start = Date.now()
  const [pgResult, chResult, redisResult] = await Promise.allSettled([
    // Cheapest indexed read against an existing table — same pattern as
    // /cron/keep-warm step 1.
    supabaseAdmin.from('organizations').select('id', { count: 'exact', head: true }).limit(1),
    pingClickhouse(),
    redis ? redis.ping?.() ?? Promise.resolve('OK') : Promise.resolve('skipped'),
  ])
  const totalMs = Date.now() - start

  const pgOk = pgResult.status === 'fulfilled' && !pgResult.value.error
  // pingClickhouse swallows errors and resolves to false — same pitfall as
  // gotcha #14, fixed in R-Q6 keep-warm. Check the resolved value, not the
  // settled status.
  const chOk = chResult.status === 'fulfilled' && chResult.value === true

  let redisStatus: 'ok' | 'skipped' | 'fail'
  if (!redis) {
    redisStatus = 'skipped'
  } else if (redisResult.status === 'fulfilled') {
    redisStatus = 'ok'
  } else {
    redisStatus = 'fail'
  }

  // Redis is treated as best-effort: a missing KV store should not 503 the
  // readiness probe, but a configured-but-unreachable one should.
  const overallOk = pgOk && chOk && redisStatus !== 'fail'

  return c.json(
    {
      status: overallOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      latencyMs: totalMs,
      checks: {
        postgres: { ok: pgOk },
        clickhouse: { ok: chOk },
        redis: { status: redisStatus },
      },
    },
    overallOk ? 200 : 503,
  )
})

healthRouter.get('/health/deep', async (c) => {
  const { supabaseAdmin } = await import('../lib/db.js')
  const { pingClickhouse } = await import('../lib/clickhouse.js')
  const { fallbackQueueSize, eventsFallbackQueueSize } = await import(
    '../lib/fallback-replay.js'
  )

  const start = Date.now()
  // R-22 added two new aggregate queries here. Run them inside the same
  // Promise.all the ping/queue lookups already use — p95 stays bounded by
  // the slowest dependency, not the sum.
  const [chOk, fallbackQueue, eventsFallback, cronMaxRuntime, webhookBacklog] =
    await Promise.all([
      pingClickhouse().catch(() => false),
      fallbackQueueSize().catch(() => null),
      eventsFallbackQueueSize().catch(() => null),
      // crons.max_runtime_ms: MAX(duration_ms) over last 24h. R-11 trigger
      // — if any cron starts running 10s+ when it used to finish in 200ms
      // we want to know before the operator sees Vercel timeouts.
      supabaseAdmin
        .from('cron_job_runs')
        .select('duration_ms')
        .gte('ran_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('duration_ms', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(
          (res) => (res.error || !res.data ? null : (res.data.duration_ms as number)),
          () => null,
        ),
      // webhooks.backlog_count: deliveries that should have retried by now
      // but haven't. partial index from migration 20260515000000 covers
      // exactly (next_retry_at, status='failed') so the count is cheap.
      supabaseAdmin
        .from('webhook_deliveries')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'failed')
        .not('next_retry_at', 'is', null)
        .lt('next_retry_at', new Date().toISOString())
        .then(
          (res) => (res.error ? null : res.count ?? 0),
          () => null,
        ),
    ])
  const chLatency = Date.now() - start

  const overallOk = chOk
  return c.json(
    {
      status: overallOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      version: process.env['VERCEL_GIT_COMMIT_SHA'] ?? null,
      clickhouse: { ok: chOk, latencyMs: chLatency },
      // Null means the lookup itself failed (e.g. Supabase down) — not an
      // empty queue. Distinguish for triage.
      fallback: { queue: fallbackQueue, eventsQueue: eventsFallback },
      // R-22 R-11 entry-trigger metrics. Same null-on-failure convention.
      // `crons.max_runtime_ms` null = either no cron ran in 24h (cold env)
      // OR the Supabase query failed — both are actionable.
      crons: { max_runtime_ms: cronMaxRuntime },
      webhooks: { backlog_count: webhookBacklog },
    },
    overallOk ? 200 : 503,
  )
})
