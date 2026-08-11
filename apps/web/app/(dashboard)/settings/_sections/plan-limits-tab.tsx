'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { initializePaddle, type Paddle } from '@paddle/paddle-js'
import { cn } from '@/lib/utils'
import { Section, FormRow, GhostBtn } from '@/components/ui/primitives'
import { useOrganization, useUpdateOverageSettings } from '@/lib/queries/use-organization'
import {
  useSubscription,
  useCreateCheckout,
  useRefreshSubscription,
  useQuota,
} from '@/lib/queries/use-billing'
import { useCurrentMember } from '@/lib/queries/use-members'
import {
  PLANS,
  PLAN_REQUEST_LIMITS,
  PLAN_SEAT_LIMITS,
  PLAN_RETENTION_DAYS,
  PLAN_WORKSPACE_LIMITS,
} from '@/lib/billing-plans'
import type { BillingPlan } from '@/lib/queries/types'
import { NativeInput, MonoPill, Hint, Toggle, TabHeader } from '../_shared/ui'

// ─── PLAN & LIMITS tab ────────────────────────────────────────────────────────

export function PlanLimitsTab() {
  const { data: org } = useOrganization()
  const { data: subscription, isLoading: subLoading, isError: subError } = useSubscription()
  const { data: quota } = useQuota()
  const createCheckout = useCreateCheckout()
  const refreshSubscription = useRefreshSubscription()
  const update = useUpdateOverageSettings()
  const currentMember = useCurrentMember()
  const isAdmin = currentMember?.role === 'admin'
  const [multiplierDraft, setMultiplierDraft] = useState(String(org?.overage_cap_multiplier ?? 2))
  const [overageError, setOverageError] = useState<string | null>(null)
  const [paddle, setPaddle] = useState<Paddle | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  // initializePaddle can reject (ad-block, network). Without catching it,
  // `paddle` stays null forever and every Upgrade button is stuck on
  // "Loading…" with no explanation. Surface an actionable error instead.
  const [paddleLoadFailed, setPaddleLoadFailed] = useState(false)

  const clientToken = process.env['NEXT_PUBLIC_PADDLE_CLIENT_TOKEN']
  const paddleEnv = (process.env['NEXT_PUBLIC_PADDLE_ENVIRONMENT'] ?? 'sandbox') as 'sandbox' | 'production'

  useEffect(() => {
    if (!clientToken) return
    let cancelled = false
    void initializePaddle({
      environment: paddleEnv,
      token: clientToken,
      eventCallback: (event) => {
        if (event.name === 'checkout.completed') {
          setTimeout(() => refreshSubscription(), 1500)
        }
      },
    })
      .then((instance) => {
        if (!cancelled && instance) setPaddle(instance)
      })
      .catch(() => {
        if (!cancelled) setPaddleLoadFailed(true)
      })
    return () => { cancelled = true }
  }, [clientToken, paddleEnv, refreshSubscription])

  const handleUpgrade = useCallback(async (plan: 'starter' | 'team') => {
    setCheckoutError(null)
    if (!paddle) {
      setCheckoutError('Paddle.js is not ready yet. Please try again in a moment.')
      return
    }
    try {
      const res = await createCheckout.mutateAsync({ plan })
      paddle.Checkout.open({ transactionId: res.transactionId })
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Failed to start checkout')
    }
  }, [paddle, createCheckout])

  async function toggleOverage() {
    setOverageError(null)
    try {
      await update.mutateAsync({ allow_overage: !(org?.allow_overage ?? false) })
    } catch (err) {
      setOverageError(err instanceof Error ? err.message : 'Update failed')
    }
  }

  async function saveMultiplier() {
    setOverageError(null)
    try {
      await update.mutateAsync({ overage_cap_multiplier: Number(multiplierDraft) })
    } catch (err) {
      setOverageError(err instanceof Error ? err.message : 'Update failed')
    }
  }

  const currentPlan: BillingPlan = subscription?.plan ?? 'free'
  const isFree = currentPlan === 'free'
  const isEnterprise = currentPlan === 'enterprise'

  const usedThisMonth = quota?.usedThisMonth ?? 0
  const planLimit = PLAN_REQUEST_LIMITS[currentPlan]
  const limitLabel = planLimit != null ? planLimit.toLocaleString() : 'unlimited'
  const headroom = planLimit != null
    ? `${Math.max(0, Math.round((1 - usedThisMonth / planLimit) * 100))}%`
    : '∞'
  const seatLimit = PLAN_SEAT_LIMITS[currentPlan]
  const seatLimitLabel = seatLimit == null ? 'unlimited' : String(seatLimit)
  const workspaceLimit = PLAN_WORKSPACE_LIMITS[currentPlan]
  const workspaceLimitLabel = workspaceLimit == null ? 'unlimited' : String(workspaceLimit)
  const retentionDays = PLAN_RETENTION_DAYS[currentPlan] ?? 14
  const retentionLabel = `${retentionDays} days`

  return (
    <div className="max-w-[1040px]">
      <TabHeader title="Plan & limits" description="Compare plans. Hard limits apply per-workspace; can be lifted on Enterprise." />

      {(checkoutError || paddleLoadFailed) && (
        <div className="rounded-lg border border-accent-border bg-accent-bg px-4 py-3 mb-5 text-[13px] text-accent">
          {checkoutError
            ?? 'Payment system failed to load. Please disable ad-blockers and retry.'}
        </div>
      )}

      {/* Subscription load failure — don't fall through to the Free-plan
          default below. A paying user hitting a transient 500 would otherwise
          see Free + Upgrade buttons and could start a duplicate checkout.
          Show the failure and a retry instead. */}
      {subError ? (
        <div className="rounded-lg border border-border bg-bg-elev px-4 py-3 mb-6 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[13px] font-medium text-text mb-0.5">
              Couldn&apos;t load your plan
            </div>
            <p className="text-[12.5px] text-text-muted">
              We couldn&apos;t reach billing just now. Your current plan is unchanged.
            </p>
          </div>
          <button
            type="button"
            onClick={() => refreshSubscription()}
            className="font-mono text-[12px] text-accent hover:opacity-80 transition-opacity shrink-0"
          >
            Retry
          </button>
        </div>
      ) : (
      <>
      {/* Plan cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
        {PLANS.map((plan) => {
          const isCurrent = currentPlan === plan.id
          const isUpgradeInFlight = createCheckout.isPending && createCheckout.variables?.plan === plan.id
          return (
            <div
              key={plan.id}
              className={cn(
                'border rounded-xl p-4 flex flex-col gap-3 min-h-[280px]',
                isCurrent ? 'border-accent bg-accent-bg' : 'border-border bg-bg-elev',
              )}
            >
              <div className="flex items-start justify-between">
                <span className="text-[15px] font-medium text-text">{plan.name}</span>
                {isCurrent && <MonoPill variant="accent" dot>current</MonoPill>}
              </div>
              <div>
                {plan.priceUsd !== null ? (
                  <div className="flex items-baseline gap-1">
                    <span className="font-mono text-[20px] font-medium tracking-[-0.2px] text-text">${plan.priceUsd}</span>
                    <span className="font-mono text-[10.5px] text-text-muted">/ {plan.pricePeriod}</span>
                  </div>
                ) : (
                  <div className="font-mono text-[20px] font-medium text-text">Custom</div>
                )}
                <div className="font-mono text-[10.5px] text-text-muted mt-1">{plan.description}</div>
              </div>
              <ul className="flex-1 space-y-1.5">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 font-mono text-[10.5px] text-text-muted">
                    <Check className="h-3 w-3 mt-0.5 text-good shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <div>
                {plan.id === 'free' ? (
                  <button type="button" disabled className="w-full h-8 rounded-[6px] border border-border bg-bg text-[12.5px] font-medium text-text-faint cursor-not-allowed">
                    Default
                  </button>
                ) : plan.id === 'enterprise' ? (
                  <GhostBtn className="w-full justify-center" onClick={() => window.open('mailto:sales@spanlens.io', '_blank')}>
                    Contact sales
                  </GhostBtn>
                ) : isCurrent ? (
                  <button type="button" disabled className="w-full h-8 rounded-[6px] border border-border bg-bg text-[12.5px] font-medium text-text-faint cursor-not-allowed">
                    Current plan
                  </button>
                ) : !isAdmin ? (
                  <button type="button" disabled className="w-full h-8 rounded-[6px] border border-border bg-bg text-[12.5px] font-medium text-text-faint cursor-not-allowed" title="Only admins can change the plan">
                    Admin only
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={createCheckout.isPending || !paddle || subLoading}
                    onClick={() => void handleUpgrade(plan.id as 'starter' | 'team')}
                    className="w-full h-8 rounded-[6px] bg-text text-bg text-[12.5px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                  >
                    {isUpgradeInFlight ? 'Opening checkout…' : !paddle ? 'Loading…' : `Upgrade to ${plan.name}`}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Renewal + refund disclosure — placed right under the plan cards so
          the policy is visible at the point of purchase decision. Matches the
          requirement of the Korean Act on Consumer Protection in Electronic
          Commerce (전자상거래법) for refund terms accessible from the order
          surface, and keeps the trust-building information one scroll away
          from the upgrade buttons. */}
      <Section title="Billing & refunds" className="mb-5">
        <div className="px-6 py-4 text-[13px] text-text-muted leading-relaxed space-y-2">
          <p>
            Paid plans renew automatically at the start of each billing period.
            Cancel any time from the Paddle receipt link or by emailing{' '}
            <a
              href="mailto:support@spanlens.io"
              className="text-accent font-medium hover:opacity-80 transition-opacity"
            >
              support@spanlens.io
            </a>
            . Your plan stays active through the period you have already paid for.
          </p>
          <p>
            Full refund available within 14 days of the initial charge if usage
            is below 10% of plan quota. See our{' '}
            <Link
              href="/refund"
              className="text-accent font-medium hover:opacity-80 transition-opacity"
            >
              Refund Policy
            </Link>
            {' '}for the full terms, EU statutory withdrawal rights, and how to
            request a refund.
          </p>
        </div>
      </Section>

      <Section title="Hard limits" action={<Hint>{currentPlan} plan</Hint>} className="mb-5">
        <div className="overflow-x-auto">
        <div className="divide-y divide-border min-w-[420px]">
          <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-4 px-6 py-3 font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
            {['Resource', 'Limit', 'Used now', 'Headroom'].map((h) => <span key={h}>{h}</span>)}
          </div>
          {[
            ['Requests / month',     limitLabel,           usedThisMonth.toLocaleString(), headroom],
            ['Team seats',           seatLimitLabel,       '—',                            '—'],
            ['Workspaces (owned)',   workspaceLimitLabel,  '—',                            '—'],
            ['Log retention',        retentionLabel,       '—',                            '—'],
            ['API keys',             '25',                 '—',                            '—'],
            ['Alert rules',          '100',                '—',                            '—'],
          ].map(([res, lim, used, head]) => (
            <div key={res} className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-4 px-6 py-3">
              <span className="font-mono text-[12px] text-text-muted">{res}</span>
              <span className="font-mono text-[12px] text-text">{lim}</span>
              <span className="font-mono text-[12px] text-text">{used}</span>
              <span className="font-mono text-[12px] text-text">{head}</span>
            </div>
          ))}
        </div>
        </div>
      </Section>

      {!isEnterprise && (
        <Section title="Overage billing" description="Applies when your monthly quota is reached" className="mb-5">
          {isFree ? (
            <div className="px-6 py-4 text-[13px] text-text-muted">
              Overage is not available on the Free plan. Logging pauses past the quota, but the proxy keeps forwarding requests. Upgrade to Pro or Team to resume logging and enable overage.
            </div>
          ) : (
            <>
              <FormRow label="Allow overage charges" hint="When quota is reached, continue serving and bill overage. Off = 429 past the limit.">
                <Toggle
                  on={org?.allow_overage ?? false}
                  disabled={update.isPending || !isAdmin}
                  onToggle={() => void toggleOverage()}
                />
              </FormRow>
              <FormRow label="Max overage multiplier" hint="Hard cap = monthly limit × this value. Requests past the cap return 429.">
                <div className="flex items-center gap-2">
                  <NativeInput
                    type="number"
                    min={1}
                    max={100}
                    disabled={!(org?.allow_overage ?? false) || update.isPending || !isAdmin}
                    value={multiplierDraft}
                    onChange={(e) => setMultiplierDraft(e.target.value)}
                    className="w-20 font-mono text-[12.5px]"
                  />
                  <span className="font-mono text-[11.5px] text-text-faint">×</span>
                  {isAdmin && (
                    <GhostBtn
                      disabled={
                        !(org?.allow_overage ?? false) ||
                        update.isPending ||
                        Number(multiplierDraft) === (org?.overage_cap_multiplier ?? 2) ||
                        !Number.isInteger(Number(multiplierDraft)) ||
                        Number(multiplierDraft) < 1 ||
                        Number(multiplierDraft) > 100
                      }
                      onClick={() => void saveMultiplier()}
                    >
                      {update.isPending ? 'Saving…' : 'Save'}
                    </GhostBtn>
                  )}
                </div>
              </FormRow>
              {overageError && (
                <div className="px-6 pb-4 -mt-2 font-mono text-[11.5px] text-status-error">
                  {overageError}
                </div>
              )}
              {!isAdmin && (
                <div className="px-6 pb-4 text-[11.5px] text-text-faint">Only admins can change overage settings.</div>
              )}
            </>
          )}
        </Section>
      )}
      </>
      )}
    </div>
  )
}
