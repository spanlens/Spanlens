/**
 * Usage-based overage billing via Paddle Billing's one-time charge endpoint.
 *
 * Architecture:
 *   1. Daily cron-report-usage-overage invokes `computeAndReportOverages()`.
 *   2. For each active Starter/Team subscription, check the "charging window":
 *      the 48-hour stretch ending at `current_period_end`. Outside that
 *      window we skip — we only finalize overage for a period as it's
 *      about to roll over.
 *   3. Inside the window, compute this-period overage = requests in
 *      (current_period_start .. current_period_end) minus included quota.
 *   4. Guard against double-charging via the unique constraint on
 *      `subscription_overage_charges (subscription_id, period_end)` — INSERT
 *      a `pending` row FIRST, call Paddle, then UPDATE to `charged` or
 *      `error`. A crash between INSERT and Paddle success is survivable
 *      because the pending row blocks future re-runs (safe fail direction:
 *      we under-bill rather than double-bill).
 *   5. Charge via POST /subscriptions/{id}/charge with
 *      effective_from: next_billing_period. This bundles the overage into
 *      the NEXT invoice (no separate charge to the customer, one invoice
 *      per month with a visible overage line item).
 *
 * Prerequisites (Paddle dashboard):
 *   - Create non-recurring prices for Starter and Team overage units.
 *   - Example: Starter at $0.10 per 1,000 requests — a one-time price
 *     (billing_cycle: null, quantity-multiplied at charge time).
 *   - Export the price IDs via env:
 *       PADDLE_PRICE_STARTER_OVERAGE
 *       PADDLE_PRICE_TEAM_OVERAGE
 */

import { supabaseAdmin } from './db.js'
import { MONTHLY_REQUEST_LIMITS, type Plan } from './quota.js'
import { chargeSubscription } from './paddle-charge.js'
import { isWithinChargingWindow, UNITS_PER_QUANTITY } from './paddle-usage-stats.js'

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
  status: 'skipped_not_in_window' | 'skipped_no_overage' | 'skipped_already_charged' | 'skipped_no_price' | 'charged' | 'error'
  error?: string
}

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

export async function computeAndReportOverages(
  now: Date = new Date(),
): Promise<OverageReport[]> {
  const reports: OverageReport[] = []

  const { data: subs, error: subsErr } = await supabaseAdmin
    .from('subscriptions')
    .select(
      'id, organization_id, paddle_subscription_id, plan, status, current_period_start, current_period_end',
    )
    .in('status', ['active', 'trialing'])
    .returns<ActiveSubRow[]>()

  if (subsErr || !subs) {
    console.error('[paddle-usage] failed to list subscriptions:', subsErr?.message)
    return reports
  }

  for (const s of subs) {
    const report: Partial<OverageReport> = {
      organization_id: s.organization_id,
      paddle_subscription_id: s.paddle_subscription_id,
      plan: s.plan,
      period_start: s.current_period_start ?? '',
      period_end: s.current_period_end ?? '',
    }

    // Need both period boundaries to bill correctly
    if (!s.current_period_start || !s.current_period_end) {
      reports.push({ ...report, included: 0, used: 0, overage_requests: 0, overage_quantity: 0, status: 'skipped_not_in_window' } as OverageReport)
      continue
    }

    // Only act during the 48h charging window before period_end.
    // Outside this window we do nothing — no speculative mid-period charges.
    if (!isWithinChargingWindow(Date.parse(s.current_period_end), now.getTime())) {
      reports.push({ ...report, included: 0, used: 0, overage_requests: 0, overage_quantity: 0, status: 'skipped_not_in_window' } as OverageReport)
      continue
    }

    const included = MONTHLY_REQUEST_LIMITS[s.plan] ?? 0
    const priceId = overagePriceIdForPlan(s.plan)

    // Count requests in the current billing period
    const { count, error: countErr } = await supabaseAdmin
      .from('requests')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', s.organization_id)
      .gte('created_at', s.current_period_start)
      .lt('created_at', s.current_period_end)

    if (countErr) {
      reports.push({
        ...report,
        included,
        used: 0,
        overage_requests: 0,
        overage_quantity: 0,
        status: 'error',
        error: `count failed: ${countErr.message}`,
      } as OverageReport)
      continue
    }

    const used = count ?? 0
    const overageRequests = Math.max(0, used - included)
    const overageQuantity = Math.ceil(overageRequests / UNITS_PER_QUANTITY)

    report.included = included
    report.used = used
    report.overage_requests = overageRequests
    report.overage_quantity = overageQuantity

    if (overageRequests === 0) {
      reports.push({ ...report, status: 'skipped_no_overage' } as OverageReport)
      continue
    }
    if (!priceId) {
      // No overage price configured for this plan — log and skip.
      reports.push({ ...report, status: 'skipped_no_price' } as OverageReport)
      continue
    }

    // ── Idempotency guard ────────────────────────────────────────
    // INSERT a pending row first. If a pending/charged/error row already
    // exists for (subscription_id, period_end), this throws a unique-
    // constraint violation and we skip — whatever state it's in, human
    // intervention (flip to 'retry' manually) is required before re-charging.
    const { data: pendingRow, error: insertErr } = await supabaseAdmin
      .from('subscription_overage_charges')
      .insert({
        subscription_id: s.id,
        period_start: s.current_period_start,
        period_end: s.current_period_end,
        overage_requests: overageRequests,
        overage_quantity: overageQuantity,
        price_id: priceId,
        status: 'pending',
      })
      .select('id')
      .single()

    if (insertErr) {
      // 23505 = unique_violation — not an error, just "already processed".
      const isUnique = (insertErr as { code?: string }).code === '23505'
      if (isUnique) {
        reports.push({ ...report, status: 'skipped_already_charged' } as OverageReport)
        continue
      }
      reports.push({
        ...report,
        status: 'error',
        error: `idempotency insert failed: ${insertErr.message}`,
      } as OverageReport)
      continue
    }

    // ── Paddle call ──────────────────────────────────────────────
    // Use 'immediately' so the charge is settled in real-time during the
    // 48-hour charging window — before the user can cancel the subscription.
    // Charging on 'next_billing_period' would create a window where a
    // cancellation between cron-run and next invoice loses the overage revenue.
    const charge = await chargeSubscription(
      s.paddle_subscription_id,
      [{ priceId, quantity: overageQuantity }],
      'immediately',
    )

    // ── Finalize the idempotency row ─────────────────────────────
    if (charge.ok) {
      await supabaseAdmin
        .from('subscription_overage_charges')
        .update({
          status: 'charged',
          paddle_response: charge.response as Record<string, unknown>,
          completed_at: new Date().toISOString(),
        })
        .eq('id', pendingRow!.id)

      reports.push({ ...report, status: 'charged' } as OverageReport)
    } else {
      await supabaseAdmin
        .from('subscription_overage_charges')
        .update({
          status: 'error',
          error_message: charge.error,
          paddle_response: charge.response as Record<string, unknown>,
          completed_at: new Date().toISOString(),
        })
        .eq('id', pendingRow!.id)

      reports.push({ ...report, status: 'error', error: charge.error } as OverageReport)
    }
  }

  return reports
}
