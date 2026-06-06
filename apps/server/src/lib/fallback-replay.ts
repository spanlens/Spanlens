// ─────────────────────────────────────────────────────────────────────────────
// Replay queue for proxy request logs that ClickHouse couldn't accept.
//
// Background
// ----------
// `lib/logger.ts` writes every proxy request to ClickHouse. When CH is
// unreachable (Development tier cold-start, network blip, planned outage),
// the catch path queues the row in the Supabase `requests_fallback` table.
// This module drains that queue back into ClickHouse, called by the cron
// endpoint `/cron/replay-fallback` (every 5 minutes).
//
// Design notes
// ------------
//   • Batch size kept conservative (50) so a single cron invocation runs
//     well under Vercel's function ceiling even if CH is slow to recover.
//   • FIFO order via `ORDER BY created_at ASC` — oldest backlog first
//     means a long outage drains in the same order traffic happened.
//   • Bulk INSERT into CH: one call per batch, not one per row. CH's
//     JSONEachRow accepts arrays trivially and we save N − 1 round trips.
//   • Failure semantics: if the batch INSERT throws, we DON'T delete the
//     rows — they stay in the queue with retry_count++ and the next cron
//     run picks them up.
//   • Retention: rows older than 7 days OR with retry_count ≥ 100 are
//     dropped. Same row stuck for a week almost certainly has malformed
//     data and is poisoning the queue; surface and drop.
// ─────────────────────────────────────────────────────────────────────────────

import { getClickhouse } from './clickhouse.js'
import { supabaseAdmin } from './db.js'

/** Max rows replayed per cron invocation. Bounded so a stuck cron can't run away. */
const REPLAY_BATCH_SIZE = 50

/** Drop rows older than this — broken data poisoning the queue. */
const MAX_AGE_DAYS = 7

/** Drop rows with this many failed attempts. */
const MAX_RETRY_COUNT = 100

export interface ReplayResult {
  attempted: number
  replayed: number
  failed: number
  expired: number
  /** Top-level error if the entire run aborted (e.g. CH still down before any work). */
  error?: string
}

/**
 * Drain a batch from `requests_fallback` into the ClickHouse `requests`
 * table. Designed to be called from the `/cron/replay-fallback` endpoint
 * every 5 minutes; safe to call by hand from a script.
 */
export async function replayFallbackQueue(): Promise<ReplayResult> {
  const result: ReplayResult = {
    attempted: 0,
    replayed: 0,
    failed: 0,
    expired: 0,
  }

  // 1. Expire old / stuck rows BEFORE attempting replay so the limited
  //    batch budget goes to fresh queue entries first.
  const expiry = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { count: expiredCount } = await supabaseAdmin
    .from('requests_fallback')
    .delete({ count: 'exact' })
    .or(`created_at.lt.${expiry},retry_count.gte.${MAX_RETRY_COUNT}`)
  result.expired = expiredCount ?? 0

  // 2. Pull next batch in FIFO order.
  const { data: rows, error: selectError } = await supabaseAdmin
    .from('requests_fallback')
    .select('id, payload, retry_count')
    .order('created_at', { ascending: true })
    .limit(REPLAY_BATCH_SIZE)

  if (selectError) {
    result.error = `select failed: ${selectError.message}`
    return result
  }

  if (!rows || rows.length === 0) {
    return result
  }

  result.attempted = rows.length

  // 3. Bulk INSERT the entire batch. ClickHouse JSONEachRow accepts arrays —
  //    one round trip for the whole batch instead of N.
  try {
    await getClickhouse().insert({
      table: 'requests',
      format: 'JSONEachRow',
      values: rows.map((r) => r.payload as Record<string, unknown>),
    })
    // 4. Success — delete the replayed rows. Use IN (...) to drop the whole
    //    batch in one DELETE. If this DELETE fails for some reason (rare —
    //    same DB the previous INSERT to fallback worked on), the next cron
    //    run will see them again and try the CH replay AGAIN, which becomes
    //    a duplicate INSERT. The `requests` table has no UNIQUE constraint
    //    on id today; duplicates are an acceptable price for the simplicity
    //    of this two-step flow vs. a transactional outbox. Worth revisiting
    //    if duplicates become noticeable in practice.
    const ids = rows.map((r) => r.id as string)
    await supabaseAdmin.from('requests_fallback').delete().in('id', ids)
    result.replayed = rows.length
  } catch (err) {
    // 5. Batch INSERT failed — most likely CH is still down. Bump retry_count
    //    on every row in the batch so eventual expiry kicks in for poison
    //    payloads, while not blocking newer rows.
    const message = err instanceof Error ? err.message : String(err)
    result.failed = rows.length
    result.error = `clickhouse insert failed: ${message.slice(0, 300)}`

    // `rpc('increment_*')` would be cleaner; raw UPDATE keeps this module
    // free of additional Supabase migrations.
    const now = new Date().toISOString()
    for (const row of rows) {
      await supabaseAdmin
        .from('requests_fallback')
        .update({
          retry_count: (row.retry_count as number) + 1,
          last_retry_at: now,
          last_error: message.slice(0, 500),
        })
        .eq('id', row.id as string)
    }
  }

  return result
}

