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

  // Choose tone
  const tone = hardBlocked
    ? 'border-red-200 bg-red-50 text-red-900'
    : overageActive
    ? 'border-blue-200 bg-blue-50 text-blue-900'
    : 'border-amber-200 bg-amber-50 text-amber-900'
  const iconTone = hardBlocked ? 'text-red-600' : overageActive ? 'text-blue-600' : 'text-amber-600'
  const linkTone = hardBlocked
    ? 'text-red-900 hover:text-red-700'
    : overageActive
    ? 'text-blue-900 hover:text-blue-700'
    : 'text-amber-900 hover:text-amber-700'

  let title: string
  let detail: string
  let cta: string
  let ctaHref = '/billing'

  if (hardBlocked) {
    // Three sub-cases: free_limit, overage_disabled, hard_cap
    if (quota.plan === 'free') {
      title = 'Free plan quota reached'
      detail = `${formattedUsed} of ${formattedLimit} requests. New requests return 429 — upgrade to continue.`
      cta = 'Upgrade plan →'
    } else if (!quota.allowOverage) {
      title = 'Monthly quota exceeded'
      detail = `${formattedUsed} of ${formattedLimit} on the ${quota.plan} plan. Overage billing is disabled — requests return 429.`
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
    detail = `${formattedUsed} of ${formattedLimit} included — ${overageRequests.toLocaleString()} extra requests will be billed on your next invoice. Hard cap at ${formattedCap}.`
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
