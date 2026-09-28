/**
 * Post-period passes for Paddle overage billing (quality audit 2026-09-28, C4.3).
 *
 * Settlement (true-up): the provisional charge runs in the 48 hours before
 * period_end on a daily cron, so it counts usage up to that run and never
 * the last 24-48 hours of the period. Once a period has closed (plus a short
 * delay for late log rows), recount its final usage and charge only the
 * difference to what the period's rows have already charged. The true-up is
 * a second ledger row (kind 'true_up') under the same UNIQUE key scheme, so
 * it happens at most once per period. A period with any unresolved row
 * (pending, error, retry, needs_reconciliation, or 'charged' without a
 * charged_quantity) is left alone: charging on top of an unknown outcome is
 * how customers get billed twice.
 *
 * Retry: rows an operator flipped to 'retry' are claimed with a
 * compare-and-set (retry → pending) and re-attempted for their remaining
 * quantity. This is the path the original migration documented and no code
 * implemented.
 */

import { supabaseAdmin } from './db.js'
import { MONTHLY_REQUEST_LIMITS, countMonthlyRequests } from './quota.js'
import {
  LEDGER_SELECT,
  chargeAndRecord,
  insertLedgerRow,
  overageFor,
  toLedgerRow,
  unsettledReason,
  type LedgerRow,
  type OverageReport,
} from './paddle-overage-ledger.js'

const HOUR_MS = 3600_000
/** Let late-arriving log rows (fallback replay, clock skew) land first. */
export const SETTLEMENT_DELAY_MS = 2 * HOUR_MS
/** Closed periods older than this are left to an operator. */
export const SETTLEMENT_LOOKBACK_MS = 7 * 24 * HOUR_MS

const TABLE = 'subscription_overage_charges'

function baseReport(row: LedgerRow, phase: OverageReport['phase']): OverageReport {
  return {
    organization_id: row.subscriptions?.organization_id ?? '',
    paddle_subscription_id: row.subscriptions?.paddle_subscription_id ?? '',
    plan: row.subscriptions?.plan ?? 'free',
    period_start: row.period_start,
    period_end: row.period_end,
    included: row.included_requests ?? 0,
    used: 0,
    overage_requests: row.overage_requests,
    overage_quantity: row.overage_quantity,
    phase,
    status: 'error',
  }
}