/**
 * Report the size of the fallback queue. Used by `/health` so operators
 * can spot a growing backlog before it gets out of hand.
 */
export async function fallbackQueueSize(): Promise<number | null> {
  const { count, error } = await supabaseAdmin
    .from('requests_fallback')
    .select('id', { count: 'exact', head: true })
  if (error) return null
  return count ?? 0
}

/**
 * 5.3 lite — drain `events_fallback` into the ClickHouse `events` table.
 * Mirrors `replayFallbackQueue` so the same cron endpoint can call both.
 * Separate function (not parameterised) so the SQL stays readable and a
 * future per-table tuning (chunk size, age) doesn't bleed across.
 */
export async function replayEventsFallbackQueue(): Promise<ReplayResult> {
  const result: ReplayResult = {
    attempted: 0,
    replayed: 0,
    failed: 0,
    expired: 0,
  }

  const expiry = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { count: expiredCount } = await supabaseAdmin
    .from('events_fallback')
    .delete({ count: 'exact' })
    .or(`created_at.lt.${expiry},retry_count.gte.${MAX_RETRY_COUNT}`)
  result.expired = expiredCount ?? 0

  const { data: rows, error: selectError } = await supabaseAdmin
    .from('events_fallback')
    .select('id, payload, retry_count')
    .order('created_at', { ascending: true })
    .limit(REPLAY_BATCH_SIZE)

  if (selectError) {
    result.error = `select failed: ${selectError.message}`
    return result
  }

  if (!rows || rows.length === 0) {
    return result
  }

  result.attempted = rows.length

  try {
    await getClickhouse().insert({
      table: 'events',
      format: 'JSONEachRow',
      values: rows.map((r) => r.payload as Record<string, unknown>),
    })
    const ids = rows.map((r) => r.id as string)
    await supabaseAdmin.from('events_fallback').delete().in('id', ids)
    result.replayed = rows.length
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    result.failed = rows.length
    result.error = `clickhouse insert failed: ${message.slice(0, 300)}`

    const now = new Date().toISOString()
    for (const row of rows) {
      await supabaseAdmin
        .from('events_fallback')
        .update({
          retry_count: (row.retry_count as number) + 1,
          last_retry_at: now,
          last_error: message.slice(0, 500),
        })
        .eq('id', row.id as string)
    }
  }

  return result
}

/** Companion size getter for `/health/deep` panels. */
export async function eventsFallbackQueueSize(): Promise<number | null> {
  const { count, error } = await supabaseAdmin
    .from('events_fallback')
    .select('id', { count: 'exact', head: true })
  if (error) return null
  return count ?? 0
}
