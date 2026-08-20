'use client'
import { Topbar } from '@/components/layout/topbar'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PLANS } from '@/lib/billing-plans'

/** Pill recipe shared by the chips in the current-plan card header. */
const PILL = 'inline-flex items-center rounded-full px-2 py-[3px] font-mono text-[10.5px]'

// Sample figures for the no-signup demo. Fixed values, not derived from any
// account, so the page renders identically for every visitor.
const USED_REQUESTS = 2_400
const INCLUDED_REQUESTS = 50_000

export default function DemoBillingPage() {
  const currentPlan = 'free'
  const planConfig = PLANS.find((p) => p.id === currentPlan)
  const usedPct = (USED_REQUESTS / INCLUDED_REQUESTS) * 100

  return (
    <>
      {/* The topbar is the only full-bleed row: it cancels the padding the
          demo layout applies so its hairline spans the whole main column. */}
      <div className="sticky top-0 z-20 -mx-4 -mt-4 md:-mx-7 md:-mt-5 bg-bg">
        <Topbar crumbs={[{ label: 'Demo', href: '/demo/dashboard' }, { label: 'Billing' }]} />
      </div>
      <h1 className="sr-only">Billing</h1>

      <div className="grid grid-cols-1 items-start gap-4 pt-4 md:pt-5 lg:grid-cols-2">
        {/* ── Current plan ────────────────────────────────────────────── */}
        <Card className="flex flex-col">
          <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
            <CardTitle>Current plan</CardTitle>
            <span className={cn(PILL, 'bg-accent-bg text-accent')}>{planConfig?.name}</span>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col">
            <div className="flex items-baseline gap-1.5">
              <span className="font-display text-[28px] leading-[1.05] track-kpi text-text">
                ${planConfig?.priceUsd}
              </span>
              <span className="font-mono text-[12px] text-text-muted">
                / {planConfig?.pricePeriod}
              </span>
            </div>
            <p className="mt-2 text-[12.5px] text-text-muted">
              Resets on 2026-06-01. {planConfig?.description}
            </p>

            <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-track">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${usedPct}%` }}
              />
            </div>

            <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-3">
              <span className="font-mono text-[11.5px] text-text-faint">
                {USED_REQUESTS.toLocaleString()} of {INCLUDED_REQUESTS.toLocaleString()} requests
              </span>
              <span className="font-mono text-[11.5px] text-text-faint">
                {usedPct.toFixed(1)}% used
              </span>
            </div>
          </CardContent>
        </Card>

        {/* ── Available plans ─────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Available plans</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5">
            {PLANS.map((plan) => {
              const isCurrent = currentPlan === plan.id
              return (
                <div
                  key={plan.id}
                  className={cn(
                    'flex items-start justify-between gap-3 rounded-lg px-4 py-3.5',
                    isCurrent ? 'bg-bg-muted' : 'border border-border',
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-[12.5px] font-semibold text-text">{plan.name}</span>
                      <span className="font-mono text-[12px] text-text-muted">
                        {plan.priceUsd !== null ? `$${plan.priceUsd}` : 'talk to us'}
                      </span>
                    </div>
                    <p className="mt-1 text-[11.5px] text-text-muted">{plan.description}</p>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-text-faint">
                      {plan.features.join(' · ')}
                    </p>
                  </div>

                  <div className="shrink-0 self-center">
                    {isCurrent ? (
                      <span className="text-[11.5px] text-text-faint">current</span>
                    ) : (
                      <button
                        type="button"
                        disabled
                        title="Disabled in demo"
                        className="cursor-not-allowed rounded-full bg-text px-3.5 py-2 text-[12px] font-medium text-bg opacity-60"
                      >
                        {plan.id === 'enterprise' ? 'Contact sales' : 'Switch'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>

        <p className="font-mono text-[11px] text-text-faint lg:col-span-2">
          Payments processed securely by Paddle. VAT / sales tax included where applicable.
        </p>
      </div>
    </>
  )
}
