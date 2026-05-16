#!/usr/bin/env tsx
/**
 * Smoke test for the lib functions that count/aggregate over `requests`:
 * - countMonthlyRequests (quota, paddle, quota-warnings)
 * - DISTINCT active orgs (anomaly-snapshot)
 * - max(created_at) per provider_key (stale-key-digest)
 *
 * Seeds three orgs with varying activity, checks each query returns the
 * expected shape against a live local ClickHouse, then cleans up.
 */
import { randomUUID } from 'node:crypto'
import { createClient } from '@clickhouse/client'

const client = createClient({
  url: process.env['CLICKHOUSE_URL'] ?? 'http://localhost:8123',
  username: process.env['CLICKHOUSE_USER'] ?? 'spanlens',
  password: process.env['CLICKHOUSE_PASSWORD'] ?? 'spanlens',
  database: process.env['CLICKHOUSE_DB'] ?? 'spanlens',
})

const orgA = randomUUID()
const orgB = randomUUID()
const orgC = randomUUID()
const keyA1 = randomUUID()
const keyA2 = randomUUID()
const allOrgs = [orgA, orgB, orgC]

function chTs(d: Date): string {
  return d.toISOString().replace('T', ' ').replace('Z', '')
}

async function seed(): Promise<void> {
  const values: Array<Record<string, unknown>> = []
  const now = Date.now()

  // orgA: 5 rows this month using keyA1, 2 rows last week using keyA2
  for (let i = 0; i < 5; i++) {
    values.push(row(orgA, keyA1, new Date(now - i * 3600_000)))
  }
  for (let i = 0; i < 2; i++) {
    values.push(row(orgA, keyA2, new Date(now - 7 * 86_400_000)))
  }

  // orgB: 3 rows in the past hour (active org)
  for (let i = 0; i < 3; i++) {
    values.push(row(orgB, null, new Date(now - i * 60_000)))
  }

  // orgC: nothing in the active window — only a 3-day-old row
  values.push(row(orgC, null, new Date(now - 3 * 86_400_000)))

  await client.insert({ table: 'requests', format: 'JSONEachRow', values })
}

function row(orgId: string, keyId: string | null, at: Date): Record<string, unknown> {
  return {
    id: randomUUID(),
    organization_id: orgId,
    project_id: randomUUID(),
    api_key_id: null,
    provider: 'openai',
    model: 'gpt-4o',
    prompt_tokens: 10, completion_tokens: 5, total_tokens: 15,
    cache_read_tokens: 0, cache_write_tokens: 0,
    cost_usd: '0.0001', latency_ms: 100, proxy_overhead_ms: null, status_code: 200,
    request_body: '', response_body: '',
    error_message: null,
    trace_id: null, span_id: null, prompt_version_id: null,
    provider_key_id: keyId,
    user_id: null, session_id: null,
    flags: '[]', response_flags: '[]', has_security_flags: false,
    created_at: chTs(at),
  }
}

async function check(label: string, actual: number, expected: number): Promise<void> {
  const ok = actual === expected
  console.log(`${ok ? '✓' : '✗'} ${label} — expected ${expected}, got ${actual}`)
  if (!ok) process.exit(1)
}

async function main(): Promise<void> {
  console.log(`▶ seeding (orgA=${orgA.slice(0,8)}, orgB=${orgB.slice(0,8)}, orgC=${orgC.slice(0,8)})`)
  await seed()

  // ── countMonthlyRequests pattern (quota.ts) ──────────────────────────────
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
  for (const [org, expected] of [[orgA, 7], [orgB, 3], [orgC, 1]] as const) {
    const result = await client.query({
      query:
        'SELECT count() AS n FROM requests ' +
        'WHERE organization_id = {orgId:UUID} ' +
        '  AND created_at >= parseDateTime64BestEffort({since:String})',
      query_params: { orgId: org, since: chTs(monthStart) },
      format: 'JSONEachRow',
    })
    const rows = (await result.json()) as Array<{ n: string }>
    await check(`countMonthlyRequests(${org.slice(0,8)})`, Number(rows[0]?.n), expected)
  }

  // ── Active orgs in past 24h (anomaly-snapshot.ts) ────────────────────────
  const since24h = chTs(new Date(Date.now() - 86_400_000))
  const activeResult = await client.query({
    query:
      'SELECT DISTINCT organization_id FROM requests ' +
      'WHERE created_at >= parseDateTime64BestEffort({since:String}) ' +
      '  AND organization_id IN {orgs:Array(UUID)}',
    query_params: { since: since24h, orgs: allOrgs },
    format: 'JSONEachRow',
  })
  const activeRows = (await activeResult.json()) as Array<{ organization_id: string }>
  await check('active orgs in last 24h', activeRows.length, 2) // orgA + orgB

  // ── max(created_at) per provider_key (stale-key-digest.ts) ──────────────
  const keyResult = await client.query({
    query:
      'SELECT provider_key_id AS id, max(created_at) AS last_used_at FROM requests ' +
      'WHERE organization_id = {orgId:UUID} ' +
      '  AND provider_key_id IN {keyIds:Array(UUID)} ' +
      'GROUP BY provider_key_id',
    query_params: { orgId: orgA, keyIds: [keyA1, keyA2] },
    format: 'JSONEachRow',
  })
  const keyRows = (await keyResult.json()) as Array<{ id: string; last_used_at: string }>
  await check('per-key max(created_at) groups', keyRows.length, 2)

  // Cleanup all seeded data
  for (const o of allOrgs) {
    await client.command({
      query: 'ALTER TABLE requests DELETE WHERE organization_id = {orgId:UUID}',
      query_params: { orgId: o },
    })
  }
  console.log('✓ cleanup queued for all 3 orgs')
  await client.close()
}

main().catch((err: unknown) => {
  console.error('✗ smoke test failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
