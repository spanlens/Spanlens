// ─────────────────────────────────────────────────────────────────────────────
// Replay queue for proxy request logs the log store couldn't accept.
//
// Background
// ----------
// `lib/logger.ts` writes every proxy request to the `requests` table. When
// that write fails (network blip, pooler saturation, planned outage), the
// catch path queues the row in the `requests_fallback` table. This module
// drains that queue back into `requests`, called by the cron endpoint
// `/cron/replay-fallback` (every 5 minutes).
//
// Design notes
// ------------
//   • Batch size kept conservative (50) so a single cron invocation runs
//     well under Vercel's function ceiling even if the database is slow.
//   • FIFO order via `ORDER BY created_at ASC` — oldest backlog first
//     means a long outage drains in the same order traffic happened.
//   • Bulk INSERT: one multi-row statement per batch, not one per row, so
//     a batch costs one round trip instead of N.
//   • Failure semantics: if the batch INSERT throws, we DON'T delete the
//     rows — they stay in the queue with retry_count++ and the next cron
//     run picks them up.
//   • Retention: rows older than 7 days OR with retry_count ≥ 100 are
//     dropped. Same row stuck for a week almost certainly has malformed
//     data and is poisoning the queue; surface and drop.
// ─────────────────────────────────────────────────────────────────────────────

import { pgExecute } from './postgres.js'
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
  /** Top-level error if the entire run aborted (e.g. the queue SELECT failed before any work). */
  error?: string
}

/**
 * Columns of `requests`, in the order the replay INSERT lists them.
 *
 * Spelled out rather than derived from each payload's own keys: the column
 * list is part of the SQL text, and building it from queue data would let
 * stored content shape a statement. A fixed list also means a payload
 * carrying an unexpected key is ignored instead of failing the batch, which
 * matters because queued payloads can predate a schema change. History: when
 * this path wrote to ClickHouse the same tolerance came from
 * `input_format_skip_unknown_fields` (CLAUDE.md gotcha #21) rather than from
 * a fixed column list.
 */
const REQUEST_COLUMNS = [
  'id',
  'organization_id',
  'project_id',
  'api_key_id',
  'provider',
  'model',
  'prompt_tokens',
  'completion_tokens',
  'total_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
  'cost_usd',
  'latency_ms',
  'proxy_overhead_ms',
  'status_code',
  'request_body',
  'response_body',
  'error_message',
  'trace_id',
  'span_id',
  'prompt_version_id',
  'provider_key_id',
  'user_id',
  'session_id',
  'flags',
  'response_flags',
  'has_security_flags',
  'truncated',
  'cache_hit',
  'service_tier',
  'created_at',
] as const

/**
 * What the NOT NULL columns fall back to when a queued payload predates the
 * field. These are the column DEFAULTs from
 * 20260820100000_requests_postgres_restore.sql; without them a single
 * incomplete row would fail the whole batch and block every row queued
 * behind it.
 */
const REQUEST_COLUMN_DEFAULTS: Readonly<Record<string, unknown>> = {
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  latency_ms: 0,
  status_code: 0,
  request_body: '',
  response_body: '',
  flags: '[]',
  response_flags: '[]',
  has_security_flags: false,
  truncated: false,
  cache_hit: false,
  service_tier: '',
}

/**
 * Builds the multi-row INSERT for one replay batch.
 *
 * Every value is bound: the SQL text carries only column names and generated
 * placeholder names (`{v0_id}`, `{v1_id}`, …), never anything read out of the
 * queue. `ON CONFLICT (created_at, id) DO NOTHING` is the idempotency
 * guarantee — a batch that already landed before its queue DELETE blipped
 * replays as a no-op, enforced by the primary key rather than by a read-back.
 *
 * Exported for tests: a mistake in the placeholder naming still produces
 * valid SQL, it just binds the wrong row's value to a column.
 */
export function buildReplayInsert(payloads: ReadonlyArray<Record<string, unknown>>): {
  query: string
  params: Record<string, unknown>
} {
  const params: Record<string, unknown> = {}
  const rows = payloads.map((payload, index) => {
    const placeholders = REQUEST_COLUMNS.map((column) => {
      const name = `v${index}_${column}`
      const raw = payload[column]
      params[name] =
        raw === undefined || raw === null ? REQUEST_COLUMN_DEFAULTS[column] ?? null : raw
      return `{${name}}`
    })
    return `(${placeholders.join(', ')})`
  })

  return {
    query:
      `INSERT INTO requests (${REQUEST_COLUMNS.join(', ')}) VALUES ${rows.join(', ')} ` +
      'ON CONFLICT (created_at, id) DO NOTHING',
    params,
  }
}

