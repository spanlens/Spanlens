import type { BackgroundMigration, ChunkResult, ChunkState } from '../../index.js'
import { unscopedClickhouse, toClickhouseTimestamp } from '../../../clickhouse.js'
import { supabaseAdmin } from '../../../db.js'

/**
 * Phase 5.1 PR-7a — copy historical Supabase `traces` rows into the
 * unified `events` table (event_type='trace').
 *
 * Pairs with backfill-spans-from-supabase. We backfill traces first
 * so the events table's parent rows exist before child spans land —
 * keeps the data dependency obvious if either backfill is paused.
 *
 * Cursor: (last_created_at, last_id). Supabase indexes `created_at`
 * and `id` on `traces`, so the cursor lookup hits a btree scan.
 *
 * Chunk size: 500 rows. Traces are small (no body payloads on the
 * trace row itself) so the round trip is dominated by network.
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

interface TraceRow {
  id: string
  organization_id: string
  project_id: string
  api_key_id: string | null
  name: string
  status: string
  started_at: string
  ended_at: string | null
  duration_ms: number | null
  metadata: Record<string, unknown> | null
  error_message: string | null
  total_tokens: number
  total_cost_usd: number | string
  created_at: string
  external_trace_id: string | null
}

function flattenMetadata(meta: Record<string, unknown> | null, status: string): Record<string, string> {
  // Start with the trace-level metadata so the backfill marker and
  // the legacy status can't be overwritten if a customer payload
  // contains a clashing `source` or `status` key.
  const out: Record<string, string> = {}
  if (meta) {
    for (const [k, v] of Object.entries(meta)) {
      if (typeof v === 'string') out[k] = v
    }
  }
  out['source'] = 'backfill_traces_from_supabase'
  out['status'] = status
  return out
}

function mapTraceToEventRow(t: TraceRow): Record<string, unknown> {
  const startedAt = toClickhouseTimestamp(new Date(t.started_at))
  const endedAt = t.ended_at ? toClickhouseTimestamp(new Date(t.ended_at)) : null
  const created = toClickhouseTimestamp(new Date(t.created_at))
  return {
    event_id: t.id,
    trace_id: t.id,
    parent_event_id: null,
    event_type: 'trace',
    organization_id: t.organization_id,
    project_id: t.project_id,
    api_key_id: t.api_key_id,
    name: t.name,
    provider: '',
    model: '',
    start_time: startedAt,
    end_time: endedAt,
    duration_ms: t.duration_ms,
    input: t.metadata ? JSON.stringify(t.metadata) : '',
    output: '',
    usage_details: { total_tokens: t.total_tokens },
    cost_details: {},
    total_cost_usd: t.total_cost_usd != null ? Number(t.total_cost_usd) : null,
    total_tokens: t.total_tokens,
    status_code: 0,
    error_message: t.error_message,
    metadata: flattenMetadata(t.metadata, t.status),
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

export const backfillTracesFromSupabase: BackgroundMigration = {
  name: 'backfill-traces-from-supabase',
  description:
    'Phase 5.1 PR-7a — copy historical traces from Postgres into the unified events table, chunks of ' +
    CHUNK_SIZE +
    ' rows.',

  async runChunk(state: ChunkState): Promise<ChunkResult> {
    const cursor = readCursor(state)

    let totalEstimate = cursor.total_estimate
    if (totalEstimate == null) {
      const { count } = await supabaseAdmin
        .from('traces')
        .select('id', { count: 'planned', head: true })
      totalEstimate = count ?? 0
    }

    // Supabase doesn't support tuple comparison; we approximate with
    // `(created_at > cursor) OR (created_at == cursor AND id > cursor)`.
    // For our 115-row dataset that's fine. At 100k+ traces we'd want
    // a single-column cursor and a TIESBREAKER ORDER BY.
    const { data, error } = await supabaseAdmin
      .from('traces')
      .select(
        'id, organization_id, project_id, api_key_id, name, status, started_at, ended_at, duration_ms, metadata, error_message, total_tokens, total_cost_usd, created_at, external_trace_id',
      )
      .or(
        `created_at.gt.${cursor.last_created_at},and(created_at.eq.${cursor.last_created_at},id.gt.${cursor.last_id})`,
      )
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(CHUNK_SIZE)

    if (error) {
      throw new Error(`supabase traces select failed: ${error.message}`)
    }

    const rows = (data ?? []) as TraceRow[]
    if (rows.length === 0) return { done: true }

    const eventRows = rows.map(mapTraceToEventRow)
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

    // Defensive: cursor didn't advance → stop.
    if (
      nextCursor.last_created_at === cursor.last_created_at &&
      nextCursor.last_id === cursor.last_id
    ) {
      return { done: true }
    }

    return result
  },
}

export { mapTraceToEventRow }
