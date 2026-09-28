// ─────────────────────────────────────────────────────────────────────────────
// Auto-downgrade orchestration for past-due subscriptions (P2.7).
//
// Lifecycle (driven by /cron/check-past-due-downgrades daily):
//
//   t = 0  →  Paddle webhook flips subscriptions.status to past_due and
//             stamps `past_due_since` (the start of this delinquency cycle).
//
//   t = 4d →  Cron queues + sends the D-3 warning email.
//   t = 6d →  Cron queues + sends the D-1 warning email.
//   t = 7d →  Cron calls `apply_past_due_downgrade`, which in ONE transaction
//             re-checks the subscription is still past due in the same cycle,
//             recomputes organizations.plan from the org's live subscriptions
//             (free if none), writes audit_logs, closes the cycle
//             (past_due_since = NULL) and queues the downgrade email.
//             Recovery clears past_due_since in the webhook, so a later
//             failure opens a new cycle and starts over.
//
// Retention impact: `quota.ts` already enforces 14-day retention for the
// Free plan via `requestsScope`, so the dashboard tightens automatically
// the moment the plan flips — no extra wiring needed.
//
// Idempotency (quality audit 2026-09-28, C3.2): `billing_downgrade_notifications`
// is UNIQUE (subscription_id, stage, cycle_started_at), so a cron re-run is a
// no-op within a cycle and a new cycle is not blocked by the previous one.
// The same table is the email outbox: a row is marked 'sent' only after the
// provider accepted the email (lib/billing-downgrade-outbox.ts). A failed
// downgrade RPC changes nothing and is retried on the next run.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from './db.js'
import { drainDowngradeNotifications } from './billing-downgrade-outbox.js'
import { logError } from './structured-logger.js'

const DAY_MS = 24 * 60 * 60 * 1000
const DOWNGRADE_AFTER_DAYS = 7
const WARNING_D3_DAY = 4 // 7 - 3
const WARNING_D1_DAY = 6 // 7 - 1

/** Subscription statuses whose delinquency cycle the cron still owns. */
const DELINQUENT_STATUSES = ['past_due', 'paused']

export type DowngradeStage = 'warning-d3' | 'warning-d1' | 'downgraded'

export interface DowngradeRunResult {
  scanned: number
  /** D-3 warning emails the provider accepted this run. */
  warningsD3: number
  /** D-1 warning emails the provider accepted this run. */
  warningsD1: number
  /** Delinquent entitlements removed this run (plan recomputed). */
  downgraded: number
  /** Downgrade notice emails the provider accepted this run. */
  downgradeNoticesSent: number
  /** Stage already queued for this delinquency cycle (cron re-run). */
  emailsSkipped: number
  /** Subscription recovered or changed before the downgrade applied. */
  staleSkipped: number
  /** Sends that failed; the outbox retries them on a later run. */
  emailsFailed: number
  errors: string[]
}

interface PastDueRow {
  id: string
  organization_id: string
  /** Raw timestamptz string: passed back verbatim for the CAS. */
  past_due_since: string
  paddle_subscription_id: string | null
}

function emptyResult(): DowngradeRunResult {
  return {
    scanned: 0,
    warningsD3: 0,
    warningsD1: 0,
    downgraded: 0,
    downgradeNoticesSent: 0,
    emailsSkipped: 0,
    staleSkipped: 0,
    emailsFailed: 0,
    errors: [],
  }
}

/**
 * Top-level entry point called by the cron. Advances every delinquent
 * subscription one stage, then drains the email outbox. Per-row errors don't
 * abort the run; they are collected so the cron records the run as failed.
 */
export async function runDowngradeCheck(now: Date = new Date()): Promise<DowngradeRunResult> {
  const result = emptyResult()

  const { data: rows, error } = await supabaseAdmin
    .from('subscriptions')
    .select('id, organization_id, past_due_since, paddle_subscription_id')
    .not('past_due_since', 'is', null)
    .in('status', DELINQUENT_STATUSES)

  if (error) {
    result.errors.push(`select past_due rows failed: ${error.message}`)
  } else {
    const pastDueRows = (rows ?? []) as PastDueRow[]
    result.scanned = pastDueRows.length
    for (const row of pastDueRows) {
      try {
        await advanceRow(row, now, result)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logError('CRON_PARTIAL_FAILURE', {
          jobName: 'check-past-due-downgrades',
          orgId: row.organization_id,
          subscriptionId: row.id,
        }, err)
        result.errors.push(`org ${row.organization_id}: ${message}`)
      }
    }
  }

  // Runs even when the scan failed: queued emails from earlier runs (a
  // downgrade notice whose subscription left the scan) still go out.
  await drainDowngradeNotifications(now, result)
  return result
}

// ── Internals ─────────────────────────────────────────────────────────────────

function daysSince(iso: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / DAY_MS)
}

async function advanceRow(row: PastDueRow, now: Date, result: DowngradeRunResult): Promise<void> {
  const daysOverdue = daysSince(row.past_due_since, now)

  if (daysOverdue >= DOWNGRADE_AFTER_DAYS) {
    const outcome = await applyDowngrade(row)
    if (outcome === 'downgraded') result.downgraded += 1
    else result.staleSkipped += 1
    return
  }

  const stage: DowngradeStage | null =
    daysOverdue >= WARNING_D1_DAY ? 'warning-d1'
      : daysOverdue >= WARNING_D3_DAY ? 'warning-d3'
        : null
  if (!stage) return

  const queued = await queueStageEmail(row, stage)
  if (!queued) result.emailsSkipped += 1
}

/**
 * Queue a warning for this delinquency cycle. Returns false when it was
 * already queued (23505: cron re-run). Any other failure throws, so the row
 * is reported instead of silently skipped.
 */
async function queueStageEmail(row: PastDueRow, stage: DowngradeStage): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('billing_downgrade_notifications')
    .insert({ subscription_id: row.id, stage, cycle_started_at: row.past_due_since })
  if (!error) return true
  if ((error as { code?: string }).code === '23505') return false
  throw new Error(`queue ${stage} failed: ${error.message}`)
}

/**
 * The downgrade itself is one SQL function (migration 20260929110200), so the
 * plan change, the cycle close, the audit row and the email enqueue commit
 * together. A `{ error }` means nothing changed: throw, and the next run
 * retries with the same cycle start.
 */
async function applyDowngrade(row: PastDueRow): Promise<'downgraded' | 'stale'> {
  const { data, error } = await supabaseAdmin.rpc('apply_past_due_downgrade', {
    p_subscription_id: row.id,
    p_past_due_since: row.past_due_since,
  })
  if (error) throw new Error(`downgrade failed: ${error.message}`)
  return (data as { outcome?: string } | null)?.outcome === 'downgraded' ? 'downgraded' : 'stale'
}
