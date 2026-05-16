#!/usr/bin/env tsx
/**
 * Smoke test for the SQL rewrites of the 4 Postgres RPCs:
 *   stats_overview, stats_models, stats_timeseries, detect_anomaly_stats
 *
 * Seeds a known dataset and asserts the queries return the expected
 * aggregates (and that detect_anomaly_stats produces meaningful sigma
 * deviations when the observation window diverges from the reference).
 */
import { randomUUID } from 'node:crypto'
import { createClient } from '@clickhouse/client'

const client = createClient({
  url: process.env['CLICKHOUSE_URL'] ?? 'http://localhost:8123',
  username: process.env['CLICKHOUSE_USER'] ?? 'spanlens',
  password: process.env['CLICKHOUSE_PASSWORD'] ?? 'spanlens',
  database: process.env['CLICKHOUSE_DB'] ?? 'spanlens',
})

const orgId = randomUUID()
const projectId = randomUUID()

function chTs(d: Date): string {
  return d.toISOString().replace('T', ' ').replace('Z', '')
}

function row(at: Date, opts: { model?: string; latency?: number; cost?: string; status?: number; provider?: string } = {}): Record<string, unknown> {
  return {
    id: randomUUID(),
    organization_id: orgId,
    project_id: projectId,
    api_key_id: null,
    provider: opts.provider ?? 'openai',
    model: opts.model ?? 'gpt-4o',
    prompt_tokens: 100, completion_tokens: 50, total_tokens: 150,
    cache_read_tokens: 0, cache_write_tokens: 0,
    cost_usd: opts.cost ?? '0.0010',
    latency_ms: opts.latency ?? 200,
    proxy_overhead_ms: 20,
    status_code: opts.status ?? 200,
    request_body: '', response_body: '',
    error_message: null,
    trace_id: null, span_id: null, prompt_version_id: null,
    provider_key_id: null,
    user_id: null, session_id: null,
    flags: '[]', response_flags: '[]', has_security_flags: false,
    created_at: chTs(at),
  }
}

async function seed(): Promise<void> {
  const now = Date.now()
  const values: Array<Record<string, unknown>> = []
  // Reference window (older): 100 rows over the past 24h-2h, gpt-4o ~200ms ~$0.001
  for (let i = 0; i < 100; i++) {
    const at = new Date(now - (2 + i * 0.2) * 3_600_000)
    values.push(row(at, { latency: 200 + (i % 20), status: i % 10 === 0 ? 500 : 200 }))
  }
  // Observation window (last 1h): 50 rows with elevated latency to create an anomaly
  for (let i = 0; i < 50; i++) {
    const at = new Date(now - 0.5 * 3_600_000 + i * 1000)
    values.push(row(at, { latency: 1500, cost: '0.0050' }))
  }
  // Add some claude-sonnet rows for the models test
  for (let i = 0; i < 30; i++) {
    const at = new Date(now - i * 3_600_000)
    values.push(row(at, { provider: 'anthropic', model: 'claude-sonnet-4.5', cost: '0.0030' }))
  }
  await client.insert({ table: 'requests', format: 'JSONEachRow', values })
}

async function check(label: string, cond: boolean, extra: string = ''): Promise<void> {
  console.log(`${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`)
  if (!cond) process.exit(1)
}

