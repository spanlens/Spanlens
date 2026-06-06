import type { BackgroundMigration, ChunkResult, ChunkState } from '../../index.js'
import { getClickhouse, toClickhouseTimestamp } from '../../../clickhouse.js'

/**
 * Phase 5.1 Stage 2 — backfill the `events` table from historical
 * `requests` rows.
 *
 * Strategy:
 *
 *   • Stream rows out of `requests` in (created_at, id) order. Both
 *     fields are part of the table's primary key prefix so a tuple
 *     comparison `(created_at, id) > (cursor.created_at, cursor.id)`
 *     hits the skip-index and never scans the full table.
 *   • For each chunk (5000 rows), map every row into the `events`
 *     row shape — same mapping as the live dual-write but inline
 *     here so we can pull every column out of the SELECT in a
 *     single pass.
 *   • INSERT the chunk into `events`. ClickHouse handles 5000-row
 *     batches efficiently; the network round trip dominates.
 *   • Persist the new cursor in `state` so the next chunk picks up
 *     where we left off. If the runner crashes mid-chunk the chunk
 *     re-runs from the prior cursor — INSERT is not idempotent (no
 *     unique constraint on events), so duplicate rows are possible
 *     for the in-flight chunk. The dedupe strategy in production
 *     is the ORDER BY uniqueness check in Stage 3 reads (we filter
 *     `argMax(…, created_at)` per event_id), so this is an
 *     acceptable trade-off.
 *
 * Cursor format in `state`:
 *
 *   {
 *     last_created_at: "YYYY-MM-DD HH:MM:SS.fff"  // ClickHouse fmt
 *     last_id: "<uuid>"
 *     rows_processed: <number>
 *     total_estimate: <number | null>  // counted once on first run
 *   }
 */

interface BackfillCursor {
  last_created_at: string
  last_id: string
  rows_processed: number
  total_estimate: number | null
}

interface RequestRow {
  id: string
  organization_id: string
  project_id: string
  api_key_id: string | null
  provider: string
  model: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  cost_usd: string | null  // CH returns decimals as strings
  latency_ms: number
  status_code: number
  request_body: string
  response_body: string
  error_message: string | null
  trace_id: string | null
  span_id: string | null
  prompt_version_id: string | null
  provider_key_id: string | null
  user_id: string | null
  session_id: string | null
  service_tier: string
  created_at: string
}

const CHUNK_SIZE = 5000

const EPOCH_CURSOR: BackfillCursor = {
  last_created_at: '1970-01-01 00:00:00.000',
  last_id: '00000000-0000-0000-0000-000000000000',
  rows_processed: 0,
  total_estimate: null,
}

