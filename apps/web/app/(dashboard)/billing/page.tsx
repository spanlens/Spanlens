'use client'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Check } from 'lucide-react'
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

export default function BillingPage() {
  const params = useSearchParams()
  const justReturnedFromCheckout = params.get('checkout') === 'success'

  const { data: subscription, isLoading } = useSubscription()
  const createCheckout = useCreateCheckout()
  const refreshSubscription = useRefreshSubscription()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // When the user returns from Paddle checkout (?checkout=success), refresh
  // the subscription query so the new plan shows up without a manual reload.
  useEffect(() => {
    if (justReturnedFromCheckout) refreshSubscription()
  }, [justReturnedFromCheckout, refreshSubscription])

  async function handleUpgrade(plan: 'starter' | 'team') {
    setErrorMessage(null)
    try {
      const res = await createCheckout.mutateAsync({
        plan,
        successUrl: `${window.location.origin}/billing?checkout=success`,
      })
      window.location.href = res.url
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to start checkout',
      )
    }
  }

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
              {/* Manage via Paddle customer portal — opens Paddle's hosted portal */}
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

      {justReturnedFromCheckout && (
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
              (createCheckout.variables?.plan === plan.id)

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
                        disabled={isCurrent || createCheckout.isPending}
                        onClick={() => void handleUpgrade(upgradeTarget)}
                      >
                        {isCurrent
                          ? 'Current plan'
                          : isUpgradeInFlight
                            ? 'Redirecting…'
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