async function main(): Promise<void> {
  console.log(`▶ seeding 180 rows for org ${orgId.slice(0, 8)}`)
  await seed()

  // ── stats_overview ────────────────────────────────────────────────────────
  const overviewResult = await client.query({
    query: `
      SELECT
        count() AS total_requests,
        countIf(status_code < 400) AS success_requests,
        countIf(status_code >= 400) AS error_requests,
        sum(cost_usd) AS total_cost_usd,
        sum(total_tokens) AS total_tokens,
        avg(latency_ms) AS avg_latency_ms
      FROM requests
      WHERE organization_id = {orgId:UUID}
        AND created_at >= now() - INTERVAL 30 DAY`,
    query_params: { orgId },
    format: 'JSONEachRow',
  })
  const ovr = ((await overviewResult.json()) as Array<Record<string, string | number>>)[0]
  await check('stats_overview total_requests = 180', Number(ovr?.['total_requests']) === 180)
  await check('stats_overview total_tokens = 27000', Number(ovr?.['total_tokens']) === 180 * 150)
  await check('stats_overview has errors', Number(ovr?.['error_requests']) > 0)

  // ── stats_models ──────────────────────────────────────────────────────────
  const modelsResult = await client.query({
    query: `
      SELECT provider, model, count() AS requests, sum(cost_usd) AS total_cost_usd
      FROM requests
      WHERE organization_id = {orgId:UUID}
        AND created_at >= now() - INTERVAL 30 DAY
      GROUP BY provider, model
      ORDER BY total_cost_usd DESC`,
    query_params: { orgId },
    format: 'JSONEachRow',
  })
  const models = (await modelsResult.json()) as Array<{ provider: string; model: string; requests: string }>
  await check('stats_models returns both providers', models.length === 2)
  await check('stats_models gpt-4o has 150 rows',
    models.some((m) => m.model === 'gpt-4o' && Number(m.requests) === 150))

  // ── stats_timeseries (day granularity) ───────────────────────────────────
  const tsResult = await client.query({
    query: `
      SELECT toStartOfDay(created_at) AS day, count() AS requests
      FROM requests
      WHERE organization_id = {orgId:UUID}
        AND created_at >= now() - INTERVAL 30 DAY
      GROUP BY day
      ORDER BY day ASC`,
    query_params: { orgId },
    format: 'JSONEachRow',
  })
  const ts = (await tsResult.json()) as Array<{ day: string; requests: string }>
  await check('stats_timeseries (day) returns at least 1 bucket', ts.length >= 1)
  const totalReq = ts.reduce((s, t) => s + Number(t.requests), 0)
  await check('stats_timeseries buckets sum to 180', totalReq === 180)

  // ── detect_anomaly_stats — latency spike should produce high sigma ─────
  const obsStart = chTs(new Date(Date.now() - 1 * 3_600_000))
  const refStart = chTs(new Date(Date.now() - 24 * 3_600_000))
  const anomResult = await client.query({
    query: `
      SELECT
        provider, model,
        avgIf(latency_ms,        created_at >= parseDateTime64BestEffort({obsStart:String}) AND status_code < 400) AS obs_lat,
        avgIf(latency_ms,        created_at <  parseDateTime64BestEffort({obsStart:String}) AND status_code < 400) AS ref_lat,
        stddevSampIf(latency_ms, created_at <  parseDateTime64BestEffort({obsStart:String}) AND status_code < 400) AS ref_stddev,
        countIf(                  created_at <  parseDateTime64BestEffort({obsStart:String}) AND status_code < 400) AS ref_count
      FROM requests
      WHERE organization_id = {orgId:UUID}
        AND created_at >= parseDateTime64BestEffort({refStart:String})
      GROUP BY provider, model
      HAVING ref_count > 0 AND obs_lat IS NOT NULL`,
    query_params: { orgId, obsStart, refStart },
    format: 'JSONEachRow',
  })
  const anomRows = (await anomResult.json()) as Array<Record<string, string | number | null>>
  const gptRow = anomRows.find((r) => r['model'] === 'gpt-4o')
  await check('gpt-4o has obs and ref data', !!gptRow)
  const obsLat = Number(gptRow?.['obs_lat'])
  const refLat = Number(gptRow?.['ref_lat'])
  const refStd = Number(gptRow?.['ref_stddev'])
  const deviations = (obsLat - refLat) / refStd
  await check(`gpt-4o latency spike sigma = ${deviations.toFixed(2)}σ`, deviations > 3,
    `obs=${obsLat.toFixed(0)}ms ref=${refLat.toFixed(0)}ms σ=${refStd.toFixed(1)}`)

  // ── quantile() for latency endpoint ──────────────────────────────────────
  const qResult = await client.query({
    query: `
      SELECT
        quantileIf(0.50)(latency_ms, latency_ms > 0) AS p50,
        quantileIf(0.95)(latency_ms, latency_ms > 0) AS p95,
        quantileIf(0.99)(latency_ms, latency_ms > 0) AS p99
      FROM requests
      WHERE organization_id = {orgId:UUID}
        AND created_at >= now() - INTERVAL 24 HOUR`,
    query_params: { orgId },
    format: 'JSONEachRow',
  })
  const q = ((await qResult.json()) as Array<Record<string, string | number>>)[0]
  const p50 = Number(q?.['p50'])
  const p95 = Number(q?.['p95'])
  const p99 = Number(q?.['p99'])
  await check(`quantiles: p50=${p50.toFixed(0)} p95=${p95.toFixed(0)} p99=${p99.toFixed(0)}`,
    p50 > 0 && p95 >= p50 && p99 >= p95)

  // Cleanup
  await client.command({
    query: 'ALTER TABLE requests DELETE WHERE organization_id = {orgId:UUID}',
    query_params: { orgId },
  })
  console.log('✓ cleanup queued')
  await client.close()
}

main().catch((err: unknown) => {
  console.error('✗ smoke test failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
