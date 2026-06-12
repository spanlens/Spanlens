'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import type { TimeseriesPoint } from '@/lib/queries/types'

const C = {
  text:   'var(--text)',
  faint:  'var(--text-faint)',
  border: 'var(--border)',
  bgElev: 'var(--bg-elev)',
} as const

// Three semantic colours: 429 is its own band so quota issues read as a
// different failure mode from "user typed a bad request" or "upstream is
// melting". Order matters in the stack — 5xx on top because it usually
// matters most operationally.
const CLR_429 = 'var(--warn)'
const CLR_4XX = 'var(--text-muted)'
const CLR_5XX = 'var(--accent)'

interface ErrorDistributionProps {
  series: TimeseriesPoint[]
  rangeLabel?: string
}

function fmtTimeLabel(iso: string): string {
  const d = new Date(iso)
  const ageHours = (Date.now() - d.getTime()) / 3_600_000
  if (ageHours <= 36) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true })
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Error count per bucket, stacked by status-code class.
 *
 * Why three bands instead of just `errors`: the Error Rate KPI tile already
 * shows the headline percentage; this chart's job is the next question —
 * "what kind of errors". A 429 spike means the customer is over quota
 * upstream, a 5xx spike means a provider outage, and 4xx-other usually
 * means an SDK or schema regression on the customer's side. Each calls
 * for a different escalation.
 *
 * Backward-compat: when the API returns the older shape without
 * `errors4xx`/`errors5xx`/`errors429`, we fold everything into a single
 * `Other` bar so we don't drop the bucket.
 */
export function ErrorDistributionCard({ series, rangeLabel = '24h' }: ErrorDistributionProps) {
  const data = series.map((p) => {
    const e429 = p.errors429 ?? 0
    const e5xx = p.errors5xx ?? 0
    const e4xxAll = p.errors4xx ?? 0
    const e4xxOther = Math.max(0, e4xxAll - e429)
    // Fall back to bundled `errors` if none of the split fields are present.
    const haveSplit = p.errors4xx != null || p.errors5xx != null
    const otherBucket = haveSplit ? e4xxOther : Math.max(0, (p.errors ?? 0) - e5xx - e429)
    return {
      date: p.date,
      e4xx: otherBucket,
      e5xx,
      e429,
    }
  })

  const totalAcross = data.reduce((acc, p) => acc + p.e4xx + p.e5xx + p.e429, 0)
  if (totalAcross === 0) {
    return (
      <div className="rounded-md border border-border bg-bg-elev p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[14px] font-medium text-text">Errors by class</h3>
          <span className="text-[11px] text-text-faint font-mono">{rangeLabel}</span>
        </div>
        <p className="text-[13px] text-text-faint py-6">No errors recorded in this window.</p>
      </div>
    )
  }

  return (
    <div className="rounded-md border border-border bg-bg-elev p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[14px] font-medium text-text">Errors by class · {rangeLabel}</h3>
        <div className="flex items-center gap-3 text-[11px] text-text-faint font-mono">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: CLR_4XX }} />4xx
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: CLR_429 }} />429
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: CLR_5XX }} />5xx
          </span>
        </div>
      </div>
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }} barCategoryGap={2}>
            <CartesianGrid stroke={C.border} strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={fmtTimeLabel}
              tick={{ fill: C.faint, fontSize: 10 }}
              stroke={C.border}
            />
            <YAxis
              tick={{ fill: C.faint, fontSize: 10 }}
              stroke={C.border}
              width={32}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{ background: C.bgElev, border: `1px solid ${C.border}`, fontSize: 12 }}
              labelStyle={{ color: C.text }}
              labelFormatter={((label: string) => fmtTimeLabel(label)) as never}
              formatter={((value: number, key: string) => {
                const labels: Record<string, string> = { e4xx: '4xx', e429: '429', e5xx: '5xx' }
                return [value.toLocaleString('en-US'), labels[key] ?? key] as [string, string]
              }) as never}
            />
            <Bar dataKey="e4xx" stackId="e" fill={CLR_4XX} />
            <Bar dataKey="e429" stackId="e" fill={CLR_429} />
            <Bar dataKey="e5xx" stackId="e" fill={CLR_5XX} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
