/**
 * Ledger helpers for Paddle overage billing (`subscription_overage_charges`),
 * shared by the provisional, settlement and retry passes in paddle-usage.ts.
 *
 * Every charge follows the same three steps (CLAUDE.md gotcha #7a):
 *   1. INSERT a `pending` row. Its UNIQUE (subscription_id, period_end, kind)
 *      key is the double-charge guard: a second run gets 23505 and stops.
 *   2. Call POST /subscriptions/{id}/charge.
 *   3. UPDATE the row to what Paddle said, and CHECK that update.
 *
 * Step 3 distinguishes three outcomes (quality audit 2026-09-28, C4.3):
 *   charged              — Paddle accepted; charged_quantity records it.
 *   error                — Paddle definitely did not charge (4xx, or we never
 *                          sent the request). Operator sets 'retry' to redo.
 *   needs_reconciliation — the outcome is unknown: the request may have been
 *                          processed (network error, timeout, 5xx), or Paddle
 *                          answered but the ledger update failed. Never
 *                          retried automatically, because retrying an unknown
 *                          charge is how customers get billed twice.
 */

import { supabaseAdmin } from './db.js'
import { chargeSubscription } from './paddle-charge.js'
import { logError } from './structured-logger.js'
import { UNITS_PER_QUANTITY } from './paddle-usage-stats.js'
import type { Plan } from './quota.js'

export type LedgerKind = 'provisional' | 'true_up'
export type LedgerStatus = 'pending' | 'charged' | 'error' | 'retry' | 'no_charge' | 'needs_reconciliation'

/** Statuses whose charged_quantity is final: the period can be trued up. */
export const SETTLED_STATUSES: ReadonlySet<string> = new Set<LedgerStatus>(['charged', 'no_charge'])

export interface OverageReport {
  organization_id: string
  paddle_subscription_id: string
  plan: Plan
  period_start: string
  period_end: string
  included: number
  used: number
  overage_requests: number
  overage_quantity: number
  /** provisional: in-window charge; settlement: post-period true-up; retry: operator-flagged row. */
  phase: 'provisional' | 'settlement' | 'retry'
  status:
    | 'skipped_not_in_window'
    | 'skipped_no_overage'
    | 'skipped_already_charged'
    | 'skipped_no_price'
    | 'skipped_unsettled'
    | 'no_charge'
    | 'charged'
    | 'needs_reconciliation'
    | 'error'
  error?: string
}

export const LEDGER_SELECT =
  'id, subscription_id, kind, status, period_start, period_end, overage_requests, ' +
  'overage_quantity, charged_quantity, price_id, included_requests, ' +
  'subscriptions(organization_id, paddle_subscription_id, plan)'

export interface LedgerRow {
  id: string
  subscription_id: string
  kind: LedgerKind
  status: LedgerStatus
  period_start: string
  period_end: string
  overage_requests: number
  overage_quantity: number
  charged_quantity: number
  price_id: string
  included_requests: number | null
  subscriptions: { organization_id: string; paddle_subscription_id: string; plan: Plan } | null
}

/** PostgREST returns a many-to-one embed as an object; accept an array too. */
export function toLedgerRow(raw: unknown): LedgerRow {
  const row = raw as Omit<LedgerRow, 'subscriptions'> & { subscriptions?: unknown }
  const rel = Array.isArray(row.subscriptions) ? row.subscriptions[0] : row.subscriptions
  return {
    ...row,
    charged_quantity: Number(row.charged_quantity ?? 0),
    overage_quantity: Number(row.overage_quantity ?? 0),
    subscriptions: (rel as LedgerRow['subscriptions'] | undefined) ?? null,
  }
}

export function overageFor(used: number, included: number): { overageRequests: number; quantity: number } {
  const overageRequests = Math.max(0, used - included)
  return { overageRequests, quantity: Math.ceil(overageRequests / UNITS_PER_QUANTITY) }
}

/**
 * True when Paddle may have processed the charge even though we did not get
 * a success: the request left and no definite answer came back.
 */
export function isAmbiguousChargeFailure(status: number): boolean {
  return status === 0 || status === 408 || status >= 500
}

export interface NewLedgerRow {
  subscriptionId: string
  kind: LedgerKind
  periodStart: string
  periodEnd: string
  includedRequests: number
  overageRequests: number
  /** Quantity this row will charge; 0 for a no_charge row. */
  quantity: number
  priceId: string
  status: 'pending' | 'no_charge'
}

