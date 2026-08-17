'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { initializePaddle, type Paddle } from '@paddle/paddle-js'
import { Skeleton } from '@/components/ui/skeleton'
import { cn, formatDate } from '@/lib/utils'
import { Topbar } from '@/components/layout/topbar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  useSubscription,
  useCreateCheckout,
  useRefreshSubscription,
  useCancelSubscription,
} from '@/lib/queries/use-billing'
import { QuotaBanner } from '@/components/dashboard/quota-banner'
import { PLANS } from '@/lib/billing-plans'
import { describeBillingFailure, type BillingFailure } from '@/lib/billing-errors'
import type { BillingPlan } from '@/lib/queries/types'

/** Pill recipe shared by the chips in the current-plan card header. */
const PILL = 'inline-flex items-center rounded-full px-2 py-[3px] font-mono text-[10.5px]'

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
  const [runtimeError, setRuntimeError] = useState<BillingFailure | null>(null)
  const [paddle, setPaddle] = useState<Paddle | null>(null)
  // initializePaddle can reject (ad-block, network) with no way to recover in
  // this session. Without tracking that, `paddle` stays null forever and the
  // Upgrade button is stuck on "Loading…" with no explanation. This flag flips
  // the error banner to an actionable message instead.
  const [paddleLoadFailed, setPaddleLoadFailed] = useState(false)
  const [checkoutCompleted, setCheckoutCompleted] = useState(false)
  // Mirror of checkoutCompleted for the Paddle eventCallback, which is
  // registered once at init and would otherwise close over a stale `false`.
  const checkoutCompletedRef = useRef(false)
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

  /*
   * One banner, three sources: a failed call, a blocked Paddle.js, and a
   * missing client token. `retryable` decides the tone — a problem the reader
   * can outlast is warned, a problem that needs us is flagged — so the two are
   * not dressed identically the way they were when everything was a 502.
   */
  const failure: BillingFailure | null = runtimeError
    ?? (clientToken
      ? paddleLoadFailed
        ? {
            message: 'Payment system failed to load. Please disable ad-blockers and retry.',
            retryable: true,
          }
        : null
      : {
          message:
            'Checkout is unavailable because of a billing problem on our side. ' +
            'We have been notified. Please contact support@spanlens.io if it persists.',
          retryable: false,
        })

  useEffect(() => {
    if (!clientToken) return

    let cancelled = false
    void initializePaddle({
      environment: paddleEnv,
      token: clientToken,
      eventCallback: (event) => {
        if (event.name === 'checkout.completed') {
          checkoutCompletedRef.current = true
          setCheckoutCompleted(true)
          setUpgradeInProgress(true)
          setTimeout(() => refreshSubscription(), 1500)
        } else if (event.name === 'checkout.closed') {
          // Overlay dismissed without paying (price check, changed mind,
          // declined card). Release the upgrade lock so the button doesn't
          // stay stuck on "Plan updating…" for the rest of the session.
          // checkout.closed ALSO fires after a successful checkout when the
          // user closes the confirmation view — the ref guard keeps the lock
          // held in that case until the webhook lands (double-billing guard).
          if (!checkoutCompletedRef.current) {
            setUpgradeInProgress(false)
          }
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
      checkoutCompletedRef.current = false
      if (!paddle) {
        setRuntimeError({
          message: 'Paddle.js is not ready yet. Please try again in a moment.',
          retryable: true,
        })
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
        setRuntimeError(describeBillingFailure(err, 'Failed to start checkout'))
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
      setRuntimeError(describeBillingFailure(err, 'Failed to cancel subscription'))
      setShowCancelConfirm(false)
    }
  }, [cancelSubscription])

  const currentPlan: BillingPlan = subscription?.plan ?? 'free'

  // Sticky upgrade lock releases automatically once a real (paid) subscription
  // lands — `subscription` is only truthy after the webhook upserts it. Derived
  // instead of cleared in an effect (React 19 forbids setState-in-effect, and
  // `subscription.plan` is never 'free', so an equality check wouldn't type).
  const upgradeLocked = upgradeInProgress && !subscription

  // The current-plan card reads its headline figures from the same PLANS table
  // that renders the plan list, so the price and the allowance line can't drift
  // apart between the two cards.
  const planConfig = PLANS.find((p) => p.id === currentPlan)
  const allowanceLine = planConfig ? planConfig.features.slice(0, 3).join(' · ') : ''

  return (
    <>
      {/* The topbar is the only full-bleed row: it cancels the padding
          `DashboardContent` applies so its hairline spans the whole main
          column. Everything below sits flush inside that padding. */}
      <div className="sticky top-0 z-20 -mx-4 -mt-4 md:-mx-7 md:-mt-5 bg-bg">
        <Topbar
          crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Billing' }]}
        />
      </div>
      {/* The breadcrumb carries the page label on screen, so the document
          heading stays for assistive tech only rather than being repeated. */}
      <h1 className="sr-only">Billing</h1>

      <div className="flex flex-col gap-4 pt-4 md:pt-5">
        {/* QuotaBanner hides itself below 80% usage; the wrapper collapses with
            it so the flex gap leaves no hole, and flattens the banner's own
            bottom margin inside this gap-driven column. */}
        <div className="empty:hidden [&>div]:mb-0">
          <QuotaBanner />
        </div>

        {(justReturnedFromCheckout || checkoutCompleted) && (
          <div className="rounded-lg bg-good-bg px-4 py-3 text-[12.5px] text-good">
            Checkout complete. Your plan will update shortly once Paddle confirms the payment.
          </div>
        )}

        {failure && (
          <div
            role="alert"
            className={`rounded-lg px-4 py-3 text-[12.5px] ${
              failure.retryable ? 'bg-warn-bg text-warn' : 'bg-bad-bg text-bad'
            }`}
          >
            {failure.message}
          </div>
        )}

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          {/* ── Current plan ──────────────────────────────────────────── */}
          <Card className="flex flex-col">
            <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
              <CardTitle>Current plan</CardTitle>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                {/* Held back while loading or on a load failure: currentPlan
                    falls back to 'free', and labelling a paid account "Free"
                    during a transient error is exactly the wrong signal. */}
                {!isLoading && !subscriptionError && (
                  <span className={cn(PILL, 'bg-accent-bg text-accent')}>
                    {planConfig?.name ?? 'Free'}
                  </span>
                )}
                {subscription && (
                  <span
                    className={cn(
                      PILL,
                      subscription.status === 'active'
                        ? 'bg-good-bg text-good'
                        : subscription.status === 'past_due'
                          ? 'bg-accent-bg text-accent'
                          : 'bg-bg-chip text-text-muted',
                    )}
                  >
                    {subscription.status}
                  </span>
                )}
                {subscription?.cancel_at_period_end && (
                  <span className={cn(PILL, 'bg-bg-chip text-text-muted')}>
                    Cancels at period end
                  </span>
                )}
              </div>
            </CardHeader>

            <CardContent className="flex flex-1 flex-col">
              {isLoading ? (
                <>
                  <Skeleton className="h-8 w-40" />
                  <Skeleton className="mt-3 h-4 w-64" />
                </>
              ) : subscriptionError ? (
                // Don't fall through to the "Free plan" default on error — a paid
                // user hitting a transient failure would otherwise see a Free card
                // plus an Upgrade button and could be pushed into a duplicate
                // checkout. Show the load failure and let them retry instead.
                <div className="flex flex-1 flex-col">
                  <p className="font-display text-[22px] leading-[1.05] track-h3 text-text">
                    Couldn&apos;t load your subscription
                  </p>
                  <p className="mt-2 text-[12.5px] text-text-muted">
                    We couldn&apos;t reach billing just now. Your current plan is unchanged.
                  </p>
                  <div className="mt-auto pt-5">
                    <button
                      type="button"
                      onClick={() => refreshSubscription()}
                      className="rounded-full border border-border bg-bg-elev px-3.5 py-2 text-[12px] font-medium text-text hover:bg-bg-muted"
                    >
                      Retry
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {planConfig && planConfig.priceUsd !== null ? (
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-display text-[28px] leading-[1.05] track-kpi text-text">
                        ${planConfig.priceUsd}
                      </span>
                      <span className="font-mono text-[12px] text-text-muted">
                        / {planConfig.pricePeriod}
                      </span>
                    </div>
                  ) : (
                    <div className="font-display text-[28px] leading-[1.05] track-kpi text-text">
                      Custom
                    </div>
                  )}

                  <p className="mt-2 text-[12.5px] text-text-muted">
                    {subscription
                      ? subscription.current_period_end
                        ? subscription.cancel_at_period_end
                          ? `Access until ${formatDate(subscription.current_period_end)}`
                          : `Renews on ${formatDate(subscription.current_period_end)}`
                        : 'Active'
                      : (planConfig?.description ?? '')}
                  </p>

                  <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-5">
                    <span className="font-mono text-[11.5px] text-text-faint">
                      {allowanceLine}
                    </span>
                    {subscription && (
                      <div className="shrink-0 text-right">
                        {cancelDone ? (
                          <p className="text-[11.5px] text-good">
                            Cancellation scheduled, access continues until period end.
                          </p>
                        ) : subscription.cancel_at_period_end ? (
                          <p className="text-[11.5px] text-text-faint">
                            Cancellation already scheduled.
                          </p>
                        ) : showCancelConfirm ? (
                          <div className="flex flex-col items-end gap-2">
                            <p className="max-w-[220px] text-[11.5px] text-text-muted">
                              Your plan stays active until the end of this billing period.
                            </p>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setShowCancelConfirm(false)}
                                className="rounded-full border border-border bg-bg-elev px-3.5 py-2 text-[12px] font-medium text-text hover:bg-bg-muted"
                              >
                                Keep plan
                              </button>
                              <button
                                type="button"
                                disabled={cancelSubscription.isPending}
                                onClick={() => void handleCancel()}
                                className="rounded-full border border-accent-border bg-accent-bg px-3.5 py-2 text-[12px] font-medium text-accent transition-opacity hover:opacity-80 disabled:opacity-40"
                              >
                                {cancelSubscription.isPending ? 'Cancelling…' : 'Confirm cancel'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setShowCancelConfirm(true)}
                            className="font-mono text-[11.5px] text-text-faint transition-colors hover:text-text-muted"
                          >
                            Cancel subscription
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* ── Available plans ───────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>Available plans</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2.5">
              {PLANS.map((plan) => {
                const isCurrent = currentPlan === plan.id
                const isRecommended = !isCurrent && plan.id === highlightPlan
                const isUpgradeInFlight =
                  createCheckout.isPending && createCheckout.variables?.plan === plan.id

                return (
                  <div
                    key={plan.id}
                    className={cn(
                      'flex items-start justify-between gap-3 rounded-lg px-4 py-3.5',
                      // The active plan reads as a filled band rather than an
                      // outlined, actionable row.
                      isCurrent ? 'bg-bg-muted' : 'border border-border',
                      isRecommended && 'ring-2 ring-accent ring-offset-2 ring-offset-bg',
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-[12.5px] font-semibold text-text">{plan.name}</span>
                        <span className="font-mono text-[12px] text-text-muted">
                          {plan.priceUsd !== null ? `$${plan.priceUsd}` : 'talk to us'}
                        </span>
                        {isRecommended && (
                          <span className={cn(PILL, 'bg-accent text-accent-fg')}>Recommended</span>
                        )}
                      </div>
                      <p className="mt-1 text-[11.5px] text-text-muted">{plan.description}</p>
                      <p className="mt-1 text-[11.5px] leading-relaxed text-text-faint">
                        {plan.features.join(' · ')}
                      </p>
                    </div>

                    <div className="shrink-0 self-center">
                      {isCurrent ? (
                        <span className="text-[11.5px] text-text-faint">current</span>
                      ) : plan.id === 'free' ? (
                        <button
                          type="button"
                          disabled
                          className="cursor-not-allowed rounded-full border border-border bg-bg-elev px-3.5 py-2 text-[12px] font-medium text-text-faint"
                        >
                          Default
                        </button>
                      ) : plan.id === 'enterprise' ? (
                        <button
                          type="button"
                          onClick={() => window.open('mailto:sales@spanlens.io', '_blank')}
                          className="rounded-full border border-border bg-bg-elev px-3.5 py-2 text-[12px] font-medium text-text hover:bg-bg-muted"
                        >
                          Contact sales
                        </button>
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
                          className="cursor-pointer rounded-full bg-text px-3.5 py-2 text-[12px] font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
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
            </CardContent>
          </Card>
        </div>

        <p className="font-mono text-[11px] text-text-faint">
          Payments processed securely by Paddle. VAT / sales tax included where applicable.
        </p>
      </div>
    </>
  )
}
