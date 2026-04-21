'use client'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Check } from 'lucide-react'
import { initializePaddle, type Paddle } from '@paddle/paddle-js'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  useSubscription,
  useCreateCheckout,
  useRefreshSubscription,
} from '@/lib/queries/use-billing'
import type { BillingPlan } from '@/lib/queries/types'

interface PlanCardConfig {
  id: BillingPlan
  name: string
  priceUsd: number | null // null = custom pricing
  pricePeriod: string
  description: string
  features: string[]
}

const PLANS: PlanCardConfig[] = [
  {
    id: 'free',
    name: 'Free',
    priceUsd: 0,
    pricePeriod: 'forever',
    description: 'For evaluation and small personal projects.',
    features: [
      '10,000 requests / month',
      '7-day log retention',
      '1 project',
      'Community support',
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    priceUsd: 19,
    pricePeriod: 'per month',
    description: 'For production apps and small teams.',
    features: [
      '100,000 requests / month',
      '30-day log retention',
      'Unlimited projects',
      'Agent tracing',
      'Email alerts',
      'Email support',
    ],
  },
  {
    id: 'team',
    name: 'Team',
    priceUsd: 49,
    pricePeriod: 'per month',
    description: 'For growing teams with heavier workloads.',
    features: [
      '500,000 requests / month',
      '90-day log retention',
      'Slack / Discord alerts',
      'Team roles & audit log',
      'Priority support',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    priceUsd: null,
    pricePeriod: 'custom',
    description: 'SSO, on-prem, custom SLAs.',
    features: [
      'Custom request volume',
      '1-year log retention',
      'SSO / SAML',
      'Dedicated Slack channel',
      'Custom SLA',
    ],
  },
]

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString()
}

/**
 * Paddle Billing does NOT provide a full-page hosted checkout like Stripe.
 * Instead we embed Paddle.js on this page and open an overlay checkout.
 *
 * Flow:
 *   1. POST /api/v1/billing/checkout  →  server creates transaction + returns txn_id
 *   2. paddle.Checkout.open({ transactionId })  →  overlay opens on top of this page
 *   3. paddle.on('checkout.completed', ...)  →  show success banner, refetch subscription
 *
 * If Paddle redirects back to `/billing?_ptxn=txn_xxx` (happens when the user lands
 * here via the Paddle-generated URL instead of from the button), auto-open the
 * overlay for that transaction so the flow resumes seamlessly.
 */
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

  // Initialize Paddle.js once on mount
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
          // Give Paddle a moment to send the webhook before refetching
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

  // Refresh subscription on return from checkout (legacy ?checkout=success path)
  useEffect(() => {
    if (justReturnedFromCheckout) refreshSubscription()
  }, [justReturnedFromCheckout, refreshSubscription])

  // If user landed here with ?_ptxn=... (Paddle redirected here from our API),
  // auto-open the overlay for that transaction.
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
    <div className="max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manage your subscription and plan
        </p>
      </div>

      {/* Current subscription summary */}
      <section className="mb-8">
        <div className="rounded-lg border bg-white p-5">
          {isLoading ? (
            <>
              <Skeleton className="h-5 w-40 mb-2" />
              <Skeleton className="h-4 w-64" />
            </>
          ) : subscription ? (
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-base capitalize">
                    {subscription.plan} plan
                  </h2>
                  <Badge
                    variant={
                      subscription.status === 'active'
                        ? 'success'
                        : subscription.status === 'past_due'
                          ? 'destructive'
                          : 'secondary'
                    }
                    className="capitalize"
                  >
                    {subscription.status}
                  </Badge>
                  {subscription.cancel_at_period_end && (
                    <Badge variant="secondary">Cancels at period end</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {subscription.current_period_end
                    ? subscription.cancel_at_period_end
                      ? `Access until ${formatDate(subscription.current_period_end)}`
                      : `Renews on ${formatDate(subscription.current_period_end)}`
                    : 'Active'}
                </p>
              </div>
              <div className="text-sm text-muted-foreground">
                To cancel or update payment method, use the link Paddle emailed
                on subscription creation.
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-base">Free plan</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  10,000 requests / month · 7-day log retention
                </p>
              </div>
              <Badge variant="secondary">Free</Badge>
            </div>
          )}
        </div>
      </section>

      {(justReturnedFromCheckout || checkoutCompleted) && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 mb-6 text-sm text-green-900">
          Checkout complete. Your plan will update shortly once Paddle confirms
          the payment — this page will refresh automatically.
        </div>
      )}

      {errorMessage && (
        <div className="rounded-lg border border-destructive bg-red-50 p-4 mb-6 text-sm text-red-800">
          {errorMessage}
        </div>
      )}

      {/* Plan cards */}
      <section>
        <h2 className="text-base font-semibold mb-4">Available plans</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {PLANS.map((plan) => {
            const isCurrent = currentPlan === plan.id
            const isUpgradeInFlight =
              createCheckout.isPending &&
              createCheckout.variables?.plan === plan.id

            return (
              <div
                key={plan.id}
                className={cn(
                  'rounded-lg border bg-white p-5 flex flex-col',
                  isCurrent && 'border-blue-500 ring-2 ring-blue-200',
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-semibold">{plan.name}</h3>
                  {isCurrent && (
                    <Badge variant="default" className="bg-blue-600">
                      Current
                    </Badge>
                  )}
                </div>

                <div className="mb-3">
                  {plan.priceUsd !== null ? (
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-bold">
                        ${plan.priceUsd}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        / {plan.pricePeriod}
                      </span>
                    </div>
                  ) : (
                    <div className="text-2xl font-bold">Custom</div>
                  )}
                </div>

                <p className="text-sm text-muted-foreground mb-4">
                  {plan.description}
                </p>

                <ul className="space-y-2 mb-5 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <Check className="h-4 w-4 mt-0.5 text-green-600 shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                {plan.id === 'free' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled
                    className="w-full"
                  >
                    Default
                  </Button>
                ) : plan.id === 'enterprise' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() =>
                      window.open('mailto:sales@spanlens.io', '_blank')
                    }
                  >
                    Contact sales
                  </Button>
                ) : plan.id === 'starter' || plan.id === 'team' ? (
                  (() => {
                    const upgradeTarget: 'starter' | 'team' = plan.id
                    return (
                      <Button
                        size="sm"
                        className="w-full"
                        disabled={
                          isCurrent ||
                          createCheckout.isPending ||
                          !paddle
                        }
                        onClick={() => void handleUpgrade(upgradeTarget)}
                      >
                        {isCurrent
                          ? 'Current plan'
                          : isUpgradeInFlight
                            ? 'Opening checkout…'
                            : !paddle
                              ? 'Loading…'
                              : `Upgrade to ${plan.name}`}
                      </Button>
                    )
                  })()
                ) : null}
              </div>
            )
          })}
        </div>

        <p className="text-xs text-muted-foreground mt-4">
          Payments processed securely by Paddle. VAT / sales tax included where
          applicable.
        </p>
      </section>
    </div>
  )
}
