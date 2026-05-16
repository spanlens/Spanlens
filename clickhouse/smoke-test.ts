#!/usr/bin/env tsx
/**
 * End-to-end smoke test: insert a row via @clickhouse/client and read it back.
 * Confirms the schema accepts the payload shape logger.ts produces.
 *
 * Run after `docker compose up clickhouse && pnpm ch:migrate`:
 *   pnpm --filter server exec tsx ../../clickhouse/smoke-test.ts
 */
import { randomUUID } from 'node:crypto'
import { createClient } from '@clickhouse/client'

const client = createClient({
  url: process.env['CLICKHOUSE_URL'] ?? 'http://localhost:8123',
  username: process.env['CLICKHOUSE_USER'] ?? 'spanlens',
  password: process.env['CLICKHOUSE_PASSWORD'] ?? 'spanlens',
  database: process.env['CLICKHOUSE_DB'] ?? 'spanlens',
})

const id = randomUUID()
const orgId = randomUUID()
const projectId = randomUUID()

async function main(): Promise<void> {
  console.log(`▶ inserting test row id=${id}`)
  await client.insert({
    table: 'requests',
    format: 'JSONEachRow',
    values: [
      {
        id,
        organization_id: orgId,
        project_id: projectId,
        api_key_id: null,
        provider: 'openai',
        model: 'gpt-4o',
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        cost_usd: '0.00015',
        latency_ms: 123,
        proxy_overhead_ms: null,
        status_code: 200,
        request_body: JSON.stringify({ msg: 'sk-***' }),
        response_body: JSON.stringify({ choices: [] }),
        error_message: null,
        trace_id: null,
        span_id: null,
        prompt_version_id: null,
        provider_key_id: null,
        user_id: null,
        session_id: null,
        flags: '[]',
        response_flags: '[]',
        has_security_flags: false,
        created_at: new Date().toISOString().replace('T', ' ').replace('Z', ''),
      },
    ],
  })
  console.log('✓ insert ok')

  const result = await client.query({
    query: `SELECT id, organization_id, provider, model, total_tokens, request_body
              FROM requests WHERE id = {id:UUID}`,
    query_params: { id },
    format: 'JSONEachRow',
  })
  const rows = (await result.json()) as Array<Record<string, unknown>>
  console.log(`✓ read back: ${rows.length} row(s)`)
  if (rows.length !== 1) throw new Error(`expected 1 row, got ${rows.length}`)
  console.log(JSON.stringify(rows[0], null, 2))

  // Clean up so smoke test is idempotent.
  await client.command({
    query: `ALTER TABLE requests DELETE WHERE id = {id:UUID}`,
    query_params: { id },
  })
  console.log('✓ cleanup queued')
  await client.close()
}

main().catch((err: unknown) => {
  console.error('✗ smoke test failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
