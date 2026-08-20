import { pgQuery, pgExecute, pgTransaction } from '../postgres.js'
import { supabaseAdmin } from '../db.js'
import { logError } from '../structured-logger.js'
import { LOG_RETENTION_DAYS } from '../quota.js'

/**
 * Keeps the `requests` table's monthly partitions healthy.
 *
 * Two jobs in one pass, because they share the same knowledge of the naming
 * scheme and both run monthly:
 *
 *   1. Create partitions ahead of time. `ensure_requests_partitions()` builds
 *      the current month plus the next few. A partition that does not exist
 *      when a row arrives is not a soft failure: the row lands in
 *      `requests_default`, and from that moment on, creating the real
 *      partition for that range FAILS. Postgres has to scan the default
 *      partition under ACCESS EXCLUSIVE to prove no row conflicts, which
 *      blocks the proxy's inserts while it runs. Recovering means detaching
 *      the default, moving rows, and reattaching.
 *
 *      This is why the job builds several months rather than just next
 *      month. Vercel's scheduler has gone days without firing before
 *      (CLAUDE.md gotcha #32), and one missed run should cost nothing.
 *
 *   2. Drop partitions past the retention ceiling. This is the hard-delete
 *      half of the retention policy: the per-plan windows (free 14 days, pro
 *      90, team 365) are applied at query time by `requestsScope`, but the
 *      rows themselves live until their whole month falls outside the
 *      longest plan's window. Dropping the partition is O(1) and leaves no
 *      dead tuples behind, which a bulk DELETE would.
 *
 * Both halves are reported separately so a partial failure is visible. The
 * job returns rather than throws on the drop half: failing to reclaim old
 * space is an operational annoyance, while failing to create next month's
 * partition is an outage in waiting, and the caller should be able to tell
 * those apart.
 */

/** How many months of empty partitions to keep ready ahead of now. */
const MONTHS_AHEAD = 3

/**
 * Rows survive until the whole month is older than the longest retention
 * any plan grants. Deriving it from `LOG_RETENTION_DAYS` rather than
 * hardcoding 365 means a new, longer plan tier cannot silently start losing
 * data it was sold.
 */
const RETENTION_DAYS = Math.max(...Object.values(LOG_RETENTION_DAYS))

export interface PartitionMaintenanceResult {
  /** Partitions that did not exist before this run and were created. */
  created: string[]
  /** Partitions dropped because their entire range is past retention. */
  dropped: string[]
  /** Rows sitting in the catch-all partition. Any value above zero is an incident. */
  defaultPartitionRows: number | null
  /** Set when partition creation failed. The serious half. */
  createError?: string
  /** Set when a drop failed. Old data lingers; nothing breaks. */
  dropError?: string
}

interface EnsureRow {
  partition_name: string
  created: boolean
}

interface PartitionRow {
  partition_name: string
}

interface CountRow {
  n: string | number
}

export async function maintainRequestPartitions(): Promise<PartitionMaintenanceResult> {
  const result: PartitionMaintenanceResult = {
    created: [],
    dropped: [],
    defaultPartitionRows: null,
  }

  // ── Create ahead ────────────────────────────────────────────────────────
  try {
    const rows = await pgQuery<EnsureRow & Record<string, unknown>>({
      query: 'SELECT partition_name, created FROM ensure_requests_partitions({months})',
      params: { months: MONTHS_AHEAD },
    })
    result.created = rows.filter((r) => r.created).map((r) => r.partition_name)
  } catch (err) {
    result.createError = err instanceof Error ? err.message : String(err)
    logError('PARTITION_MAINTENANCE_FAILED', { phase: 'create' }, err)
  }

  // ── Report on the catch-all ─────────────────────────────────────────────
  // Checked every run rather than only when creation fails, because rows can
  // land here during any window where the cron was silent, and the count is
  // the only signal that it happened.
  try {
    const rows = await pgQuery<CountRow & Record<string, unknown>>({
      query: 'SELECT count(*) AS n FROM ONLY requests_default',
    })
    result.defaultPartitionRows = Number(rows[0]?.n ?? 0)
    if (result.defaultPartitionRows > 0) {
      await raiseDefaultPartitionAlert(result.defaultPartitionRows)
    }
  } catch (err) {
    logError('PARTITION_MAINTENANCE_FAILED', { phase: 'default_count' }, err)
  }

  // ── Drop past retention ─────────────────────────────────────────────────
  try {
    // Partition names are `requests_YYYY_MM`. Comparing the parsed month
    // against the cutoff in SQL keeps the decision next to the catalog that
    // owns the truth, rather than reconstructing names in JS.
    const stale = await pgQuery<PartitionRow & Record<string, unknown>>({
      query: `
        SELECT c.relname AS partition_name
        FROM pg_class c
        JOIN pg_inherits i ON i.inhrelid = c.oid
        JOIN pg_class parent ON parent.oid = i.inhparent
        WHERE parent.relname = 'requests'
          AND c.relname ~ '^requests_[0-9]{4}_[0-9]{2}$'
          AND to_date(right(c.relname, 7), 'YYYY_MM')
              + interval '1 month'
              < now() - make_interval(days => {retentionDays})
        ORDER BY c.relname
      `,
      params: { retentionDays: RETENTION_DAYS },
    })

    for (const row of stale) {
      await detachPartition(row.partition_name)
      await pgExecute({ query: `DROP TABLE ${quoteIdent(row.partition_name)}` })
      result.dropped.push(row.partition_name)
    }
  } catch (err) {
    result.dropError = err instanceof Error ? err.message : String(err)
    logError('PARTITION_MAINTENANCE_FAILED', { phase: 'drop' }, err)
  }

  return result
}

