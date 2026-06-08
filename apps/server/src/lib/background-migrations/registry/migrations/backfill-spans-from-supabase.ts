import type { BackgroundMigration, ChunkResult, ChunkState } from '../../index.js'
import { unscopedClickhouse, toClickhouseTimestamp } from '../../../clickhouse.js'
import { supabaseAdmin } from '../../../db.js'

/**
 * Phase 5.1 PR-7a — copy historical Supabase `spans` rows into the
 * unified `events` table (event_type='span').
 *
 * Runs AFTER backfill-traces-from-supabase finishes so the parent
 * traces are already on `events` when their children land.
 *
 * Chunk size: 500 rows. Spans carry input/output JSONB so payload
 * per row is bigger than traces, but at this fleet size the network
 * RTT still dominates.
 */

interface BackfillCursor {
  last_created_at: string
  last_id: string
  rows_processed: number
  total_estimate: number | null
}

const CHUNK_SIZE = 500

function readCursor(state: ChunkState): BackfillCursor {
  return {
    last_created_at:
      typeof state['last_created_at'] === 'string'
        ? (state['last_created_at'] as string)
        : '1970-01-01T00:00:00.000Z',
    last_id:
      typeof state['last_id'] === 'string'
        ? (state['last_id'] as string)
        : '00000000-0000-0000-0000-000000000000',
    rows_processed:
      typeof state['rows_processed'] === 'number'
        ? (state['rows_processed'] as number)
        : 0,
    total_estimate:
      typeof state['total_estimate'] === 'number'
        ? (state['total_estimate'] as number)
        : null,
  }
}

interface SpanRow {
  id: string
  trace_id: string
  parent_span_id: string | null
  organization_id: string
  name: string
  span_type: string
  status: string
  started_at: string
  ended_at: string | null
  duration_ms: number | null
  input: unknown
  output: unknown
  metadata: Record<string, unknown> | null
  error_message: string | null
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cost_usd: number | string | null
  created_at: string
}

function flattenMetadata(
  meta: Record<string, unknown> | null,
  status: string,
  spanType: string,
): Record<string, string> {
  const out: Record<string, string> = {}
  if (meta) {
    for (const [k, v] of Object.entries(meta)) {
      if (typeof v === 'string') out[k] = v
    }
  }
  // Always wins so a customer payload can't shadow the backfill
  // marker, status, or span_type.
  out['source'] = 'backfill_spans_from_supabase'
  out['status'] = status
  out['span_type'] = spanType
  return out
}

function mapSpanToEventRow(s: SpanRow): Record<string, unknown> {
  const startedAt = toClickhouseTimestamp(new Date(s.started_at))
  const endedAt = s.ended_at ? toClickhouseTimestamp(new Date(s.ended_at)) : null
  const created = toClickhouseTimestamp(new Date(s.created_at))
  const inputStr = s.input == null ? '' : JSON.stringify(s.input)
  const outputStr = s.output == null ? '' : JSON.stringify(s.output)
  const costNum = s.cost_usd != null ? Number(s.cost_usd) : null
  return {
    event_id: s.id,
    trace_id: s.trace_id,
    parent_event_id: s.parent_span_id,
    event_type: 'span',
    organization_id: s.organization_id,
    project_id: '00000000-0000-0000-0000-000000000000', // spans table has no project_id; events column is NOT NULL UUID
    api_key_id: null,
    name: s.name,
    provider: '',
    model: '',
    start_time: startedAt,
    end_time: endedAt,
    duration_ms: s.duration_ms,
    input: inputStr,
    output: outputStr,
    usage_details: {
      prompt_tokens: s.prompt_tokens,
      completion_tokens: s.completion_tokens,
      total_tokens: s.total_tokens,
    },
    cost_details: costNum != null ? { total_cost_usd: costNum } : {},
    total_cost_usd: costNum,
    total_tokens: s.total_tokens,
    status_code: 0,
    error_message: s.error_message,
    metadata: flattenMetadata(s.metadata, s.status, s.span_type),
    user_id: null,
    session_id: null,
    prompt_version_id: null,
    provider_key_id: null,
    flags: '[]',
    response_flags: '{}',
    has_security_flags: false,
    truncated: 0,
    created_at: created,
  }
}

export const backfillSpansFromSupabase: BackgroundMigration = {
  name: 'backfill-spans-from-supabase',
  description:
    'Phase 5.1 PR-7a — copy historical spans from Postgres into the unified events table, chunks of ' +
    CHUNK_SIZE +
    ' rows.',

  async runChunk(state: ChunkState): Promise<ChunkResult> {
    const cursor = readCursor(state)

    let totalEstimate = cursor.total_estimate
    if (totalEstimate == null) {
      const { count } = await supabaseAdmin
        .from('spans')
        .select('id', { count: 'planned', head: true })
      totalEstimate = count ?? 0
    }

    const { data, error } = await supabaseAdmin
      .from('spans')
      .select(
        'id, trace_id, parent_span_id, organization_id, name, span_type, status, started_at, ended_at, duration_ms, input, output, metadata, error_message, prompt_tokens, completion_tokens, total_tokens, cost_usd, created_at',
      )
      .or(
        `created_at.gt.${cursor.last_created_at},and(created_at.eq.${cursor.last_created_at},id.gt.${cursor.last_id})`,
      )
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(CHUNK_SIZE)

    if (error) {
      throw new Error(`supabase spans select failed: ${error.message}`)
    }

    const rows = (data ?? []) as SpanRow[]
    if (rows.length === 0) return { done: true }

    const eventRows = rows.map(mapSpanToEventRow)
    await unscopedClickhouse().insert({
      table: 'events',
      format: 'JSONEachRow',
      values: eventRows,
    })

    const lastRow = rows[rows.length - 1]!
    const nextCursor: BackfillCursor = {
      last_created_at: lastRow.created_at,
      last_id: lastRow.id,
      rows_processed: cursor.rows_processed + rows.length,
      total_estimate: totalEstimate,
    }

    const result: ChunkResult = {
      done: false,
      state: nextCursor as unknown as ChunkState,
      progressCurrent: nextCursor.rows_processed,
    }
    if (totalEstimate != null) {
      ;(result as { progressTotal?: number }).progressTotal = totalEstimate
    }

    if (
      nextCursor.last_created_at === cursor.last_created_at &&
      nextCursor.last_id === cursor.last_id
    ) {
      return { done: true }
    }

    return result
  },
}

export { mapSpanToEventRow }
