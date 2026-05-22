'use client'
import { Check } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { cn } from '@/lib/utils'
import { PLANS } from '@/lib/billing-plans'

export default function DemoBillingPage() {
  const currentPlan = 'free'

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col h-screen overflow-hidden">
      <Topbar crumbs={[{ label: 'Demo', href: '/demo/dashboard' }, { label: 'Billing' }]} />

      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-4 md:px-7 md:py-6 max-w-4xl">
          <div className="mb-6">
            <h1 className="text-[22px] font-semibold text-text tracking-[-0.4px] mb-1">Billing</h1>
            <p className="text-[13px] text-text-muted">Manage your subscription and plan</p>
          </div>

          {/* Quota banner */}
          <div className="rounded-xl border border-border bg-bg-elev p-4 mb-6">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-[13px] font-medium text-text">2,400 of 50,000 requests this month</div>
                <div className="text-[11.5px] text-text-faint mt-0.5">Resets on 2026-06-01 · Free plan</div>
              </div>
              <span className="font-mono text-[10px] uppercase tracking-[0.04em] px-2 py-0.5 rounded-full border border-good/20 bg-good-bg text-good">
                4.8% used
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-bg overflow-hidden">
              <div className="h-full rounded-full bg-text transition-all" style={{ width: '4.8%' }} />
            </div>
          </div>

          {/* Current subscription */}
          <div className="rounded-xl border border-border bg-bg-elev p-5 mb-6">
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
          </div>

          {/* Plan cards */}
          <h2 className="text-[14px] font-semibold text-text mb-4">Available plans</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            {PLANS.map((plan) => {
              const isCurrent = currentPlan === plan.id
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
                        <span className="font-mono text-[11px] text-text-muted">/ {plan.pricePeriod}</span>
                      </div>
                    ) : (
                      <div className="font-mono text-[22px] font-medium text-text">Custom</div>
                    )}
                  </div>

                  <p className="text-[12px] text-text-muted mb-4 leading-relaxed">{plan.description}</p>

                  <ul className="space-y-1.5 mb-5 flex-1">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 font-mono text-[10.5px] text-text-muted">
                        <Check className="h-3 w-3 mt-0.5 text-good shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  <div>
                    <button
                      type="button"
                      disabled
                      title="Disabled in demo"
                      className={cn(
                        'w-full h-8 rounded-[6px] text-[12.5px] font-medium cursor-not-allowed',
                        plan.id === 'free'
                          ? 'border border-border bg-bg text-text-faint'
                          : 'bg-text text-bg opacity-60',
                      )}
                    >
                      {plan.id === 'free'
                        ? 'Default'
                        : plan.id === 'enterprise'
                          ? 'Contact sales'
                          : `Upgrade to ${plan.name}`}
                    </button>
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
