#!/usr/bin/env tsx
/**
 * Smoke test for the logBody opt-out — verifies that the three SDK modes
 * (full/meta/none) produce the row shape we expect against a real ClickHouse.
 *
 * Inserts three rows that mirror what logger.ts produces, then reads each
 * back and asserts the body/identifier columns are populated or cleared
 * according to the mode.
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

function chTs(): string {
  return new Date().toISOString().replace('T', ' ').replace('Z', '')
}

function row(mode: 'full' | 'meta' | 'none', id: string): Record<string, unknown> {
  // Mirror what logger.ts would write under each mode.
  const fullBody = JSON.stringify({ messages: [{ role: 'user', content: 'sensitive' }] })
  const storeBody = mode === 'full'
  const dropIdent = mode === 'none'
  return {
    id,
    organization_id: orgId,
    project_id: randomUUID(),
    api_key_id: null,
    provider: 'openai',
    model: 'gpt-4o',
    prompt_tokens: 10, completion_tokens: 5, total_tokens: 15,
    cache_read_tokens: 0, cache_write_tokens: 0,
    cost_usd: '0.0010',
    latency_ms: 100,
    proxy_overhead_ms: 10,
    status_code: 200,
    request_body:  storeBody ? fullBody : '',
    response_body: storeBody ? '{"ok":true}' : '',
    error_message: null,
    trace_id: null, span_id: null, prompt_version_id: null,
    provider_key_id: null,
    user_id:    dropIdent ? null : 'user-fixed',
    session_id: dropIdent ? null : 'sess-fixed',
    flags: '[]', response_flags: '[]', has_security_flags: false,
    created_at: chTs(),
  }
}

async function check(label: string, cond: boolean, extra: string = ''): Promise<void> {
  console.log(`${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`)
  if (!cond) process.exit(1)
}

async function main(): Promise<void> {
  const ids = { full: randomUUID(), meta: randomUUID(), none: randomUUID() }
  console.log(`▶ inserting one row per logBody mode for org ${orgId.slice(0, 8)}`)
  await client.insert({
    table: 'requests',
    format: 'JSONEachRow',
    values: [row('full', ids.full), row('meta', ids.meta), row('none', ids.none)],
  })

  const result = await client.query({
    query: `
      SELECT id, request_body, response_body, user_id, session_id, total_tokens
      FROM requests
      WHERE organization_id = {orgId:UUID}
      ORDER BY id`,
    query_params: { orgId },
    format: 'JSONEachRow',
  })
  const rows = (await result.json()) as Array<Record<string, unknown>>
  const byId = new Map(rows.map((r) => [r['id'] as string, r]))

  const fullRow = byId.get(ids.full)
  const metaRow = byId.get(ids.meta)
  const noneRow = byId.get(ids.none)

  // full: bodies stored, identifiers preserved
  await check('full row has non-empty request_body',
    typeof fullRow?.['request_body'] === 'string' && (fullRow['request_body'] as string).length > 0)
  await check('full row keeps user_id', fullRow?.['user_id'] === 'user-fixed')

  // meta: bodies empty, identifiers preserved
  await check('meta row request_body is empty', metaRow?.['request_body'] === '')
  await check('meta row response_body is empty', metaRow?.['response_body'] === '')
  await check('meta row keeps user_id', metaRow?.['user_id'] === 'user-fixed')
  await check('meta row keeps session_id', metaRow?.['session_id'] === 'sess-fixed')

  // none: bodies empty AND identifiers null
  await check('none row request_body is empty', noneRow?.['request_body'] === '')
  await check('none row response_body is empty', noneRow?.['response_body'] === '')
  await check('none row user_id is null', noneRow?.['user_id'] === null)
  await check('none row session_id is null', noneRow?.['session_id'] === null)

  // tokens/metadata flow through in every mode
  await check('all rows keep token metadata',
    [fullRow, metaRow, noneRow].every((r) => Number(r?.['total_tokens']) === 15))

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
