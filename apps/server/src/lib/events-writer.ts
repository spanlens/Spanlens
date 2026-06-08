/**
 * Phase 5.1 dual-write — events table shadow inserts.
 *
 * The runtime contract:
 *
 *   • Reads still come from `requests` (LLM calls) and Postgres
 *     `traces` / `spans`. `events` is a shadow store while we
 *     dual-write, backfill, and gradually flip dashboard reads.
 *   • Every helper here MUST NOT throw back to the caller. If the
 *     CH INSERT fails the row is silently dropped; the source
 *     `requests` row already landed. We log loudly so a sustained
 *     outage is visible in Sentry but never escalate to a 5xx.
 *   • Helpers are pure mapping + a single CH insert call. No
 *     dependency on the request scan, security flags, fallback queue,
 *     or webhook chain — those stay on the requests path until
 *     reads cut over.
 *
 * This file is intentionally thin so we can audit the
 * requests → events mapping in one diff. The schema lives in
 * `clickhouse/migrations/004_create_events.sql`.
 */

import { randomUUID } from 'node:crypto'
import { unscopedClickhouse, toClickhouseTimestamp } from './clickhouse.js'
import { supabaseAdmin } from './db.js'
import type { RequestLogData } from './logger.js'

/**
 * Shared insert path for every events shadow write. Wraps the ClickHouse
 * insert so that a CH-side failure (Cloud dev-tier auto-pause, transient
 * network blip) queues the row into Supabase `events_fallback` instead of
 * being lost. The `/cron/replay-fallback` cron drains that queue every
 * five minutes — same retry semantics as `requests_fallback` (P2.6).
 *
 * Never throws. Caller treats events shadow writes as best-effort.
 */
async function insertEventOrQueue(row: Record<string, unknown>): Promise<void> {
  try {
    await unscopedClickhouse().insert({
      table: 'events',
      format: 'JSONEachRow',
      values: [row],
    })
  } catch (chErr) {
    const message = chErr instanceof Error ? chErr.message : String(chErr)
    console.error(
      '[events-writer] CH insert failed → queueing to events_fallback:',
      message,
    )
    try {
      await supabaseAdmin.from('events_fallback').insert({
        payload: row,
        event_type: String(row['event_type'] ?? 'unknown'),
        last_error: message.slice(0, 500),
      })
    } catch (queueErr) {
      // Last-resort: even the Supabase enqueue failed. Surface loudly so
      // sustained outages don't go silently. The row is genuinely lost
      // at this point — there is no further backstop.
      const queueMsg = queueErr instanceof Error ? queueErr.message : String(queueErr)
      console.error('[events-writer] events_fallback enqueue failed too:', queueMsg)
    }
  }
}

/**
 * Shape of the row that landed in `requests`. We re-use the field
 * names so the call site in logger.ts can pass `clickhouseRow`
 * straight through.
 */
interface RequestRowLike {
  id: string
  cost_usd: number | null
  created_at: string
  request_body: string
  response_body: string
  error_message: string | null
  /**
   * Pre-computed in logger.ts and threaded straight through so events
   * gets the same security/truncation values as `requests`. Added by
   * migration 006.
   */
  flags?: string
  response_flags?: string
  has_security_flags?: boolean
  truncated?: number
}

/**
 * Write an LLM call as an `event_type='generation'` row in events.
 * Called from logger.ts AFTER the `requests` insert succeeds.
 */
export async function writeRequestAsEvent(
  data: RequestLogData,
  requestRow: RequestRowLike,
): Promise<void> {
  // `usage_details` is the open-ended token map. For backwards
  // compatibility with the existing dashboard we include the
  // historical keys (prompt/completion/total/cache_read/cache_write)
  // even when zero — the lookup is cheaper than a "key missing" check
  // on the read side.
  const usageDetails: Record<string, number> = {
    prompt_tokens: data.promptTokens,
    completion_tokens: data.completionTokens,
    total_tokens: data.totalTokens,
    cache_read_tokens: data.cacheReadTokens ?? 0,
    cache_write_tokens: data.cacheWriteTokens ?? 0,
  }
  const costDetails: Record<string, number> = {}
  if (data.costUsd != null) {
    costDetails['total_cost_usd'] = data.costUsd
  }

  const metadata: Record<string, string> = {}
  if (data.serviceTier) metadata['service_tier'] = data.serviceTier
  // `truncated` used to live in the metadata map as a string; from
  // migration 006 it has a dedicated typed column. Keep the map entry
  // for one release cycle so older consumers don't break.
  if (data.truncated) metadata['truncated'] = 'true'

  // Phase 5.1 PR-5 — the four columns added by migration 006. The
  // logger already wrote these into the `requests` row; we read them
  // back off `requestRow` so events stays bit-identical to what
  // landed in `requests`. Defaults match the requests-table column
  // defaults so a missing prop never produces a wrong value.
  const flagsValue = requestRow.flags ?? '[]'
  const responseFlagsValue = requestRow.response_flags ?? '{}'
  const hasSecurityFlagsValue = requestRow.has_security_flags ?? false
  const truncatedValue = requestRow.truncated ?? (data.truncated ? 1 : 0)

  const eventRow = {
    event_id: requestRow.id,
    // For an LLM call without an explicit trace we generate a
    // synthetic trace_id so every row in events has a non-null
    // trace_id (queries don't need a special-case null branch).
    trace_id: data.traceId ?? randomUUID(),
    parent_event_id: data.spanId ?? null,
    event_type: 'generation',
    organization_id: data.organizationId,
    project_id: data.projectId,
    api_key_id: data.apiKeyId ?? null,
    name: `${data.provider}.${data.model}`,
    provider: data.provider,
    model: data.model,
    start_time: requestRow.created_at,
    end_time: requestRow.created_at,
    // Reuse the proxy-measured latency. Faster than re-deriving from
    // start/end (which are equal when we don't know the start).
    duration_ms: data.latencyMs,
    input: requestRow.request_body,
    output: requestRow.response_body,
    usage_details: usageDetails,
    cost_details: costDetails,
    total_cost_usd: data.costUsd ?? null,
    total_tokens: data.totalTokens,
    status_code: data.statusCode,
    error_message: requestRow.error_message,
    metadata,
    user_id: data.userId ?? null,
    session_id: data.sessionId ?? null,
    prompt_version_id: data.promptVersionId ?? null,
    provider_key_id: data.providerKeyId ?? null,
    flags: flagsValue,
    response_flags: responseFlagsValue,
    has_security_flags: hasSecurityFlagsValue,
    truncated: truncatedValue,
    created_at: requestRow.created_at,
  }

  await insertEventOrQueue(eventRow)
}

