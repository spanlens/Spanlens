import type { BackgroundMigration, ChunkResult, ChunkState } from '../../index.js'
import { supabaseAdmin } from '../../../db.js'

/**
 * R-14 (Sprint 5) — resolve OTLP `external_parent_span_id` → Spanlens
 * `parent_span_id` UUID outside the request path.
 *
 * Why a background migration: the OTLP receiver used to call the
 * `link_otlp_span_parents()` RPC after every batch insert. That RPC
 * scanned the spans table for the trace and updated children whose
 * parent had just been inserted. At hot traces (multi-thousand spans)
 * this added ~50-200ms to every OTLP POST and showed up in p95.
 *
 * The fix: insert spans without resolving the linkage, then let a
 * chunked job scan `spans_orphan_external_parent_idx` (partial index
 * on `external_parent_span_id IS NOT NULL AND parent_span_id IS NULL`)
 * and patch them in batches. The eventual consistency window is
 * typically a single 5-minute cron tick — children render with a
 * temporary null parent until then, which the UI already tolerates
 * (parallel agent spans have unfilled parents legitimately).
 *
 * Idempotency: the SELECT skips rows whose `parent_span_id` is already
 * set, and the UPDATE only runs when we find a matching parent in the
 * same trace. A chunk that re-runs after a crash sees the patched rows
 * absent from the orphan scan and resumes from the next id.
 *
 * Cursor: keyset on `spans.id` (UUID v4). We carry the last id we
 * processed and resume strictly above it. Two corner cases:
 *
 *   • Orphans created AFTER the cursor's start: picked up on the next
 *     full pass once `lastId` rolls back to null at done=true.
 *   • Orphans whose parent simply never arrived (dropped batch): they
 *     stay unmatched forever, which is the desired behaviour — the
 *     /cron/detect-orphan-spans cron alerts when too many accumulate.
 */

interface Cursor {
  lastId: string
  scanned: number
  matched: number
}

const CHUNK_SIZE = 500
const ZERO_UUID = '00000000-0000-0000-0000-000000000000'

function readCursor(state: ChunkState): Cursor {
  return {
    lastId: typeof state['lastId'] === 'string' ? (state['lastId'] as string) : ZERO_UUID,
    scanned: typeof state['scanned'] === 'number' ? (state['scanned'] as number) : 0,
    matched: typeof state['matched'] === 'number' ? (state['matched'] as number) : 0,
  }
}

interface OrphanRow {
  id: string
  trace_id: string
  external_parent_span_id: string
}

export const orphanSpanLink: BackgroundMigration = {
  name: 'orphan-span-link',
  description:
    'R-14 — resolve OTLP external_parent_span_id → parent_span_id UUID outside the OTLP request path. Chunks of ' +
    CHUNK_SIZE +
    ' orphan spans.',

  async runChunk(state: ChunkState): Promise<ChunkResult> {
    const cursor = readCursor(state)

    const { data, error } = await supabaseAdmin
      .from('spans')
      .select('id, trace_id, external_parent_span_id')
      .is('parent_span_id', null)
      .not('external_parent_span_id', 'is', null)
      .gt('id', cursor.lastId)
      .order('id', { ascending: true })
      .limit(CHUNK_SIZE)

    if (error) {
      throw new Error(`orphan-span-link select failed: ${error.message}`)
    }

    const rows = (data ?? []) as OrphanRow[]
    if (rows.length === 0) return { done: true }

    let matched = 0
    for (const row of rows) {
      // Lookup the parent within the same trace by the OTel span_id.
      // maybeSingle() returns null silently if the parent hasn't been
      // ingested yet — that's expected for a chunk that races a still
      // arriving OTLP batch, the next pass will pick the orphan up.
      const { data: parent } = await supabaseAdmin
        .from('spans')
        .select('id')
        .eq('trace_id', row.trace_id)
        .eq('external_span_id', row.external_parent_span_id)
        .maybeSingle()

      if (parent) {
        const { error: updateError } = await supabaseAdmin
          .from('spans')
          .update({ parent_span_id: parent.id })
          .eq('id', row.id)
        if (!updateError) matched++
      }
    }

    const lastRow = rows[rows.length - 1]!
    const nextCursor: Cursor = {
      lastId: lastRow.id,
      scanned: cursor.scanned + rows.length,
      matched: cursor.matched + matched,
    }

    return {
      done: false,
      state: nextCursor as unknown as ChunkState,
      progressCurrent: nextCursor.scanned,
    }
  },
}