export type InsertOutcome =
  | { kind: 'inserted'; id: string }
  | { kind: 'duplicate' }
  | { kind: 'failed'; error: string }

export async function insertLedgerRow(row: NewLedgerRow): Promise<InsertOutcome> {
  const { data, error } = await supabaseAdmin
    .from('subscription_overage_charges')
    .insert({
      subscription_id: row.subscriptionId,
      kind: row.kind,
      period_start: row.periodStart,
      period_end: row.periodEnd,
      included_requests: row.includedRequests,
      overage_requests: row.overageRequests,
      overage_quantity: row.quantity,
      charged_quantity: 0,
      price_id: row.priceId,
      status: row.status,
      ...(row.status === 'no_charge' ? { completed_at: new Date().toISOString() } : {}),
    })
    .select('id')
    .single()
  if (!error) return { kind: 'inserted', id: (data as { id: string }).id }
  if ((error as { code?: string }).code === '23505') return { kind: 'duplicate' }
  return { kind: 'failed', error: `ledger insert failed: ${error.message}` }
}

export interface ChargeRequest {
  rowId: string
  orgId: string
  paddleSubscriptionId: string
  priceId: string
  quantity: number
  /** charged_quantity already on the row (non-zero only for a retry). */
  alreadyCharged: number
}

export interface ChargeOutcome {
  status: 'charged' | 'error' | 'needs_reconciliation'
  error?: string
}

async function finalize(rowId: string, patch: Record<string, unknown>): Promise<string | null> {
  const { error } = await supabaseAdmin
    .from('subscription_overage_charges')
    .update({ ...patch, completed_at: new Date().toISOString() })
    .eq('id', rowId)
  return error ? error.message : null
}

/**
 * Charge a pending ledger row and record the result. The row must already be
 * `pending` (inserted or claimed by the caller), which is what keeps any other
 * run away from it while the request is in flight.
 */
export async function chargeAndRecord(req: ChargeRequest): Promise<ChargeOutcome> {
  if (!process.env['PADDLE_API_KEY']) {
    // Never sent, so definitely not charged.
    const message = 'PADDLE_API_KEY is not configured'
    const dbError = await finalize(req.rowId, { status: 'error', error_message: message })
    return dbError
      ? { status: 'error', error: `${message}; ledger update failed: ${dbError}` }
      : { status: 'error', error: message }
  }

  const charge = await chargeSubscription(
    req.paddleSubscriptionId,
    [{ priceId: req.priceId, quantity: req.quantity }],
    // 'immediately' settles now, while the subscription is still active,
    // rather than riding on a next invoice a cancellation could skip.
    'immediately',
  )

  const outcome: ChargeOutcome = charge.ok
    ? { status: 'charged' }
    : {
        status: isAmbiguousChargeFailure(charge.status) ? 'needs_reconciliation' : 'error',
        error: charge.error,
      }
  const patch = charge.ok
    ? {
        status: 'charged',
        charged_quantity: req.alreadyCharged + req.quantity,
        paddle_response: charge.response as Record<string, unknown>,
        error_message: null,
      }
    : {
        status: outcome.status,
        error_message: charge.error,
        paddle_response: (charge.response ?? null) as Record<string, unknown> | null,
      }

  const dbError = await finalize(req.rowId, patch)
  if (dbError) {
    // Paddle has answered, but the ledger still says 'pending'. Pending rows
    // are never retried or trued up, so this cannot double-charge; it needs a
    // human to record what Paddle did.
    logError('CRON_PARTIAL_FAILURE', {
      jobName: 'report-usage-overage',
      orgId: req.orgId,
      ledgerRowId: req.rowId,
      paddleSubscriptionId: req.paddleSubscriptionId,
      chargeOutcome: outcome.status,
      quantity: req.quantity,
      dbError,
    })
    return {
      status: 'needs_reconciliation',
      error: `Paddle returned ${outcome.status} but the ledger update failed: ${dbError}`,
    }
  }
  if (outcome.status === 'needs_reconciliation') {
    logError('PADDLE_API_FAILED', {
      jobName: 'report-usage-overage',
      stage: 'subscription.charge',
      orgId: req.orgId,
      ledgerRowId: req.rowId,
      paddleSubscriptionId: req.paddleSubscriptionId,
      quantity: req.quantity,
      reason: 'ambiguous_outcome',
      detail: outcome.error ?? null,
    })
  }
  return outcome
}