// ── Trace + span shadow writes (used by ingest API) ──────────────────────────

export interface TraceEventInput {
  traceId: string
  organizationId: string
  projectId: string
  apiKeyId?: string | null
  name: string
  startedAt: string
  endedAt?: string | null
  status?: string | null
  errorMessage?: string | null
  metadata?: Record<string, unknown> | null
  durationMs?: number | null
}

export async function writeTraceAsEvent(input: TraceEventInput): Promise<void> {
  const created = toClickhouseTimestamp(new Date(input.startedAt))
  const metadata: Record<string, string> = { source: 'ingest_trace' }
  if (input.status) metadata['status'] = input.status
  if (input.metadata) {
    // The ingest API stores trace metadata as JSONB. Flatten top-level
    // string values into the events `metadata` map; nested objects go
    // into the `input` payload as JSON so we don't lose them.
    for (const [k, v] of Object.entries(input.metadata)) {
      if (typeof v === 'string') metadata[k] = v
    }
  }

  const eventRow = {
    event_id: input.traceId,
    trace_id: input.traceId,
    parent_event_id: null,
    event_type: 'trace',
    organization_id: input.organizationId,
    project_id: input.projectId,
    api_key_id: input.apiKeyId ?? null,
    name: input.name,
    provider: '',
    model: '',
    start_time: created,
    end_time: input.endedAt ? toClickhouseTimestamp(new Date(input.endedAt)) : null,
    duration_ms: input.durationMs ?? null,
    input: input.metadata ? JSON.stringify(input.metadata) : '',
    output: '',
    usage_details: {},
    cost_details: {},
    total_cost_usd: null,
    total_tokens: 0,
    status_code: 0,
    error_message: input.errorMessage ?? null,
    metadata,
    user_id: null,
    session_id: null,
    prompt_version_id: null,
    provider_key_id: null,
    created_at: created,
  }

  await insertEventOrQueue(eventRow)
}

export interface SpanEventInput {
  spanId: string
  traceId: string
  parentSpanId?: string | null
  organizationId: string
  projectId: string
  apiKeyId?: string | null
  name: string
  spanType?: string | null
  startedAt: string
  endedAt?: string | null
  durationMs?: number | null
  status?: string | null
  errorMessage?: string | null
  input?: unknown
  output?: unknown
  metadata?: Record<string, unknown> | null
  promptTokens?: number | null
  completionTokens?: number | null
  totalTokens?: number | null
  costUsd?: number | null
}

export async function writeSpanAsEvent(input: SpanEventInput): Promise<void> {
  const created = toClickhouseTimestamp(new Date(input.startedAt))
  const usageDetails: Record<string, number> = {}
  if (input.promptTokens != null) usageDetails['prompt_tokens'] = input.promptTokens
  if (input.completionTokens != null) usageDetails['completion_tokens'] = input.completionTokens
  if (input.totalTokens != null) usageDetails['total_tokens'] = input.totalTokens
  const costDetails: Record<string, number> = {}
  if (input.costUsd != null) costDetails['total_cost_usd'] = input.costUsd

  const metadata: Record<string, string> = { source: 'ingest_span' }
  if (input.spanType) metadata['span_type'] = input.spanType
  if (input.status) metadata['status'] = input.status
  if (input.metadata) {
    for (const [k, v] of Object.entries(input.metadata)) {
      if (typeof v === 'string') metadata[k] = v
    }
  }

  const eventRow = {
    event_id: input.spanId,
    trace_id: input.traceId,
    parent_event_id: input.parentSpanId ?? null,
    event_type: 'span',
    organization_id: input.organizationId,
    project_id: input.projectId,
    api_key_id: input.apiKeyId ?? null,
    name: input.name,
    provider: '',
    model: '',
    start_time: created,
    end_time: input.endedAt ? toClickhouseTimestamp(new Date(input.endedAt)) : null,
    duration_ms: input.durationMs ?? null,
    input: input.input != null ? JSON.stringify(input.input) : '',
    output: input.output != null ? JSON.stringify(input.output) : '',
    usage_details: usageDetails,
    cost_details: costDetails,
    total_cost_usd: input.costUsd ?? null,
    total_tokens: input.totalTokens ?? 0,
    status_code: 0,
    error_message: input.errorMessage ?? null,
    metadata,
    user_id: null,
    session_id: null,
    prompt_version_id: null,
    provider_key_id: null,
    created_at: created,
  }

  await insertEventOrQueue(eventRow)
}
