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

import { unscopedClickhouse } from './clickhouse.js'
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
 * Returns the subset of `ids` that ALREADY exist in the ClickHouse `table`.
 *
 * Replay idempotency: if a prior cron run inserted a batch into ClickHouse but
 * then failed to DELETE the rows from the Supabase queue (rare — CH INSERT
 * succeeds, the immediately-following Supabase DELETE blips), the next run
 * re-reads the same rows and would re-INSERT the SAME payloads. `requests` is a
 * plain MergeTree with no UNIQUE constraint on `id` (see
 * clickhouse/migrations/001_create_requests.sql), so a blind re-INSERT
 * duplicates the row — double-counting cost and quota usage. Filtering known
 * ids out before INSERT closes that window cheaply, without a heavy
 * ReplacingMergeTree engine migration on the production table.
 *
 * `table` is a fixed union literal (never user input), so interpolating it into
 * the query is safe.
 */
async function fetchExistingIds(
  table: 'requests' | 'events',
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const result = await unscopedClickhouse().query({
    query: `SELECT id FROM ${table} WHERE id IN ({ids:Array(UUID)})`,
    query_params: { ids },
    format: 'JSONEachRow',
  })
  const rows = (await result.json()) as Array<{ id: string }>
  return new Set(rows.map((r) => String(r.id)))
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
    // 3a. Idempotency guard: drop payloads already in ClickHouse from a prior
    //     replay whose queue DELETE blipped. Without this, the re-INSERT
    //     duplicates the row (no UNIQUE on `requests.id`) and inflates cost +
    //     quota usage. See fetchExistingIds.
    const payloads = rows.map((r) => r.payload as Record<string, unknown>)
    const payloadIds = payloads
      .map((p) => p['id'])
      .filter((x): x is string => typeof x === 'string')
    const alreadyInCh = await fetchExistingIds('requests', payloadIds)
    const toInsert = payloads.filter((p) => !alreadyInCh.has(String(p['id'])))

    if (toInsert.length > 0) {
      await unscopedClickhouse().insert({
        table: 'requests',
        format: 'JSONEachRow',
        values: toInsert,
      })
    }
    // 4. Success — delete the WHOLE batch in one DELETE. Rows skipped at 3a are
    //    already in ClickHouse, so they must leave the queue too. If this
    //    DELETE blips, the next run re-reads them but the 3a guard makes the
    //    re-INSERT a no-op, so the queue still drains without duplicating data.
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
    // Same idempotency guard as replayFallbackQueue (see fetchExistingIds):
    // `events` is also a plain MergeTree with no UNIQUE on `id`.
    const payloads = rows.map((r) => r.payload as Record<string, unknown>)
    const payloadIds = payloads
      .map((p) => p['id'])
      .filter((x): x is string => typeof x === 'string')
    const alreadyInCh = await fetchExistingIds('events', payloadIds)
    const toInsert = payloads.filter((p) => !alreadyInCh.has(String(p['id'])))

    if (toInsert.length > 0) {
      await unscopedClickhouse().insert({
        table: 'events',
        format: 'JSONEachRow',
        values: toInsert,
      })
    }
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

/**
 * Backlog size (rows) above which a sustained queue raises an operator alert.
 * The replayer drains REPLAY_BATCH_SIZE (50) rows per 5-minute run, so a
 * four-figure backlog means ClickHouse has been unreachable long enough that
 * rows are accumulating faster than they drain and risk the 7-day TTL
 * (silent data loss). Matches the ">1000 is abnormal" guidance in
 * CLAUDE.md gotcha #23.
 */
export const BACKLOG_ALERT_THRESHOLD = 1000

export interface BacklogAlertResult {
  requestsQueue: number | null
  eventsQueue: number | null
  /** True when this call inserted a new internal_alerts row. */
  alerted: boolean
}

/**
 * Raises an `internal_alerts` row (kind `fallback_queue_high`, already declared
 * in migration 20260609110000_internal_alerts.sql) when either fallback queue
 * exceeds `threshold`. Surfaced to operators at /admin/alerts.
 *
 * Deduplicated: if an UNRESOLVED `fallback_queue_high` alert is already open,
 * no new row is inserted. The replay cron runs every 5 minutes, so without this
 * guard a multi-hour ClickHouse outage would insert a fresh alert every run.
 * The operator resolves it from /admin/alerts once the backlog has drained.
 *
 * Never throws — backlog monitoring must not break the replay cron itself.
 * A null queue size (the size query failed) is treated as 0 so a transient
 * Supabase blip does not page; the missing CH data is the real signal and
 * surfaces via the CH_INSERT_FAILED logs.
 */
export async function alertOnFallbackBacklog(
  threshold: number = BACKLOG_ALERT_THRESHOLD,
): Promise<BacklogAlertResult> {
  const [requestsQueue, eventsQueue] = await Promise.all([
    fallbackQueueSize(),
    eventsFallbackQueueSize(),
  ])

  const over = (requestsQueue ?? 0) > threshold || (eventsQueue ?? 0) > threshold
  if (!over) return { requestsQueue, eventsQueue, alerted: false }

  try {
    // Dedup against an already-open alert of the same kind.
    const { data: existing } = await supabaseAdmin
      .from('internal_alerts')
      .select('id')
      .eq('kind', 'fallback_queue_high')
      .is('resolved_at', null)
      .limit(1)
      .maybeSingle()
    if (existing) return { requestsQueue, eventsQueue, alerted: false }

    await supabaseAdmin.from('internal_alerts').insert({
      kind: 'fallback_queue_high',
      severity: 'error',
      message:
        `Fallback queue backlog over ${threshold} ` +
        `(requests=${requestsQueue ?? 'unknown'}, events=${eventsQueue ?? 'unknown'}). ` +
        `ClickHouse may be unreachable — rows risk the 7-day TTL.`,
      details: { requestsQueue, eventsQueue, threshold },
    })
    return { requestsQueue, eventsQueue, alerted: true }
  } catch {
    // Best-effort: a monitoring failure must not break the replay cron.
    return { requestsQueue, eventsQueue, alerted: false }
  }
}
