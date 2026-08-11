'use client'
import Link from 'next/link'
import { cn, formatDate } from '@/lib/utils'
import { Section } from '@/components/ui/primitives'
import { useSubscription, useQuota } from '@/lib/queries/use-billing'
import { QuotaBanner } from '@/components/dashboard/quota-banner'
import { formatPlanLabel } from '@/lib/billing-plans'
import { TabHeader } from '../_shared/ui'

// ─── BILLING tab ──────────────────────────────────────────────────────────────

export function BillingTab() {
  const { data: subscription, isLoading, isError, refetch } = useSubscription()
  const { data: quota } = useQuota()

  const planName = subscription?.plan ?? 'free'
  const planLabel = formatPlanLabel(planName)

  const usedThisMonth = quota?.usedThisMonth ?? 0
  const limit = quota?.limit ?? 10_000
  const pct = limit > 0 ? Math.min(1, usedThisMonth / limit) : 0

  return (
    <div className="max-w-[920px]">
      <TabHeader title="Billing" description="Per-request pricing. What ingests this month is what you pay." />

      <QuotaBanner />

      {/* Hero card */}
      <div className="border border-border rounded-xl bg-bg-elev p-6 grid grid-cols-1 sm:grid-cols-2 gap-6 mb-5">
        <div>
          <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] mb-3">Current plan</div>
          {isLoading ? (
            <div className="h-8 w-32 bg-bg-muted rounded animate-pulse mb-4" />
          ) : isError ? (
            // Don't render the Free-plan default on error — a paying user
            // hitting a transient failure would otherwise see "Free", which is
            // wrong and alarming. Show the load failure and a retry instead.
            <div className="mb-4">
              <div className="text-[15px] font-medium text-text mb-1">Couldn&apos;t load your plan</div>
              <p className="text-[12.5px] text-text-muted mb-2">
                We couldn&apos;t reach billing just now. Your current plan is unchanged.
              </p>
              <button
                type="button"
                onClick={() => refetch()}
                className="font-mono text-[12px] text-accent hover:opacity-80 transition-opacity"
              >
                Retry
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-1">
                <span className="text-[30px] font-medium tracking-[-0.6px]">{planLabel}</span>
                <span className={cn(
                  'font-mono text-[10px] uppercase tracking-[0.04em] px-2 py-0.5 rounded-full border',
                  subscription?.status === 'active'
                    ? 'bg-good-bg border-good/20 text-good'
                    : subscription?.status === 'past_due'
                      ? 'bg-accent-bg border-accent-border text-accent'
                      : 'bg-bg border-border text-text-muted',
                )}>
                  {subscription?.status ?? 'free'}
                </span>
              </div>
              <div className="text-[12.5px] text-text-muted mb-4">
                {subscription?.current_period_end
                  ? subscription.cancel_at_period_end
                    ? `Access until ${formatDate(subscription.current_period_end)}`
                    : `Renews on ${formatDate(subscription.current_period_end)}`
                  : 'No active subscription'}
              </div>
            </>
          )}
        </div>
        <div>
          <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] mb-3">This cycle</div>
          <div className="h-2.5 bg-bg-muted rounded-full overflow-hidden mb-2">
            <div className="h-full bg-text rounded-full" style={{ width: `${(pct * 100).toFixed(1)}%` }} />
          </div>
          <div className="flex justify-between font-mono text-[11px] text-text-muted">
            <span><span className="text-text">{usedThisMonth.toLocaleString()}</span> / {limit.toLocaleString()} req</span>
            <span>{(pct * 100).toFixed(0)}% used</span>
          </div>
        </div>
      </div>

      {/* Payment + refund disclosure, post-purchase variant. PLAN & LIMITS
          has the same information in pre-purchase wording; keeping both
          surfaces self-contained means a user who lands on either tab
          finds the cancellation and refund paths without bouncing around. */}
      <Section title="Payment, cancellation & refunds" className="mb-5">
        <div className="px-6 py-4 text-[13px] text-text-muted leading-relaxed space-y-2">
          <p>
            Payments are processed by Paddle. Update your payment method or
            cancel your subscription from the link Paddle sent when you
            subscribed, or email{' '}
            <a
              href="mailto:support@spanlens.io"
              className="text-accent font-medium hover:opacity-80 transition-opacity"
            >
              support@spanlens.io
            </a>
            . Cancellation stops future renewals; your current plan stays
            active through the billing period you already paid for.
          </p>
          <p>
            Eligible for a full refund within 14 days of the initial charge
            if usage is below 10% of plan quota. See our{' '}
            <Link
              href="/refund"
              className="text-accent font-medium hover:opacity-80 transition-opacity"
            >
              Refund Policy
            </Link>
            {' '}for the full terms, EU statutory withdrawal rights, and how
            to request a refund.
          </p>
        </div>
      </Section>

      <Section title="Budget alerts" className="mb-5">
        <div className="px-6 py-4 text-[13px] text-text-muted">
          Set cost and request thresholds in the{' '}
          <Link href="/alerts" className="text-accent font-medium hover:opacity-80 transition-opacity">
            Alerts →
          </Link>{' '}
          tab to get notified before spend exceeds your quota.
        </div>
      </Section>
    </div>
  )
}
