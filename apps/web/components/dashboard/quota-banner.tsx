'use client'
import Link from 'next/link'
import { AlertTriangle, TrendingUp } from 'lucide-react'
import { useQuota } from '@/lib/queries/use-billing'

/**
 * Banner that shows on the dashboard when the user is approaching or has
 * exceeded their monthly request quota. Dismissible-free: we want the user
 * to see it every time they load the dashboard.
 *
 * Thresholds:
 *   > 100% → red "Over quota — requests are being throttled"
 *   ≥ 80%  → amber "Approaching limit"
 *   < 80%  → hidden
 */
export function QuotaBanner() {
  const { data: quota } = useQuota()
  if (!quota || quota.limit === null) return null

  const pct = quota.limit > 0 ? quota.usedThisMonth / quota.limit : 0
  if (pct < 0.8) return null

  const over = pct >= 1
  const formattedUsed = quota.usedThisMonth.toLocaleString()
  const formattedLimit = quota.limit.toLocaleString()

  return (
    <div
      className={
        over
          ? 'rounded-lg border border-red-200 bg-red-50 p-4 mb-6 flex items-start gap-3'
          : 'rounded-lg border border-amber-200 bg-amber-50 p-4 mb-6 flex items-start gap-3'
      }
    >
      {over ? (
        <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
      ) : (
        <TrendingUp className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
      )}
      <div className="flex-1">
        <p className={over ? 'text-sm font-semibold text-red-900' : 'text-sm font-semibold text-amber-900'}>
          {over
            ? 'Monthly request quota exceeded'
            : `Approaching monthly quota (${Math.round(pct * 100)}% used)`}
        </p>
        <p className={over ? 'text-xs text-red-800 mt-1' : 'text-xs text-amber-800 mt-1'}>
          {formattedUsed} of {formattedLimit} requests this month on the{' '}
          <span className="capitalize font-medium">{quota.plan}</span> plan.
          {over ? ' New requests are being rejected with HTTP 429.' : ''}
        </p>
      </div>
      <Link
        href="/billing"
        className={
          over
            ? 'text-sm font-medium text-red-900 hover:text-red-700 whitespace-nowrap'
            : 'text-sm font-medium text-amber-900 hover:text-amber-700 whitespace-nowrap'
        }
      >
        Upgrade plan →
      </Link>
    </div>
  )
}
