'use client'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Check } from 'lucide-react'
import { initializePaddle, type Paddle } from '@paddle/paddle-js'
import { Skeleton } from '@/components/ui/skeleton'
import { cn, formatDate } from '@/lib/utils'
import { Topbar } from '@/components/layout/topbar'
import { GhostBtn } from '@/components/ui/primitives'
import {
  useSubscription,
  useCreateCheckout,
  useRefreshSubscription,
  useCancelSubscription,
} from '@/lib/queries/use-billing'
import { QuotaBanner } from '@/components/dashboard/quota-banner'
import { PLANS } from '@/lib/billing-plans'
import type { BillingPlan } from '@/lib/queries/types'

export function BillingClient() {
  const params = useSearchParams()
  const justReturnedFromCheckout = params.get('checkout') === 'success'
  const autoOpenPtxn = params.get('_ptxn')
  // Set by the quota upsell modal (?plan=starter|team) so the recommended
  // card is highlighted when the user lands here from the nudge.
  const highlightPlan = params.get('plan')

  const { data: subscription, isLoading, isError: subscriptionError } = useSubscription()
  const createCheckout = useCreateCheckout()
  const cancelSubscription = useCancelSubscription()
  const refreshSubscription = useRefreshSubscription()
  // Local error state for runtime errors (checkout, cancel). The
  // "missing client token" case is derived directly from env below — no
  // effect needed for that branch.
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [paddle, setPaddle] = useState<Paddle | null>(null)
  // initializePaddle can reject (ad-block, network) with no way to recover in
  // this session. Without tracking that, `paddle` stays null forever and the
  // Upgrade button is stuck on "Loading…" with no explanation. This flag flips
  // the error banner to an actionable message instead.
  const [paddleLoadFailed, setPaddleLoadFailed] = useState(false)
  const [checkoutCompleted, setCheckoutCompleted] = useState(false)
  // Sticky "an upgrade is being processed in this session" lock. currentPlan
  // stays 'free' until the webhook upserts the subscription, so without this
  // flag the Upgrade button re-enables the moment the overlay closes and the
  // user can start a SECOND checkout → double billing. Set when a checkout is
  // initiated or completed; only cleared by a real subscription refresh.
  const [upgradeInProgress, setUpgradeInProgress] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [cancelDone, setCancelDone] = useState(false)

  const clientToken = process.env['NEXT_PUBLIC_PADDLE_CLIENT_TOKEN']
  const paddleEnv = (process.env['NEXT_PUBLIC_PADDLE_ENVIRONMENT'] ?? 'sandbox') as
    | 'sandbox'
    | 'production'

  const errorMessage = runtimeError
    ?? (clientToken
      ? paddleLoadFailed
        ? 'Payment system failed to load. Please disable ad-blockers and retry.'
        : null
      : 'Paddle client token not configured. Set NEXT_PUBLIC_PADDLE_CLIENT_TOKEN.')

  useEffect(() => {
    if (!clientToken) return

    let cancelled = false
    void initializePaddle({
      environment: paddleEnv,
      token: clientToken,
      eventCallback: (event) => {
        if (event.name === 'checkout.completed') {
          setCheckoutCompleted(true)
          setUpgradeInProgress(true)
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

    return () => {
      cancelled = true
    }
  }, [clientToken, paddleEnv, refreshSubscription])

  useEffect(() => {
    if (justReturnedFromCheckout) refreshSubscription()
  }, [justReturnedFromCheckout, refreshSubscription])

  useEffect(() => {
    if (paddle && autoOpenPtxn) {
      paddle.Checkout.open({ transactionId: autoOpenPtxn })
    }
  }, [paddle, autoOpenPtxn])

  const handleUpgrade = useCallback(
    async (plan: 'starter' | 'team') => {
      setRuntimeError(null)
      setCheckoutCompleted(false)
      if (!paddle) {
        setRuntimeError('Paddle.js is not ready yet. Please try again in a moment.')
        return
      }
      try {
        const res = await createCheckout.mutateAsync({ plan })
        paddle.Checkout.open({ transactionId: res.transactionId })
        // Lock the upgrade action for the rest of this session. The overlay is
        // now open; even after the user closes it the plan won't flip to paid
        // until the webhook lands, so re-enabling the button here would let a
        // second checkout start against the same upgrade.
        setUpgradeInProgress(true)
      } catch (err) {
        setRuntimeError(
          err instanceof Error ? err.message : 'Failed to start checkout',
        )
      }
    },
    [paddle, createCheckout],
  )

  const handleCancel = useCallback(async () => {
    setRuntimeError(null)
    try {
      await cancelSubscription.mutateAsync()
      setShowCancelConfirm(false)
      setCancelDone(true)
    } catch (err) {
      setRuntimeError(err instanceof Error ? err.message : 'Failed to cancel subscription')
      setShowCancelConfirm(false)
    }
  }, [cancelSubscription])

  const currentPlan: BillingPlan = subscription?.plan ?? 'free'

  // Sticky upgrade lock releases automatically once a real (paid) subscription
  // lands — `subscription` is only truthy after the webhook upserts it. Derived
  // instead of cleared in an effect (React 19 forbids setState-in-effect, and
  // `subscription.plan` is never 'free', so an equality check wouldn't type).
  const upgradeLocked = upgradeInProgress && !subscription

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col h-screen overflow-hidden">
      <Topbar
        crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Billing' }]}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-4 md:px-7 md:py-6 max-w-4xl">
          <div className="mb-6">
            <h1 className="text-[22px] font-semibold text-text tracking-[-0.4px] mb-1">Billing</h1>
            <p className="text-[13px] text-text-muted">Manage your subscription and plan</p>
          </div>

          <QuotaBanner />

          {/* Current subscription */}
          <div className="rounded-xl border border-border bg-bg-elev p-5 mb-6">
            {isLoading ? (
              <>
                <Skeleton className="h-5 w-40 mb-2" />
                <Skeleton className="h-4 w-64" />
              </>
            ) : subscription ? (
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h2 className="text-[15px] font-semibold text-text capitalize">
                      {subscription.plan} plan
                    </h2>
                    <span
                      className={cn(
                        'font-mono text-[10px] uppercase tracking-[0.04em] px-2 py-0.5 rounded-full border',
                        subscription.status === 'active'
                          ? 'bg-good-bg border-good/20 text-good'
                          : subscription.status === 'past_due'
                            ? 'bg-accent-bg border-accent-border text-accent'
                            : 'bg-bg border-border text-text-muted',
                      )}
                    >
                      {subscription.status}
                    </span>
                    {subscription.cancel_at_period_end && (
                      <span className="font-mono text-[10px] uppercase tracking-[0.04em] px-2 py-0.5 rounded-full border border-border bg-bg text-text-muted">
                        Cancels at period end
                      </span>
                    )}
                  </div>
                  <p className="text-[13px] text-text-muted">
                    {subscription.current_period_end
                      ? subscription.cancel_at_period_end
                        ? `Access until ${formatDate(subscription.current_period_end)}`
                        : `Renews on ${formatDate(subscription.current_period_end)}`
                      : 'Active'}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  {cancelDone ? (
                    <p className="text-[12.5px] text-good">
                      Cancellation scheduled, access continues until period end.
                    </p>
                  ) : subscription.cancel_at_period_end ? (
                    <p className="text-[12.5px] text-text-faint">
                      Cancellation already scheduled.
                    </p>
                  ) : showCancelConfirm ? (
                    <div className="flex flex-col items-end gap-2">
                      <p className="text-[12px] text-text-muted max-w-[200px]">
                        Your plan stays active until the end of this billing period.
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setShowCancelConfirm(false)}
                          className="text-[12px] text-text-muted hover:text-text transition-colors"
                        >
                          Keep plan
                        </button>
                        <button
                          type="button"
                          disabled={cancelSubscription.isPending}
                          onClick={() => void handleCancel()}
                          className="text-[12px] text-accent hover:opacity-80 transition-opacity disabled:opacity-40"
                        >
                          {cancelSubscription.isPending ? 'Cancelling…' : 'Confirm cancel'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowCancelConfirm(true)}
                      className="text-[12px] text-text-faint hover:text-text-muted transition-colors"
                    >
                      Cancel subscription
                    </button>
                  )}
                </div>
              </div>
            ) : subscriptionError ? (
              // Don't fall through to the "Free plan" default on error — a paid
              // user hitting a transient failure would otherwise see a Free card
              // plus an Upgrade button and could be pushed into a duplicate
              // checkout. Show the load failure and let them retry instead.
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="text-[15px] font-semibold text-text mb-1">
                    Couldn&apos;t load your subscription
                  </h2>
                  <p className="text-[13px] text-text-muted">
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
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="text-[15px] font-semibold text-text mb-1">Free plan</h2>
                  <p className="text-[13px] text-text-muted">
                    50,000 requests / month · 14-day log retention · 1 seat
                  </p>
                </div>
                <span className="font-mono text-[10px] uppercase tracking-[0.04em] px-2 py-0.5 rounded-full border border-border bg-bg-elev text-text-muted">
                  Free
                </span>
              </div>
            )}
          </div>

          {/* Success banner */}
          {(justReturnedFromCheckout || checkoutCompleted) && (
            <div className="rounded-lg border border-good/30 bg-good-bg px-4 py-3 mb-5 text-[13px] text-good">
              Checkout complete. Your plan will update shortly once Paddle confirms the payment.
            </div>
          )}

          {/* Error banner */}
          {errorMessage && (
            <div className="rounded-lg border border-accent-border bg-accent-bg px-4 py-3 mb-5 text-[13px] text-accent">
              {errorMessage}
            </div>
          )}

          {/* Plan cards */}
          <h2 className="text-[14px] font-semibold text-text mb-4">Available plans</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            {PLANS.map((plan) => {
              const isCurrent = currentPlan === plan.id
              const isRecommended = !isCurrent && plan.id === highlightPlan
              const isUpgradeInFlight =
                createCheckout.isPending && createCheckout.variables?.plan === plan.id

              return (
                <div
                  key={plan.id}
                  className={cn(
                    'rounded-xl border p-5 flex flex-col min-h-[280px]',
                    isCurrent ? 'border-accent bg-accent-bg' : 'border-border bg-bg-elev',
                    isRecommended && 'ring-2 ring-accent ring-offset-2 ring-offset-bg',
                  )}
                >
                  <div className="flex items-start justify-between mb-3">
                    <span className="text-[15px] font-medium text-text">{plan.name}</span>
                    {isCurrent ? (
                      <span className="font-mono text-[10px] uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-full border border-accent-border bg-accent-bg text-accent">
                        Current
                      </span>
                    ) : isRecommended ? (
                      <span className="font-mono text-[10px] uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-full border border-accent bg-accent text-accent-fg">
                        Recommended
                      </span>
                    ) : null}
                  </div>

                  <div className="mb-3">
                    {plan.priceUsd !== null ? (
                      <div className="flex items-baseline gap-1">
                        <span className="font-mono text-[24px] font-medium tracking-[-0.4px] text-text">
                          ${plan.priceUsd}
                        </span>
                        <span className="font-mono text-[11px] text-text-muted">
                          / {plan.pricePeriod}
                        </span>
                      </div>
                    ) : (
                      <div className="font-mono text-[22px] font-medium text-text">Custom</div>
                    )}
                  </div>

                  <p className="text-[12px] text-text-muted mb-4 leading-relaxed">
                    {plan.description}
                  </p>

                  <ul className="space-y-1.5 mb-5 flex-1">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 font-mono text-[10.5px] text-text-muted">
                        <Check className="h-3 w-3 mt-0.5 text-good shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  <div>
                    {plan.id === 'free' ? (
                      <button
                        type="button"
                        disabled
                        className="w-full h-8 rounded-[6px] border border-border bg-bg text-[12.5px] font-medium text-text-faint cursor-not-allowed"
                      >
                        Default
                      </button>
                    ) : plan.id === 'enterprise' ? (
                      <GhostBtn
                        className="w-full justify-center text-[12.5px]"
                        onClick={() => window.open('mailto:sales@spanlens.io', '_blank')}
                      >
                        Contact sales
                      </GhostBtn>
                    ) : (
                      <button
                        type="button"
                        disabled={
                          isCurrent ||
                          createCheckout.isPending ||
                          !paddle ||
                          upgradeLocked
                        }
                        onClick={() => void handleUpgrade(plan.id as 'starter' | 'team')}
                        className="w-full h-8 rounded-[6px] bg-text text-bg text-[12.5px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                      >
                        {isCurrent
                          ? 'Current plan'
                          : upgradeLocked
                            ? 'Plan updating…'
                            : isUpgradeInFlight
                              ? 'Opening checkout…'
                              : !paddle
                                ? 'Loading…'
                                : `Upgrade to ${plan.name}`}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <p className="font-mono text-[11px] text-text-faint">
            Payments processed securely by Paddle. VAT / sales tax included where applicable.
          </p>
        </div>
      </div>
    </div>
  )
}
