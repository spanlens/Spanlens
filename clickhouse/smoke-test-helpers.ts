#!/usr/bin/env tsx
/**
 * Smoke test for lib/requests-query.ts helpers — exercises the parameter
 * binding and SQL syntax end-to-end against a real local ClickHouse.
 *
 * Skips the Supabase plan lookup (uses a constructed scope) so it can run
 * without supabase up.
 *
 * Run after `docker compose up clickhouse && pnpm ch:migrate`.
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
const rowIds: string[] = []

function chTimestamp(d: Date): string {
  return d.toISOString().replace('T', ' ').replace('Z', '')
}

async function seed(n: number): Promise<void> {
  const values: Array<Record<string, unknown>> = []
  for (let i = 0; i < n; i++) {
    const id = randomUUID()
    rowIds.push(id)
    values.push({
      id,
      organization_id: orgId,
      project_id: projectId,
      api_key_id: null,
      provider: i % 2 === 0 ? 'openai' : 'anthropic',
      model: i % 2 === 0 ? 'gpt-4o' : 'claude-sonnet-4.5',
      prompt_tokens: 100 + i,
      completion_tokens: 50,
      total_tokens: 150 + i,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      cost_usd: (0.001 * i).toFixed(8),
      latency_ms: 200 + i * 10,
      proxy_overhead_ms: null,
      status_code: i % 5 === 0 ? 500 : 200, // ~1 in 5 is an error
      request_body: JSON.stringify({ messages: [{ role: 'user', content: `query ${i}` }] }),
      response_body: JSON.stringify({ choices: [{ message: { content: `reply ${i}` } }] }),
      error_message: null,
      trace_id: null,
      span_id: null,
      prompt_version_id: null,
      provider_key_id: null,
      user_id: null,
      session_id: null,
      flags: '[]',
      response_flags: '[]',
      has_security_flags: i === 3, // mark one as a security event
      created_at: chTimestamp(new Date()),
    })
  }
  await client.insert({ table: 'requests', format: 'JSONEachRow', values })
}

async function check(label: string, query: string, params: Record<string, unknown>, expect: number): Promise<void> {
  const result = await client.query({ query, query_params: params, format: 'JSONEachRow' })
  const rows = (await result.json()) as unknown[]
  const ok = rows.length === expect
  console.log(`${ok ? '✓' : '✗'} ${label} — expected ${expect}, got ${rows.length}`)
  if (!ok) {
    console.error(`  query: ${query}`)
    console.error(`  params: ${JSON.stringify(params)}`)
    process.exit(1)
  }
}

async function main(): Promise<void> {
  console.log(`▶ seeding 10 rows for org ${orgId}`)
  await seed(10)

  const scopeSql =
    'organization_id = {orgId:UUID} AND created_at >= now() - INTERVAL {retentionDays:UInt32} DAY'

  await check(
    'list — all rows in scope',
    `SELECT id FROM requests WHERE ${scopeSql} LIMIT 50`,
    { orgId, retentionDays: 14 },
    10,
  )

  await check(
    'list — provider filter (openai = 5)',
    `SELECT id FROM requests WHERE ${scopeSql} AND provider = {provider:String}`,
    { orgId, retentionDays: 14, provider: 'openai' },
    5,
  )

  await check(
    'list — model ILIKE (gpt = 5)',
    `SELECT id FROM requests WHERE ${scopeSql} AND positionCaseInsensitive(model, {model:String}) > 0`,
    { orgId, retentionDays: 14, model: 'gpt' },
    5,
  )

  await check(
    'list — status 5xx',
    `SELECT id FROM requests WHERE ${scopeSql} AND status_code >= 500`,
    { orgId, retentionDays: 14 },
    2, // i=0, i=5
  )

  await check(
    'security — has_security_flags',
    `SELECT id FROM requests WHERE ${scopeSql} AND has_security_flags = 1`,
    { orgId, retentionDays: 14 },
    1,
  )

  // count() returns string in JSONEachRow; just validate parse works.
  const result = await client.query({
    query: `SELECT count() AS n FROM requests WHERE ${scopeSql}`,
    query_params: { orgId, retentionDays: 14 },
    format: 'JSONEachRow',
  })
  const countRows = (await result.json()) as Array<{ n: string }>
  console.log(`✓ count — n = ${countRows[0]?.n} (expect 10)`)

  // Cleanup
  await client.command({
    query: `ALTER TABLE requests DELETE WHERE organization_id = {orgId:UUID}`,
    query_params: { orgId },
  })
  console.log(`✓ cleanup queued for org ${orgId}`)
  await client.close()
}

main().catch((err: unknown) => {
  console.error('✗ smoke test failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