function readCursor(state: ChunkState): BackfillCursor {
  return {
    last_created_at:
      typeof state['last_created_at'] === 'string'
        ? (state['last_created_at'] as string)
        : EPOCH_CURSOR.last_created_at,
    last_id:
      typeof state['last_id'] === 'string'
        ? (state['last_id'] as string)
        : EPOCH_CURSOR.last_id,
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

/**
 * Map a `requests` row into the events-table row shape. Matches the
 * mapping in `lib/events-writer.ts::writeRequestAsEvent` — we keep
 * the inline copy here so the backfill SELECT can drain every
 * column in one pass without rebuilding a synthetic RequestLogData
 * object.
 */
function mapRequestToEventRow(r: RequestRow): Record<string, unknown> {
  const created = r.created_at
  const usageDetails: Record<string, number> = {
    prompt_tokens: Number(r.prompt_tokens) || 0,
    completion_tokens: Number(r.completion_tokens) || 0,
    total_tokens: Number(r.total_tokens) || 0,
    cache_read_tokens: Number(r.cache_read_tokens) || 0,
    cache_write_tokens: Number(r.cache_write_tokens) || 0,
  }
  const costNumeric = r.cost_usd == null ? null : Number(r.cost_usd)
  const costDetails: Record<string, number> = {}
  if (costNumeric != null && Number.isFinite(costNumeric)) {
    costDetails['total_cost_usd'] = costNumeric
  }

  const metadata: Record<string, string> = { source: 'backfill_requests' }
  if (r.service_tier) metadata['service_tier'] = r.service_tier

  // ClickHouse SELECT can return non-null Nullable(UUID) as the
  // string '00000000-...' when DEFAULT was applied — treat that as
  // a real value rather than fabricating a fresh UUID.
  const traceId = r.trace_id ?? r.id

  return {
    event_id: r.id,
    trace_id: traceId,
    parent_event_id: r.span_id ?? null,
    event_type: 'generation',
    organization_id: r.organization_id,
    project_id: r.project_id,
    api_key_id: r.api_key_id ?? null,
    name: `${r.provider}.${r.model}`,
    provider: r.provider,
    model: r.model,
    start_time: created,
    end_time: created,
    duration_ms: Number(r.latency_ms) || 0,
    input: r.request_body ?? '',
    output: r.response_body ?? '',
    usage_details: usageDetails,
    cost_details: costDetails,
    total_cost_usd: costNumeric ?? null,
    total_tokens: Number(r.total_tokens) || 0,
    status_code: Number(r.status_code) || 0,
    error_message: r.error_message ?? null,
    metadata,
    user_id: r.user_id ?? null,
    session_id: r.session_id ?? null,
    prompt_version_id: r.prompt_version_id ?? null,
    provider_key_id: r.provider_key_id ?? null,
    created_at: created,
  }
}

/**
 * The migration object the runner registers.
 */
export const backfillEventsFromRequests: BackgroundMigration = {
  name: 'backfill-events-from-requests',
  description:
    'Phase 5.1 Stage 2 — copy historical LLM requests into the unified events table in chunks of ' +
    CHUNK_SIZE +
    ' rows, ordered by (created_at, id).',

  async runChunk(state: ChunkState): Promise<ChunkResult> {
    const cursor = readCursor(state)
    const ch = getClickhouse()

    // First-run-only: estimate the total row count so the admin UI
    // can show a progress percentage. SELECT count() on a 6-month
    // window can take a few seconds, but we only pay it once.
    let totalEstimate = cursor.total_estimate
    if (totalEstimate == null) {
      const countRes = await ch.query({
        query: 'SELECT count() AS c FROM requests',
        format: 'JSONEachRow',
      })
      const countRows = (await countRes.json()) as Array<{ c: string }>
      totalEstimate = Number(countRows[0]?.c ?? 0)
    }

    // Tuple comparison hits the skip index because (created_at, id)
    // are part of the table's ORDER BY. LIMIT 5000 keeps the chunk
    // bounded so one tick finishes in well under the 4-min budget.
    const selectRes = await ch.query({
      query: `
        SELECT
          toString(id) AS id,
          toString(organization_id) AS organization_id,
          toString(project_id) AS project_id,
          toString(api_key_id) AS api_key_id,
          provider,
          model,
          prompt_tokens,
          completion_tokens,
          total_tokens,
          cache_read_tokens,
          cache_write_tokens,
          toString(cost_usd) AS cost_usd,
          latency_ms,
          status_code,
          request_body,
          response_body,
          error_message,
          toString(trace_id) AS trace_id,
          toString(span_id) AS span_id,
          toString(prompt_version_id) AS prompt_version_id,
          toString(provider_key_id) AS provider_key_id,
          user_id,
          session_id,
          service_tier,
          toString(created_at) AS created_at
        FROM requests
        WHERE (created_at, id) > (parseDateTime64BestEffort({cursor_ts:String}), {cursor_id:UUID})
        ORDER BY created_at, id
        LIMIT ${CHUNK_SIZE}`,
      query_params: {
        cursor_ts: cursor.last_created_at,
        cursor_id: cursor.last_id,
      },
      format: 'JSONEachRow',
    })

    const rows = (await selectRes.json()) as RequestRow[]

    if (rows.length === 0) {
      return { done: true }
    }

    // toString() in the SELECT turns the empty UUID '00000000-…'
    // into the literal zero-uuid string for Nullable columns where
    // the underlying value was null. Push that through map(); the
    // writer treats it as null at INSERT time.
    const eventRows = rows
      .map((r) => {
        const cleaned: RequestRow = { ...r }
        if (cleaned.api_key_id === '00000000-0000-0000-0000-000000000000') {
          cleaned.api_key_id = null
        }
        if (cleaned.trace_id === '00000000-0000-0000-0000-000000000000') {
          cleaned.trace_id = null
        }
        if (cleaned.span_id === '00000000-0000-0000-0000-000000000000') {
          cleaned.span_id = null
        }
        if (cleaned.prompt_version_id === '00000000-0000-0000-0000-000000000000') {
          cleaned.prompt_version_id = null
        }
        if (cleaned.provider_key_id === '00000000-0000-0000-0000-000000000000') {
          cleaned.provider_key_id = null
        }
        return mapRequestToEventRow(cleaned)
      })

    await ch.insert({
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

    const result: {
      done: false
      state: ChunkState
      progressCurrent?: number
      progressTotal?: number
    } = {
      done: false,
      state: nextCursor as unknown as ChunkState,
      progressCurrent: nextCursor.rows_processed,
    }
    if (totalEstimate != null) result.progressTotal = totalEstimate

    // Defensive: if ClickHouse returned a row but the cursor didn't
    // advance, we'd loop forever. Treat that as done so the migration
    // doesn't burn the cluster.
    if (
      nextCursor.last_created_at === cursor.last_created_at &&
      nextCursor.last_id === cursor.last_id
    ) {
      return { done: true }
    }

    return result
  },
}

// Re-export the helper so the registry test + future stats-queries
// rewrites can share it without re-importing the writer's heavier
// dependencies.
export { mapRequestToEventRow }

// Imported for side-effect symmetry — `toClickhouseTimestamp` is the
// canonical formatter and we'd reach for it the moment the SELECT
// shape changes. Reference it once so tree-shaking doesn't drop the
// import.
void toClickhouseTimestamp
