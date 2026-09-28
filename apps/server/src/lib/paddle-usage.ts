/**
 * Usage-based overage billing via Paddle Billing's one-time charge endpoint.
 *
 * Architecture (daily /cron/report-usage-overage → computeAndReportOverages):
 *
 *   1. Provisional pass. For each active Starter/Team subscription inside
 *      the "charging window" (the 48 hours ending at current_period_end),
 *      count this period's requests, and charge the overage seen so far.
 *      The charge settles immediately, while the subscription is still
 *      active, so a cancellation at period end cannot escape it. A period
 *      with no overage yet still gets a `no_charge` row, so step 3 knows the
 *      period was measured.
 *   2. Retry pass. Rows an operator flipped to `retry` are claimed and
 *      re-attempted for their remaining quantity.
 *   3. Settlement pass. Once a period has closed, recount its FINAL usage and
 *      charge the difference to what was already charged (a `true_up` row).
 *      Without it, the last 24-48 hours of every period were never billed
 *      (quality audit 2026-09-28, C4.3). See paddle-overage-settlement.ts.
 *
 * Double-charge guard: every charge first INSERTs a `pending` ledger row
 * under UNIQUE (subscription_id, period_end, kind), then calls Paddle, then
 * records the outcome and checks that write. An unknown outcome (network
 * error, 5xx, failed ledger write) becomes `needs_reconciliation` and is
 * never retried automatically: safer to under-bill than to double-bill.
 * See paddle-overage-ledger.ts.
 *
 * Prerequisites (Paddle dashboard):
 *   - Non-recurring overage prices (billing_cycle: null, quantity-multiplied
 *     at charge time), one charge unit = 1,000 requests. The published rates
 *     live in apps/web/lib/billing-plans.ts: Pro (plan id `starter`) $8 and
 *     Team $5 per 100K extra requests, i.e. $0.08 and $0.05 per unit.
 *   - Export the price IDs via env:
 *       PADDLE_PRICE_STARTER_OVERAGE
 *       PADDLE_PRICE_TEAM_OVERAGE
 */

import { supabaseAdmin } from './db.js'
import { MONTHLY_REQUEST_LIMITS, countMonthlyRequests, type Plan } from './quota.js'
import { isWithinChargingWindow } from './paddle-usage-stats.js'
import {
  chargeAndRecord,
  insertLedgerRow,
  overageFor,
  type OverageReport,
} from './paddle-overage-ledger.js'
import { retryFlaggedCharges, settleClosedPeriods } from './paddle-overage-settlement.js'
import { logError } from './structured-logger.js'

export type { OverageReport } from './paddle-overage-ledger.js'

function overagePriceIdForPlan(plan: Plan): string | null {
  if (plan === 'starter') return process.env['PADDLE_PRICE_STARTER_OVERAGE'] ?? null
  if (plan === 'team') return process.env['PADDLE_PRICE_TEAM_OVERAGE'] ?? null
  return null
}

interface ActiveSubRow {
  id: string
  organization_id: string
  paddle_subscription_id: string
  plan: Plan
  status: string
  current_period_start: string | null
  current_period_end: string | null
}

/**
 * Runs all three passes. A pass whose ledger read fails does not stop the
 * others, but the run then throws, so the cron records it as failed instead
 * of reporting success on a run that could not look at what it owed.
 */
export async function computeAndReportOverages(now: Date = new Date()): Promise<OverageReport[]> {
  const reports: OverageReport[] = []
  const failures: string[] = []
  const passes: Array<[string, () => Promise<OverageReport[]>]> = [
    ['provisional', () => chargeOpenPeriods(now)],
    ['retry', () => retryFlaggedCharges()],
    ['settlement', () => settleClosedPeriods(now)],
  ]

  for (const [name, pass] of passes) {
    try {
      reports.push(...(await pass()))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logError('CRON_JOB_FAILED', { jobName: 'report-usage-overage', pass: name }, err)
      failures.push(message)
    }
  }

  if (failures.length > 0) {
    throw new Error(`overage run incomplete: ${failures.join('; ')}`)
  }
  return reports
}

async function chargeOpenPeriods(now: Date): Promise<OverageReport[]> {
  const { data: subs, error: subsErr } = await supabaseAdmin
    .from('subscriptions')
    .select(
      'id, organization_id, paddle_subscription_id, plan, status, current_period_start, current_period_end',
    )
    .in('status', ['active', 'trialing'])
    .returns<ActiveSubRow[]>()

  if (subsErr || !subs) {
    throw new Error(`provisional pass: failed to list subscriptions: ${subsErr?.message ?? 'no data'}`)
  }

  const reports: OverageReport[] = []
  for (const s of subs) {
    reports.push(await chargeOpenPeriod(s, now))
  }
  return reports
}

async function chargeOpenPeriod(s: ActiveSubRow, now: Date): Promise<OverageReport> {
  const report: OverageReport = {
    organization_id: s.organization_id,
    paddle_subscription_id: s.paddle_subscription_id,
    plan: s.plan,
    period_start: s.current_period_start ?? '',
    period_end: s.current_period_end ?? '',
    included: 0,
    used: 0,
    overage_requests: 0,
    overage_quantity: 0,
    phase: 'provisional',
    status: 'skipped_not_in_window',
  }

  // Need both period boundaries to bill correctly, and only act during the
  // 48h charging window before period_end.
  if (!s.current_period_start || !s.current_period_end) return report
  if (!isWithinChargingWindow(Date.parse(s.current_period_end), now.getTime())) return report

  const included = MONTHLY_REQUEST_LIMITS[s.plan] ?? 0
  const priceId = overagePriceIdForPlan(s.plan)

  // Count requests in the current billing period, bypassing plan retention:
  // Paddle bills the actual period, not the dashboard window.
  let used: number
  try {
    used = await countMonthlyRequests(
      s.organization_id,
      new Date(s.current_period_start),
      new Date(s.current_period_end),
    )
  } catch (err) {
    return { ...report, included, status: 'error', error: `count failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  const { overageRequests, quantity } = overageFor(used, included)
  const measured: OverageReport = { ...report, included, used, overage_requests: overageRequests, overage_quantity: quantity }

  if (!priceId) {
    return { ...measured, status: overageRequests === 0 ? 'skipped_no_overage' : 'skipped_no_price' }
  }

  const inserted = await insertLedgerRow({
    subscriptionId: s.id,
    kind: 'provisional',
    periodStart: s.current_period_start,
    periodEnd: s.current_period_end,
    includedRequests: included,
    overageRequests,
    quantity,
    priceId,
    status: quantity > 0 ? 'pending' : 'no_charge',
  })
  if (inserted.kind === 'duplicate') return { ...measured, status: 'skipped_already_charged' }
  if (inserted.kind === 'failed') return { ...measured, status: 'error', error: inserted.error }
  if (quantity === 0) return { ...measured, status: 'skipped_no_overage' }

  const outcome = await chargeAndRecord({
    rowId: inserted.id,
    orgId: s.organization_id,
    paddleSubscriptionId: s.paddle_subscription_id,
    priceId,
    quantity,
    alreadyCharged: 0,
  })
  return { ...measured, status: outcome.status, ...(outcome.error ? { error: outcome.error } : {}) }
}