/**
 * Drain a batch from `requests_fallback` into the `requests` table. Designed
 * to be called from the `/cron/replay-fallback` endpoint every 5 minutes;
 * safe to call by hand from a script.
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

  // 3. Bulk INSERT the entire batch as one multi-row statement — one round
  //    trip for the whole batch instead of N.
  try {
    // 3a. Idempotency lives in the statement itself: `ON CONFLICT
    //     (created_at, id) DO NOTHING` (see buildReplayInsert). If a prior run
    //     inserted the batch but its queue DELETE blipped, replaying the same
    //     payloads is a no-op rather than a duplicate that would inflate cost
    //     and quota usage. History: while `requests` lived in ClickHouse this
    //     path had to read the ids back first and filter client-side, because
    //     a MergeTree has no unique constraint to lean on. Postgres does, so
    //     the read-back is gone.
    const payloads = rows.map((r) => r.payload as Record<string, unknown>)

    if (payloads.length > 0) {
      const { query, params } = buildReplayInsert(payloads)
      await pgExecute({ query, params })
    }
    // 4. Success — delete the WHOLE batch in one DELETE. Rows the ON CONFLICT
    //    skipped are already in `requests`, so they must leave the queue too.
    //    If this DELETE blips, the next run re-reads them and the ON CONFLICT
    //    makes the re-INSERT a no-op, so the queue still drains without
    //    duplicating data.
    const ids = rows.map((r) => r.id as string)
    await supabaseAdmin.from('requests_fallback').delete().in('id', ids)
    result.replayed = rows.length
  } catch (err) {
    // 5. Batch INSERT failed — most likely the database is still unreachable.
    //    Bump retry_count on every row in the batch so eventual expiry kicks
    //    in for poison payloads, while not blocking newer rows.
    const message = err instanceof Error ? err.message : String(err)
    result.failed = rows.length
    result.error = `requests insert failed: ${message.slice(0, 300)}`

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
 * Backlog size (rows) above which a sustained queue raises an operator alert.
 * The replayer drains REPLAY_BATCH_SIZE (50) rows per 5-minute run, so a
 * four-figure backlog means the `requests` INSERT has been failing long
 * enough that rows are accumulating faster than they drain, and the oldest
 * of them are heading for the 7-day expiry above (silent data loss). Matches
 * the ">1000 is abnormal" guidance in CLAUDE.md gotcha #23.
 */
export const BACKLOG_ALERT_THRESHOLD = 1000

export interface BacklogAlertResult {
  requestsQueue: number | null
  /** True when this call inserted a new internal_alerts row. */
  alerted: boolean
}

/**
 * Raises an `internal_alerts` row (kind `fallback_queue_high`, already declared
 * in migration 20260609110000_internal_alerts.sql) when the fallback queue
 * exceeds `threshold`. Surfaced to operators at /admin/alerts.
 *
 * Deduplicated: if an UNRESOLVED `fallback_queue_high` alert is already open,
 * no new row is inserted. The replay cron runs every 5 minutes, so without this
 * guard a multi-hour outage of the log store would insert a fresh alert every
 * run. The operator resolves it from /admin/alerts once the backlog has
 * drained.
 *
 * Never throws — backlog monitoring must not break the replay cron itself.
 * A null queue size (the size query failed) is treated as 0 so a transient
 * Supabase blip does not page; the rows missing from `requests` are the real
 * signal and surface via the logger's insert-failure logs.
 */
export async function alertOnFallbackBacklog(
  threshold: number = BACKLOG_ALERT_THRESHOLD,
): Promise<BacklogAlertResult> {
  const requestsQueue = await fallbackQueueSize()

  if ((requestsQueue ?? 0) <= threshold) return { requestsQueue, alerted: false }

  try {
    // Dedup against an already-open alert of the same kind.
    const { data: existing } = await supabaseAdmin
      .from('internal_alerts')
      .select('id')
      .eq('kind', 'fallback_queue_high')
      .is('resolved_at', null)
      .limit(1)
      .maybeSingle()
    if (existing) return { requestsQueue, alerted: false }

    await supabaseAdmin.from('internal_alerts').insert({
      kind: 'fallback_queue_high',
      severity: 'error',
      message:
        `Fallback queue backlog over ${threshold} ` +
        `(requests=${requestsQueue ?? 'unknown'}). ` +
        `The requests INSERT is failing — queued rows expire after ${MAX_AGE_DAYS} days.`,
      details: { requestsQueue, threshold },
    })
    return { requestsQueue, alerted: true }
  } catch {
    // Best-effort: a monitoring failure must not break the replay cron.
    return { requestsQueue, alerted: false }
  }
}
