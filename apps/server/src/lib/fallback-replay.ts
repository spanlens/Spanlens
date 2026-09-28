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
//   • Order: `retry_count ASC, created_at ASC`. Rows that have never failed
//     on their own data drain FIFO, so a long outage drains in the order
//     traffic happened; a row the database keeps rejecting sinks behind
//     them instead of occupying the head of every batch.
//   • Bulk INSERT: one multi-row statement per batch, not one per row, so
//     a healthy batch costs one round trip instead of N.
//   • Failure semantics depend on WHO failed (see isRowDataError):
//       - The database (unreachable, timeout, schema behind the code): the
//         batch stays queued as is and nobody's retry budget is spent. An
//         outage is not the rows' fault, and spending retries on it let a
//         long one (or three schedulers firing at once, gotcha #32) delete
//         perfectly good rows at the 100-retry mark.
//       - A row's own data (a deleted org's foreign key, a NOT NULL the
//         payload lacks): one such row used to fail the whole multi-row
//         statement, every run, and hold the entire queue behind it. The
//         batch is now retried row by row, the good rows land, and only the
//         rejected row gets retry_count++.
//   • Retention: rows older than 7 days OR with retry_count ≥ 100 are
//     dropped. retry_count only counts rejections of the row itself, so
//     the 100 cap reaches poison rows and nothing else.
//   • After rows land: the org activity watermark is stamped (crons gated on
//     it would otherwise not see replayed rows until the org's next live
//     request, gotcha #38) and request.created is fired for each row this run
//     inserted. lib/logger.ts leaves that event to this module for a queued
//     row, so a subscriber is never told about an id that is not readable.
//   • No cron-cadence debounce on the handler, deliberately: the statement is
//     idempotent (ON CONFLICT), and with outages no longer spending retries,
//     extra runs from the redundant schedulers only drain a backlog faster.
// ─────────────────────────────────────────────────────────────────────────────

import { pgQuery } from './postgres.js'
import { supabaseAdmin } from './db.js'
import { emitRequestCreated } from './logger.js'
import { recordOrgActivity } from './org-activity.js'
import { logError } from './structured-logger.js'

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
 * `RETURNING id` then names only the rows this statement inserted, which is
 * what request.created is fired for (a conflict-skipped row was announced by
 * the run that inserted it).
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
      'ON CONFLICT (created_at, id) DO NOTHING RETURNING id',
    params,
  }
}

/** One `requests_fallback` row, as the replay reads it. */
interface QueueRow {
  id: string
  payload: Record<string, unknown>
  retry_count: number
}

/**
 * SQLSTATE classes that describe the row's own data: 22 (data exception, a
 * value of the wrong type or out of range) and 23 (integrity constraint, a
 * foreign key, NOT NULL or CHECK the payload violates). Sending the same
 * payload again can never succeed.
 *
 * Everything else is about the database rather than the row and clears on
 * its own: no SQLSTATE at all (connection refused, pool timeout, a dropped
 * socket), 08 (connection), 53 (resources), 57 (statement timeout,
 * shutdown), 40 (serialization), and 42, which is what a column the deployed
 * schema does not have yet raises. That last one matters: surviving a deploy
 * that beat its migration is what this queue is for (CLAUDE.md gotcha #21).
 */
const ROW_DATA_SQLSTATE_CLASSES = new Set(['22', '23'])

