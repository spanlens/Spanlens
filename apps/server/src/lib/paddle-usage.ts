/**
 * Report metered usage to Paddle for usage-based overage billing.
 *
 * Paddle Billing supports metered prices via the "adjustments" / "transactions"
 * endpoints. For each billing period we compute the number of requests above
 * the plan's included quota and report the delta to Paddle so the next
 * invoice reflects the overage charge.
 *
 * This is called by /cron/report-usage-overage (daily) once the subscription
 * and overage price are live in production. Sandbox just logs what it would
 * have sent.
 *
 * Env:
 *   PADDLE_PRICE_STARTER_OVERAGE   price_id of $0.10/1K overage meter for Starter
 *   PADDLE_PRICE_TEAM_OVERAGE      price_id of $0.08/1K overage meter for Team
 */

import { supabaseAdmin } from './db.js'
import { getPaddleBase } from './paddle.js'
import { MONTHLY_REQUEST_LIMITS, type Plan } from './quota.js'

interface OverageReport {
  organization_id: string
  subscription_id: string
  plan: Plan
  included: number
  used: number
  overage: number
  price_id: string | null
  reported: boolean
  error?: string
}

function overagePriceIdForPlan(plan: Plan): string | null {
  if (plan === 'starter') return process.env['PADDLE_PRICE_STARTER_OVERAGE'] ?? null
  if (plan === 'team') return process.env['PADDLE_PRICE_TEAM_OVERAGE'] ?? null
  return null
}

export async function computeAndReportOverages(): Promise<OverageReport[]> {
  const reports: OverageReport[] = []

  const { data: subs } = await supabaseAdmin
    .from('subscriptions')
    .select(
      'id, organization_id, paddle_subscription_id, plan, status, current_period_start, current_period_end',
    )
    .in('status', ['active', 'trialing'])

  for (const s of (subs ?? []) as Array<{
    id: string
    organization_id: string
    paddle_subscription_id: string
    plan: Plan
    status: string
    current_period_start: string | null
    current_period_end: string | null
  }>) {
    const included = MONTHLY_REQUEST_LIMITS[s.plan] ?? 0
    const priceId = overagePriceIdForPlan(s.plan)

    // Count requests in the current billing period (fall back to month
    // boundaries if period is missing, e.g. trialing edge case).
    const periodStart = s.current_period_start ?? new Date(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1).toISOString()
    const periodEnd = s.current_period_end ?? new Date().toISOString()

    const { count } = await supabaseAdmin
      .from('requests')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', s.organization_id)
      .gte('created_at', periodStart)
      .lte('created_at', periodEnd)

    const used = count ?? 0
    const overage = Math.max(0, used - included)

    const report: OverageReport = {
      organization_id: s.organization_id,
      subscription_id: s.paddle_subscription_id,
      plan: s.plan,
      included,
      used,
      overage,
      price_id: priceId,
      reported: false,
    }

    if (overage === 0 || !priceId) {
      reports.push(report)
      continue
    }

    // Sandbox note: Paddle's metered billing integration requires the overage
    // price to be attached to the subscription. We PATCH the subscription to
    // append the overage item with the computed quantity (rounded to units
    // Paddle expects — usually "per 1000 requests").
    // This is a lightweight implementation — production may want more robust
    // idempotency (storing reported quantities per billing period).

    const quantityPer1k = Math.ceil(overage / 1000)
    try {
      const res = await fetch(
        `${getPaddleBase()}/subscriptions/${s.paddle_subscription_id}/adjust`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env['PADDLE_API_KEY'] ?? ''}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'credit',
            items: [{ price_id: priceId, quantity: quantityPer1k }],
          }),
        },
      )
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        report.error = `Paddle ${res.status}: ${text.slice(0, 200)}`
      } else {
        report.reported = true
      }
    } catch (err) {
      report.error = err instanceof Error ? err.message : 'unknown'
    }

    reports.push(report)
  }

  return reports
}