async function readLedger(
  pass: string,
  query: PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<LedgerRow[]> {
  const { data, error } = await query
  if (error) throw new Error(`${pass} pass: ledger read failed: ${error.message}`)
  return ((data ?? []) as unknown[]).map(toLedgerRow)
}

// ── Settlement ────────────────────────────────────────────────────────────

function groupByPeriod(rows: LedgerRow[]): LedgerRow[][] {
  const groups = new Map<string, LedgerRow[]>()
  for (const row of rows) {
    const key = `${row.subscription_id}|${Date.parse(row.period_end)}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups.values()]
}

async function settlePeriod(rows: LedgerRow[]): Promise<OverageReport | null> {
  if (rows.some((r) => r.kind === 'true_up')) return null // already settled
  const provisional = rows.find((r) => r.kind === 'provisional')
  if (!provisional) return null
  const report = baseReport(provisional, 'settlement')
  const sub = provisional.subscriptions
  if (!sub) return { ...report, error: 'subscription row missing' }

  const unsettled = unsettledReason(provisional)
  if (unsettled) {
    return { ...report, status: 'skipped_unsettled', error: `provisional ${unsettled}` }
  }

  const included = provisional.included_requests ?? MONTHLY_REQUEST_LIMITS[sub.plan] ?? 0
  let used: number
  try {
    used = await countMonthlyRequests(
      sub.organization_id,
      new Date(provisional.period_start),
      new Date(provisional.period_end),
    )
  } catch (err) {
    return { ...report, included, error: `count failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  const { overageRequests, quantity: finalQuantity } = overageFor(used, included)
  const alreadyCharged = rows.reduce((sum, r) => sum + r.charged_quantity, 0)
  const delta = finalQuantity - alreadyCharged
  const measured = { ...report, included, used, overage_requests: overageRequests, overage_quantity: Math.max(0, delta) }

  const inserted = await insertLedgerRow({
    subscriptionId: provisional.subscription_id,
    kind: 'true_up',
    periodStart: provisional.period_start,
    periodEnd: provisional.period_end,
    includedRequests: included,
    overageRequests,
    quantity: Math.max(0, delta),
    priceId: provisional.price_id,
    status: delta > 0 ? 'pending' : 'no_charge',
  })
  if (inserted.kind === 'duplicate') return { ...measured, status: 'skipped_already_charged' }
  if (inserted.kind === 'failed') return { ...measured, error: inserted.error }
  if (delta <= 0) return { ...measured, status: 'no_charge' }

  const outcome = await chargeAndRecord({
    rowId: inserted.id,
    orgId: sub.organization_id,
    paddleSubscriptionId: sub.paddle_subscription_id,
    priceId: provisional.price_id,
    quantity: delta,
    alreadyCharged: 0,
  })
  return { ...measured, status: outcome.status, ...(outcome.error ? { error: outcome.error } : {}) }
}

export async function settleClosedPeriods(now: Date): Promise<OverageReport[]> {
  const rows = await readLedger(
    'settlement',
    supabaseAdmin
      .from(TABLE)
      .select(LEDGER_SELECT)
      .lte('period_end', new Date(now.getTime() - SETTLEMENT_DELAY_MS).toISOString())
      .gt('period_end', new Date(now.getTime() - SETTLEMENT_LOOKBACK_MS).toISOString()),
  )
  const reports: OverageReport[] = []
  for (const group of groupByPeriod(rows)) {
    const report = await settlePeriod(group)
    if (report) reports.push(report)
  }
  return reports
}

// ── Operator-flagged retries ──────────────────────────────────────────────

async function claimRetry(row: LedgerRow): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({ status: 'pending', error_message: null })
    .eq('id', row.id)
    .eq('status', 'retry')
    .select('id')
  if (error) throw new Error(`retry claim failed: ${error.message}`)
  return ((data ?? []) as unknown[]).length === 1
}

async function retryRow(row: LedgerRow): Promise<OverageReport | null> {
  const report = baseReport(row, 'retry')
  const sub = row.subscriptions
  if (!sub) return { ...report, error: 'subscription row missing' }
  if (!(await claimRetry(row))) return null // another run took it

  const remaining = row.overage_quantity - row.charged_quantity
  if (remaining <= 0) {
    const { error } = await supabaseAdmin
      .from(TABLE)
      .update({ status: 'charged', completed_at: new Date().toISOString() })
      .eq('id', row.id)
    return error
      ? { ...report, status: 'needs_reconciliation', error: `ledger update failed: ${error.message}` }
      : { ...report, status: 'charged', overage_quantity: 0 }
  }

  const outcome = await chargeAndRecord({
    rowId: row.id,
    orgId: sub.organization_id,
    paddleSubscriptionId: sub.paddle_subscription_id,
    priceId: row.price_id,
    quantity: remaining,
    alreadyCharged: row.charged_quantity,
  })
  return {
    ...report,
    overage_quantity: remaining,
    status: outcome.status,
    ...(outcome.error ? { error: outcome.error } : {}),
  }
}

export async function retryFlaggedCharges(): Promise<OverageReport[]> {
  const rows = await readLedger('retry', supabaseAdmin.from(TABLE).select(LEDGER_SELECT).eq('status', 'retry'))
  const reports: OverageReport[] = []
  for (const row of rows) {
    try {
      const report = await retryRow(row)
      if (report) reports.push(report)
    } catch (err) {
      reports.push({ ...baseReport(row, 'retry'), error: err instanceof Error ? err.message : String(err) })
    }
  }
  return reports
}