function isRowDataError(err: unknown): boolean {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined
  return (
    typeof code === 'string' &&
    /^[0-9A-Z]{5}$/.test(code) &&
    ROW_DATA_SQLSTATE_CLASSES.has(code.slice(0, 2))
  )
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Inserts the payloads; returns the payload ids the statement actually inserted. */
async function insertPayloads(
  payloads: ReadonlyArray<Record<string, unknown>>,
): Promise<ReadonlySet<string>> {
  const { query, params } = buildReplayInsert(payloads)
  const inserted = await pgQuery<{ id: string }>({ query, params })
  return new Set(inserted.map((r) => String(r.id)))
}

/** What happened to each row of one batch. */
interface BatchOutcome {
  /** Rows whose payload is in `requests` now (inserted this run or earlier). */
  landed: QueueRow[]
  /** Payloads this run actually inserted: the ones to announce. */
  inserted: Array<Record<string, unknown>>
  /** Rows the database rejected for their own data, with the reason. */
  rejected: Array<{ row: QueueRow; message: string }>
  /** Rows left as they are because the database itself was failing. */
  deferred: QueueRow[]
  /** Why the database failed, when it did. */
  deferredReason: string | null
}

function insertedPayloads(
  rows: readonly QueueRow[],
  insertedIds: ReadonlySet<string>,
): Array<Record<string, unknown>> {
  return rows.map((r) => r.payload).filter((p) => insertedIds.has(String(p['id'])))
}

/**
 * Retries a batch one row at a time, after the multi-row statement failed on
 * some row's data. Stops at the first failure that is not about a row: once
 * the database itself is failing, the remaining rows would only fail too.
 */
async function replayRowByRow(rows: readonly QueueRow[]): Promise<BatchOutcome> {
  const landed: QueueRow[] = []
  const inserted: Array<Record<string, unknown>> = []
  const rejected: Array<{ row: QueueRow; message: string }> = []

  for (const [index, row] of rows.entries()) {
    try {
      const ids = await insertPayloads([row.payload])
      landed.push(row)
      inserted.push(...insertedPayloads([row], ids))
    } catch (err) {
      if (!isRowDataError(err)) {
        return {
          landed,
          inserted,
          rejected,
          deferred: rows.slice(index),
          deferredReason: errorMessage(err),
        }
      }
      rejected.push({ row, message: errorMessage(err) })
    }
  }
  return { landed, inserted, rejected, deferred: [], deferredReason: null }
}

async function replayBatch(rows: readonly QueueRow[]): Promise<BatchOutcome> {
  try {
    const ids = await insertPayloads(rows.map((r) => r.payload))
    return {
      landed: [...rows],
      inserted: insertedPayloads(rows, ids),
      rejected: [],
      deferred: [],
      deferredReason: null,
    }
  } catch (err) {
    if (!isRowDataError(err)) {
      return {
        landed: [],
        inserted: [],
        rejected: [],
        deferred: [...rows],
        deferredReason: errorMessage(err),
      }
    }
    // A single-row batch already told us which row it was.
    if (rows.length === 1) {
      return {
        landed: [],
        inserted: [],
        rejected: [{ row: rows[0]!, message: errorMessage(err) }],
        deferred: [],
        deferredReason: null,
      }
    }
    return replayRowByRow(rows)
  }
}

function logReplayWrite(kind: string, error: unknown, extra: Record<string, unknown> = {}): void {
  logError('CRON_PARTIAL_FAILURE', { jobName: 'replay-fallback', kind, ...extra }, error)
}

/** Drops rows past the age or retry limit. Returns how many went. */
async function expireStaleRows(): Promise<number> {
  const expiry = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { count, error } = await supabaseAdmin
    .from('requests_fallback')
    .delete({ count: 'exact' })
    .or(`created_at.lt.${expiry},retry_count.gte.${MAX_RETRY_COUNT}`)
  if (error) {
    logReplayWrite('fallback_expiry_failed', error)
    return 0
  }
  return count ?? 0
}

/**
 * Removes landed rows from the queue. A failure here is harmless for the
 * data (the next run re-reads the rows and ON CONFLICT makes the re-insert a
 * no-op) but it is logged so a persistently failing DELETE is visible.
 */
async function dequeue(rows: readonly QueueRow[]): Promise<void> {
  if (rows.length === 0) return
  const { error } = await supabaseAdmin
    .from('requests_fallback')
    .delete()
    .in('id', rows.map((r) => r.id))
  if (error) logReplayWrite('fallback_dequeue_failed', error, { rows: rows.length })
}

/** Spends one retry on each row the database rejected for its own data. */
async function recordRejections(rejected: BatchOutcome['rejected']): Promise<void> {
  const now = new Date().toISOString()
  for (const { row, message } of rejected) {
    const { error } = await supabaseAdmin
      .from('requests_fallback')
      .update({
        retry_count: row.retry_count + 1,
        last_retry_at: now,
        last_error: message.slice(0, 500),
      })
      .eq('id', row.id)
    if (error) logReplayWrite('fallback_retry_update_failed', error, { queueRowId: row.id })
  }
}

/**
 * Notes why deferred rows were not replayed, without touching retry_count:
 * the failure was the database's, not theirs. One statement for the lot,
 * since every row carries the same reason.
 */
async function recordDeferral(rows: readonly QueueRow[], reason: string): Promise<void> {
  if (rows.length === 0) return
  const { error } = await supabaseAdmin
    .from('requests_fallback')
    .update({ last_retry_at: new Date().toISOString(), last_error: reason.slice(0, 500) })
    .in('id', rows.map((r) => r.id))
  if (error) logReplayWrite('fallback_retry_update_failed', error, { rows: rows.length })
}

/**
 * Follow-up for rows this run inserted: stamp each organization's activity
 * watermark so the crons gated on it (quota, budget and error-rate alerts)
 * see the replayed rows now instead of at the org's next live request, and
 * announce each row with request.created. Both helpers never throw.
 */
async function announceInserted(inserted: ReadonlyArray<Record<string, unknown>>): Promise<void> {
  const orgIds = new Set(inserted.map((p) => String(p['organization_id'] ?? '')).filter((id) => id !== ''))
  for (const orgId of orgIds) await recordOrgActivity(orgId)
  for (const payload of inserted) await emitRequestCreated(payload)
}

function summarizeFailure(outcome: BatchOutcome): string | undefined {
  if (outcome.deferredReason !== null) {
    return `requests insert failed: ${outcome.deferredReason.slice(0, 300)}`
  }
  const first = outcome.rejected[0]
  if (first) {
    return `requests insert rejected ${outcome.rejected.length} row(s): ${first.message.slice(0, 300)}`
  }
  return undefined
}

/**
 * Drain a batch from `requests_fallback` into the `requests` table. Designed
 * to be called from the `/cron/replay-fallback` endpoint every 5 minutes;
 * safe to call by hand from a script.
 */
export async function replayFallbackQueue(): Promise<ReplayResult> {
  // 1. Expire old / stuck rows BEFORE attempting replay so the limited
  //    batch budget goes to fresh queue entries first.
  const expired = await expireStaleRows()

  // 2. Pull the next batch: rows that have not been rejected for their own
  //    data first, FIFO within that. See the design notes at the top.
  const { data, error: selectError } = await supabaseAdmin
    .from('requests_fallback')
    .select('id, payload, retry_count')
    .order('retry_count', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(REPLAY_BATCH_SIZE)

  if (selectError) {
    return { attempted: 0, replayed: 0, failed: 0, expired, error: `select failed: ${selectError.message}` }
  }
  const rows = (data ?? []) as QueueRow[]
  if (rows.length === 0) {
    return { attempted: 0, replayed: 0, failed: 0, expired }
  }

  // 3. One multi-row statement for the batch; row by row only when some row's
  //    data sank it. Idempotency lives in the statement itself (ON CONFLICT,
  //    see buildReplayInsert), so a batch that landed before its queue DELETE
  //    blipped replays as a no-op rather than a duplicate that would inflate
  //    cost and quota usage.
  const outcome = await replayBatch(rows)

  // 4. Landed rows leave the queue, including any the conflict skipped: those
  //    are in `requests` already.
  await dequeue(outcome.landed)
  await announceInserted(outcome.inserted)

  // 5. Failed rows stay queued. Only a rejection of the row itself spends a
  //    retry.
  await recordRejections(outcome.rejected)
  await recordDeferral(outcome.deferred, outcome.deferredReason ?? '')

  const error = summarizeFailure(outcome)
  return {
    attempted: rows.length,
    replayed: outcome.landed.length,
    failed: outcome.rejected.length + outcome.deferred.length,
    expired,
    ...(error ? { error } : {}),
  }
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
    // Dedup against an already-open alert of the same kind. If the lookup
    // itself fails, skip the insert: without it every 5-minute run would add
    // another alert row, and the backlog stays visible through /health/deep.
    const { data: existing, error: dedupError } = await supabaseAdmin
      .from('internal_alerts')
      .select('id')
      .eq('kind', 'fallback_queue_high')
      .is('resolved_at', null)
      .limit(1)
      .maybeSingle()
    if (dedupError) {
      logReplayWrite('fallback_backlog_alert_failed', dedupError, { step: 'dedup' })
      return { requestsQueue, alerted: false }
    }
    if (existing) return { requestsQueue, alerted: false }

    const { error: insertError } = await supabaseAdmin.from('internal_alerts').insert({
      kind: 'fallback_queue_high',
      severity: 'error',
      message:
        `Fallback queue backlog over ${threshold} ` +
        `(requests=${requestsQueue ?? 'unknown'}). ` +
        `The requests INSERT is failing — queued rows expire after ${MAX_AGE_DAYS} days.`,
      details: { requestsQueue, threshold },
    })
    if (insertError) {
      logReplayWrite('fallback_backlog_alert_failed', insertError, { step: 'insert' })
      return { requestsQueue, alerted: false }
    }
    return { requestsQueue, alerted: true }
  } catch (err) {
    // Best-effort: a monitoring failure must not break the replay cron.
    logReplayWrite('fallback_backlog_alert_failed', err)
    return { requestsQueue, alerted: false }
  }
}
