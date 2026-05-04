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
} from '@/lib/queries/use-billing'
import { QuotaBanner } from '@/components/dashboard/quota-banner'
import { PLANS } from '@/lib/billing-plans'
import type { BillingPlan } from '@/lib/queries/types'

export default function BillingPage() {
  const params = useSearchParams()
  const justReturnedFromCheckout = params.get('checkout') === 'success'
  const autoOpenPtxn = params.get('_ptxn')

  const { data: subscription, isLoading } = useSubscription()
  const createCheckout = useCreateCheckout()
  const refreshSubscription = useRefreshSubscription()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [paddle, setPaddle] = useState<Paddle | null>(null)
  const [checkoutCompleted, setCheckoutCompleted] = useState(false)

  const clientToken = process.env['NEXT_PUBLIC_PADDLE_CLIENT_TOKEN']
  const paddleEnv = (process.env['NEXT_PUBLIC_PADDLE_ENVIRONMENT'] ?? 'sandbox') as
    | 'sandbox'
    | 'production'

  useEffect(() => {
    if (!clientToken) {
      setErrorMessage(
        'Paddle client token not configured. Set NEXT_PUBLIC_PADDLE_CLIENT_TOKEN.',
      )
      return
    }

    let cancelled = false
    void initializePaddle({
      environment: paddleEnv,
      token: clientToken,
      eventCallback: (event) => {
        if (event.name === 'checkout.completed') {
          setCheckoutCompleted(true)
          setTimeout(() => refreshSubscription(), 1500)
        }
      },
    }).then((instance) => {
      if (!cancelled && instance) setPaddle(instance)
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
      setErrorMessage(null)
      setCheckoutCompleted(false)
      if (!paddle) {
        setErrorMessage('Paddle.js is not ready yet. Please try again in a moment.')
        return
      }
      try {
        const res = await createCheckout.mutateAsync({ plan })
        paddle.Checkout.open({ transactionId: res.transactionId })
      } catch (err) {
        setErrorMessage(
          err instanceof Error ? err.message : 'Failed to start checkout',
        )
      }
    },
    [paddle, createCheckout],
  )

  const currentPlan: BillingPlan = subscription?.plan ?? 'free'

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
                <p className="text-[12.5px] text-text-faint max-w-xs text-right">
                  To cancel or update payment, use the link Paddle emailed on subscription creation.
                </p>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="text-[15px] font-semibold text-text mb-1">Free plan</h2>
                  <p className="text-[13px] text-text-muted">
                    10,000 requests / month · 7-day log retention
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
              const isUpgradeInFlight =
                createCheckout.isPending && createCheckout.variables?.plan === plan.id

              return (
                <div
                  key={plan.id}
                  className={cn(
                    'rounded-xl border p-5 flex flex-col min-h-[280px]',
                    isCurrent ? 'border-accent bg-accent-bg' : 'border-border bg-bg-elev',
                  )}
                >
                  <div className="flex items-start justify-between mb-3">
                    <span className="text-[15px] font-medium text-text">{plan.name}</span>
                    {isCurrent && (
                      <span className="font-mono text-[10px] uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-full border border-accent-border bg-accent-bg text-accent">
                        Current
                      </span>
                    )}
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
                        disabled={isCurrent || createCheckout.isPending || !paddle}
                        onClick={() => void handleUpgrade(plan.id as 'starter' | 'team')}
                        className="w-full h-8 rounded-[6px] bg-text text-bg text-[12.5px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                      >
                        {isCurrent
                          ? 'Current plan'
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
