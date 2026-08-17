'use client'
import Link from 'next/link'
import { AlertTriangle, TrendingUp } from 'lucide-react'
import { useQuota } from '@/lib/queries/use-billing'

/**
 * Quota banner. Shows on /dashboard and /billing.
 *
 * Pattern C states:
 *   < 80%                         → hidden
 *   ≥ 80% & allowed                → amber "approaching limit"
 *   over limit & overage active    → blue "overage billing active — still serving"
 *   over limit & allowed=false     → red "quota exceeded — 429s active"
 */
export function QuotaBanner() {
  const { data: quota } = useQuota()
  if (!quota || quota.limit === null) return null

  const pct = quota.limit > 0 ? quota.usedThisMonth / quota.limit : 0
  if (pct < 0.8) return null

  const overSoftLimit = pct >= 1
  const hardBlocked = overSoftLimit && !quota.allowed
  const overageActive = overSoftLimit && quota.overageActive
  const formattedUsed = quota.usedThisMonth.toLocaleString()
  const formattedLimit = quota.limit.toLocaleString()
  const hardCap = quota.limit * quota.capMultiplier
  const formattedCap = hardCap.toLocaleString()

  // Choose tone. Overage-active is not a failure (requests are still being
  // served), so it reads as a neutral notice rather than a warning.
  const tone = hardBlocked
    ? 'border-bad/30 bg-bad-bg text-bad'
    : overageActive
    ? 'border-border bg-bg-muted text-text'
    : 'border-warn/30 bg-warn-bg text-warn'
  const iconTone = hardBlocked ? 'text-bad' : overageActive ? 'text-text-muted' : 'text-warn'
  const linkTone = hardBlocked
    ? 'text-bad hover:opacity-80'
    : overageActive
    ? 'text-text hover:text-text-muted'
    : 'text-warn hover:opacity-80'

  let title: string
  let detail: string
  let cta: string
  let ctaHref = '/settings'

  if (hardBlocked) {
    // Three sub-cases: free_limit, overage_disabled, hard_cap
    if (quota.plan === 'free') {
      title = 'Free plan quota reached'
      detail = `${formattedUsed} of ${formattedLimit} requests. New requests return 429, upgrade to continue.`
      cta = 'Upgrade plan →'
    } else if (!quota.allowOverage) {
      title = 'Monthly quota exceeded'
      detail = `${formattedUsed} of ${formattedLimit} on the ${quota.plan} plan. Overage billing is disabled, requests return 429.`
      cta = 'Enable overage →'
      ctaHref = '/settings'
    } else {
      title = 'Hard cap reached'
      detail = `${formattedUsed} of ${formattedCap} (${quota.capMultiplier}× cap). Requests return 429. Raise the multiplier in settings, or upgrade.`
      cta = 'Adjust cap →'
      ctaHref = '/settings'
    }
  } else if (overageActive) {
    const overageRequests = quota.usedThisMonth - quota.limit
    title = 'Overage billing active'
    detail = `${formattedUsed} of ${formattedLimit} included, ${overageRequests.toLocaleString()} extra requests will be billed on your next invoice. Hard cap at ${formattedCap}.`
    cta = 'Manage settings →'
    ctaHref = '/settings'
  } else {
    title = `Approaching monthly quota (${Math.round(pct * 100)}% used)`
    detail = `${formattedUsed} of ${formattedLimit} requests this month on the ${quota.plan} plan.`
    cta = 'Upgrade plan →'
  }

  const Icon = hardBlocked ? AlertTriangle : TrendingUp

  return (
    <div className={`rounded-lg border p-4 mb-6 flex items-start gap-3 ${tone}`}>
      <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${iconTone}`} />
      <div className="flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs mt-1 opacity-90">{detail}</p>
      </div>
      <Link href={ctaHref} className={`text-sm font-medium whitespace-nowrap ${linkTone}`}>
        {cta}
      </Link>
    </div>
  )
}