/**
 * Detaches one partition without letting the operation turn into an outage.
 *
 * A plain `DETACH PARTITION` takes ACCESS EXCLUSIVE on the parent table. If a
 * long analytics query is holding a share lock at that moment, the detach
 * queues behind it, and then every later lock request queues behind the
 * detach, including the proxy's inserts. That is a lock convoy, and it is the
 * failure mode worth engineering around here.
 *
 * `DETACH CONCURRENTLY` avoids it, but it runs as two internal transactions
 * and Postgres refuses it inside a transaction block. Whether the statement
 * arrives in one depends on the connection path, and through a transaction
 * pooler that is not something to assume. So: try the concurrent form, and if
 * Postgres rejects it for that specific reason, fall back to a plain detach
 * with a short `lock_timeout`. Failing fast and retrying next run is strictly
 * better than blocking writes, and reclaiming a month of old rows a day late
 * costs nothing.
 */
async function detachPartition(name: string): Promise<void> {
  try {
    await pgExecute({ query: `ALTER TABLE requests DETACH PARTITION ${quoteIdent(name)} CONCURRENTLY` })
    return
  } catch (err) {
    // 25001 = ACTIVE_SQL_TRANSACTION. Anything else is a real failure.
    const code = (err as { code?: string } | null)?.code
    if (code !== '25001') throw err
  }

  // The lock timeout is the entire point of this fallback, so it has to
  // actually apply. `SET LOCAL` is only honoured inside a transaction block;
  // sent as a standalone statement it warns and does nothing, which would
  // leave the detach waiting indefinitely behind a long analytics query while
  // the proxy's inserts queued up behind it. Hence an explicit transaction.
  await pgTransaction(async (tx) => {
    await tx({ query: `SET LOCAL lock_timeout = '5s'` })
    await tx({ query: `ALTER TABLE requests DETACH PARTITION ${quoteIdent(name)}` })
  })
}

/**
 * Partition names come from `pg_class`, not from user input, so this is a
 * belt-and-braces measure rather than the primary defence. It exists because
 * the two statements above are the only place in the codebase that puts an
 * identifier into SQL text, and a reader should not have to work out whether
 * that is safe.
 */
function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`refusing to interpolate unexpected partition name: ${name}`)
  }
  return `"${name}"`
}

/**
 * Rows in the catch-all partition mean the creation job did not run in time.
 * Surfaced through the same `internal_alerts` path the fallback-queue backlog
 * uses, deduped against an unresolved alert of the same kind so a monthly
 * cron does not file a new row every run.
 */
async function raiseDefaultPartitionAlert(rows: number): Promise<void> {
  try {
    const { data: existing } = await supabaseAdmin
      .from('internal_alerts')
      .select('id')
      .eq('kind', 'requests_default_partition')
      .is('resolved_at', null)
      .limit(1)
      .maybeSingle()
    if (existing) return

    await supabaseAdmin.from('internal_alerts').insert({
      kind: 'requests_default_partition',
      severity: 'error',
      message:
        `${rows} request rows landed in requests_default, which means a monthly ` +
        `partition was missing when they arrived. Creating that partition will ` +
        `now fail until the rows are moved, and the attempt takes an exclusive ` +
        `lock that blocks proxy writes. See docs/plans/postgres-migration.md.`,
      details: { rows },
    })
  } catch (err) {
    logError('PARTITION_MAINTENANCE_FAILED', { phase: 'alert' }, err)
  }
}
