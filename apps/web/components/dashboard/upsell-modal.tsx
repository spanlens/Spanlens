'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { TrendingUp, Check } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useQuota } from '@/lib/queries/use-billing'
import { PLANS, PLAN_REQUEST_LIMITS, formatPlanLabel } from '@/lib/billing-plans'
import type { BillingPlan } from '@/lib/queries/types'

/**
 * Quota upsell modal. When an org crosses 80% of its monthly request quota
 * it gets a single, dismissible prompt to upgrade — with the next plan
 * pre-selected so the billing page opens straight on the right card.
 *
 * This complements the always-visible {@link QuotaBanner}: the banner is
 * passive context, the modal is the one-time nudge at the moment it matters.
 *
 * Show discipline:
 *   - Only fires ≥ 80% usage, and only when there's a higher plan to sell.
 *   - Once per browser session (so it doesn't reopen on every navigation).
 *   - Dismissing snoozes it for the rest of the calendar month.
 *
 * The open decision runs in an effect (client-only) so reading storage /
 * the current date never diverges between SSR and hydration (gotcha #22).
 */

/** Next plan up from the current one, or null if already at the top. */
const NEXT_PLAN: Partial<Record<BillingPlan, Exclude<BillingPlan, 'free' | 'enterprise'>>> = {
  free: 'starter',
  starter: 'team',
}

function monthKey(plan: string): string {
  const now = new Date() // client-only (called from effect / handler)
  return `spanlens:upsell_dismissed:${plan}:${now.getUTCFullYear()}-${now.getUTCMonth()}`
}

export function UpsellModal() {
  const { data: quota } = useQuota()
  const [open, setOpen] = useState(false)

  const targetId = quota ? NEXT_PLAN[quota.plan] : undefined

  useEffect(() => {
    if (!quota || quota.limit === null || !targetId) return
    const pct = quota.limit > 0 ? quota.usedThisMonth / quota.limit : 0
    if (pct < 0.8) return
    try {
      if (localStorage.getItem(monthKey(quota.plan)) === '1') return
      if (sessionStorage.getItem('spanlens:upsell_shown') === '1') return
      sessionStorage.setItem('spanlens:upsell_shown', '1')
    } catch {
      // storage blocked (private mode) — showing once is acceptable
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- gated on async quota arrival + storage read, no derived-state path
    setOpen(true)
  }, [quota, targetId])

  if (!quota || quota.limit === null || !targetId) return null

  const target = PLANS.find((p) => p.id === targetId)
  if (!target) return null

  const pct = quota.limit > 0 ? quota.usedThisMonth / quota.limit : 0
  const overLimit = pct >= 1
  const targetLimit = PLAN_REQUEST_LIMITS[targetId] ?? 0

  function dismiss() {
    try {
      localStorage.setItem(monthKey(quota!.plan), '1')
    } catch {
      /* ignore */
    }
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) dismiss() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-accent" />
            {overLimit
              ? `You've hit your ${formatPlanLabel(quota.plan)} limit`
              : `You're approaching your ${formatPlanLabel(quota.plan)} limit`}
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          {quota.usedThisMonth.toLocaleString()} of {quota.limit.toLocaleString()} requests used
          this month. Upgrade to{' '}
          <span className="font-medium text-foreground">{target.name}</span> for{' '}
          {targetLimit.toLocaleString()} requests / month and keep shipping without interruption.
        </p>

        <div className="rounded-lg border border-border p-4">
          <div className="flex items-baseline justify-between mb-3">
            <span className="text-sm font-semibold">{target.name}</span>
            {target.priceUsd !== null && (
              <span className="text-sm text-muted-foreground">
                <span className="text-foreground font-semibold">${target.priceUsd}</span> /{' '}
                {target.pricePeriod.replace('per ', '')}
              </span>
            )}
          </div>
          <ul className="space-y-1.5">
            {target.features.slice(0, 4).map((f) => (
              <li key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                <Check className="w-3.5 h-3.5 text-good shrink-0" />
                {f}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={dismiss}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-2"
          >
            Maybe later
          </button>
          <Link
            href={`/billing?plan=${targetId}`}
            onClick={() => setOpen(false)}
            className="text-sm font-medium bg-accent text-accent-fg hover:opacity-90 transition-opacity rounded-md px-4 py-2 inline-flex items-center gap-1.5"
          >
            Upgrade to {target.name}
            <span aria-hidden>→</span>
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  )
}
