import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '../../lib/db.js'
import { pgExecute } from '../../lib/postgres.js'

export interface InsertRequestsArgs {
  orgId: string
  projectId: string
  apiKeyId: string
  provider?: string
  model?: string
  count: number
  latencyMs: number
  costUsd?: number | null
  statusCode?: number
  /** How many milliseconds before now to set created_at. */
  createdAtMsAgo: number
}

/**
 * Seed the `requests` table for integration tests.
 *
 * The row shape mirrors what logger.ts writes: body columns default to empty
 * strings and the flag columns to an empty array, so a synthetic row is still
 * a valid one. Values are bound, never interpolated, for the same reason the
 * production insert binds them.
 *
 * The column list is the full one from `REQUEST_COLUMNS`, including the three
 * a fixture never varies (`truncated`, `cache_hit`, `service_tier`). Leaning
 * on their defaults would work today and stop working the moment one of them
 * loses its default, and a fixture that writes a different row than production
 * does is worth less than one that writes the same row.
 */
export async function insertRequests(args: InsertRequestsArgs): Promise<void> {
  const createdAt = new Date(Date.now() - args.createdAtMsAgo).toISOString()
  const rows = Array.from({ length: args.count }, () => ({
    id: randomUUID(),
    organization_id: args.orgId,
    project_id: args.projectId,
    api_key_id: args.apiKeyId,
    provider: args.provider ?? 'openai',
    model: args.model ?? 'gpt-4o-mini',
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 150,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost_usd: args.costUsd == null ? null : args.costUsd.toFixed(8),
    latency_ms: args.latencyMs,
    proxy_overhead_ms: null,
    status_code: args.statusCode ?? 200,
    request_body: '',
    response_body: '',
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
    truncated: false,
    cache_hit: false,
    service_tier: '',
    created_at: createdAt,
  }))

  const columns = Object.keys(rows[0]!)
  const jsonb = new Set(['flags', 'response_flags'])
  const values: string[] = []
  const params: Record<string, unknown> = {}
  rows.forEach((row, i) => {
    const placeholders = columns.map((col) => {
      const name = `v${i}_${col}`
      params[name] = (row as Record<string, unknown>)[col]
      return jsonb.has(col) ? `{${name}}::jsonb` : `{${name}}`
    })
    values.push(`(${placeholders.join(', ')})`)
  })

  await pgExecute({
    query: `INSERT INTO requests (${columns.join(', ')}) VALUES ${values.join(', ')}`,
    params,
  })

  // Logging a request writes two things, not one: the row, and the org's
  // activity watermark. The cron jobs that scan this table check the
  // watermark first and skip the scan entirely when an org has nothing new,
  // so a fixture that seeded only rows would leave those jobs correctly
  // deciding there was no work to do, and the test would be asserting
  // against a code path it never reached.
  //
  // The watermark carries the newest row's timestamp, matching what the
  // logger records, so a fixture that backdates rows stays invisible to a
  // 24-hour scan exactly as real old traffic would.
  await pgExecute({
    query: `
      INSERT INTO org_activity (organization_id, last_request_at, updated_at)
      VALUES ({orgId}, {lastRequestAt}, now())
      ON CONFLICT (organization_id) DO UPDATE
        SET last_request_at = GREATEST(org_activity.last_request_at, EXCLUDED.last_request_at),
            updated_at      = now()
    `,
    params: { orgId: args.orgId, lastRequestAt: createdAt },
  })
}

export async function cleanupRequests(orgId: string): Promise<void> {
  await pgExecute({
    query: 'DELETE FROM requests WHERE organization_id = {orgId}',
    params: { orgId },
  })
  // The watermark has to go too. Leaving it behind would let the next test
  // in the file look like it had recent traffic before inserting anything,
  // which is the difference between a test that passes and a test that
  // means something.
  await pgExecute({
    query: 'DELETE FROM org_activity WHERE organization_id = {orgId}',
    params: { orgId },
  })
}

export async function cleanupAnomalyEvents(orgId: string): Promise<void> {
  await supabaseAdmin.from('anomaly_events').delete().eq('organization_id', orgId)
}
