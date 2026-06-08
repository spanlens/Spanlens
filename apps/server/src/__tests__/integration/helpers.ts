import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '../../lib/db.js'
import { unscopedClickhouse } from '../../lib/clickhouse.js'

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
 * Seed the `requests` ClickHouse table for integration tests. After the
 * ClickHouse migration the table lives there, not in Supabase. The shape
 * mirrors what logger.ts writes — body columns default to empty strings
 * and flags columns to '[]' so the row is valid even for synthetic tests.
 */
export async function insertRequests(args: InsertRequestsArgs): Promise<void> {
  const createdAt = new Date(Date.now() - args.createdAtMsAgo)
    .toISOString()
    .replace('T', ' ')
    .replace('Z', '')
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
    created_at: createdAt,
  }))
  await unscopedClickhouse().insert({ table: 'requests', format: 'JSONEachRow', values: rows })
}

export async function cleanupRequests(orgId: string): Promise<void> {
  // ClickHouse mutations (ALTER ... DELETE) are async on disk but synchronous
  // from the client's perspective for our test sizes — safe to await.
  await unscopedClickhouse().command({
    query: 'ALTER TABLE requests DELETE WHERE organization_id = {orgId:UUID}',
    query_params: { orgId },
  })
}

export async function cleanupAnomalyEvents(orgId: string): Promise<void> {
  await supabaseAdmin.from('anomaly_events').delete().eq('organization_id', orgId)
}
