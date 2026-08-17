'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import type { TimeseriesPoint } from '@/lib/queries/types'

const C = {
  text:   'var(--text)',
  faint:  'var(--text-faint)',
  border: 'var(--border)',
  rule:   'var(--border-strong)',
  grid:   'var(--grid)',
  sunk:   'var(--bg-sunk)',
  bgElev: 'var(--bg-elev)',
  mono:   'var(--font-geist-mono), ui-monospace, monospace',
} as const

const TICK = { fontSize: 10, fontFamily: C.mono, fill: C.faint } as const

// Three semantic colours: 429 is its own band so quota issues read as a
// different failure mode from "user typed a bad request" or "upstream is
// melting". Order matters in the stack — 5xx on top because it usually
// matters most operationally.
//
// The ramp is neutral → amber → red on purpose. Plain 4xx is the bulk of most
// error columns and is usually the caller's own bug, so it carries the mass in
// neutral ink and the two operational failures are the only saturated marks in
// the plot. Reusing the accent for 5xx would put the brand colour on the worst
// thing in the card.
const CLR_429 = 'var(--warn)'
const CLR_4XX = 'var(--text-faint)'
const CLR_5XX = 'var(--bad)'

// Cap on bar thickness. Wider than this and a 24-bucket column chart turns
// into a row of slabs that reads as a table, not a shape.
const MAX_BAR = 14

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

  // Which series caps the column. recharts sets the corner radius per series,
  // not per column, so the rounded end goes on the topmost band that actually
  // has data. Without this the fallback shape (everything folded into `4xx`)
  // draws a stack whose only segment is square at both ends.
  const capped: 'e5xx' | 'e429' | 'e4xx' =
    data.some((p) => p.e5xx > 0) ? 'e5xx'
    : data.some((p) => p.e429 > 0) ? 'e429'
    : 'e4xx'
  const CAP: [number, number, number, number] = [3, 3, 0, 0]
  const NO_CAP: [number, number, number, number] = [0, 0, 0, 0]

  const totalAcross = data.reduce((acc, p) => acc + p.e4xx + p.e5xx + p.e429, 0)
  if (totalAcross === 0) {
    return (
      <div className="rounded-card border border-border bg-bg-elev px-5 py-[18px]">
        <div className="flex items-center justify-between mb-[14px]">
          <h3 className="text-[13.5px] font-semibold leading-[1.4] text-text">Errors by class</h3>
          <span className="font-mono text-[11px] leading-[1.4] text-text-faint">{rangeLabel}</span>
        </div>
        <p className="text-[13px] text-text-faint py-6">No errors recorded in this window.</p>
      </div>
    )
  }

  return (
    <div className="rounded-card border border-border bg-bg-elev px-5 py-[18px]">
      <div className="flex items-center justify-between mb-[14px]">
        <h3 className="text-[13.5px] font-semibold leading-[1.4] text-text">Errors by class · {rangeLabel}</h3>
        <div className="flex items-center gap-3 font-mono text-[11px] leading-[1.4] text-text-faint">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-[2px]" style={{ background: CLR_4XX }} />4xx
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-[2px]" style={{ background: CLR_429 }} />429
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-[2px]" style={{ background: CLR_5XX }} />5xx
          </span>
        </div>
      </div>
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }} barCategoryGap={4}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={fmtTimeLabel}
              tick={TICK}
              tickLine={false}
              axisLine={{ stroke: C.rule }}
            />
            <YAxis
              tick={TICK}
              tickLine={false}
              axisLine={false}
              width={32}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                background: C.bgElev,
                border: `1px solid ${C.border}`,
                borderRadius: '10px',
                fontSize: 10,
                fontFamily: C.mono,
              }}
              labelStyle={{ color: C.text }}
              // A soft band behind the whole column, rather than a highlight on
              // one segment, so hovering never recolours the data itself.
              cursor={{ fill: C.sunk, radius: 4 }}
              labelFormatter={((label: string) => fmtTimeLabel(label)) as never}
              formatter={((value: number, key: string) => {
                const labels: Record<string, string> = { e4xx: '4xx', e429: '429', e5xx: '5xx' }
                return [value.toLocaleString('en-US'), labels[key] ?? key] as [string, string]
              }) as never}
            />
            {/* Segments stack from a shared baseline and only the top of the
                column is rounded, so the cap reads as the end of the data and
                not as five separate pills. */}
            <Bar dataKey="e4xx" stackId="e" fill={CLR_4XX} maxBarSize={MAX_BAR} radius={capped === 'e4xx' ? CAP : NO_CAP} />
            <Bar dataKey="e429" stackId="e" fill={CLR_429} maxBarSize={MAX_BAR} radius={capped === 'e429' ? CAP : NO_CAP} />
            <Bar dataKey="e5xx" stackId="e" fill={CLR_5XX} maxBarSize={MAX_BAR} radius={capped === 'e5xx' ? CAP : NO_CAP} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
