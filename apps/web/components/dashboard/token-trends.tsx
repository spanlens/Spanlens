'use client'

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import type { TimeseriesPoint } from '@/lib/queries/types'

const C = {
  text:   'var(--text)',
  faint:  'var(--text-faint)',
  border: 'var(--border)',
  rule:   'var(--border-strong)',
  grid:   'var(--grid)',
  bgElev: 'var(--bg-elev)',
  mono:   'var(--font-geist-mono), ui-monospace, monospace',
  // One accent plus neutrals. Prompt tokens are almost always the larger,
  // duller half of the total, so they carry the mass in neutral ink and the
  // accent is spent on completion — the band that actually moves cost per
  // call when an output gets longer. An earlier draft paired accent with
  // `var(--good)`, which put a success colour on a plain volume measure.
  prompt:     'var(--text-faint)',
  completion: 'var(--accent)',
} as const

const TICK = { fontSize: 10, fontFamily: C.mono, fill: C.faint } as const

interface TokenTrendsProps {
  series: TimeseriesPoint[]
  /** Range label shown in the card header (e.g. "24h", "7d"). */
  rangeLabel?: string
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
  return n.toLocaleString('en-US')
}

function fmtTimeLabel(iso: string): string {
  // Match the convention used on /dashboard's Traffic & spend chart — short
  // hour-of-day for sub-day ranges, MMM D for multi-day.
  const d = new Date(iso)
  const now = Date.now()
  const ageHours = (now - d.getTime()) / 3_600_000
  if (ageHours <= 36) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true })
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Input + output token volume over time as a stacked area chart.
 *
 * Why stacked area: the spend chart sits above and answers "how much did
 * we pay". This chart answers the obvious follow-up — "was it because we
 * sent more tokens, or because the output got longer?". Prompt tokens
 * on the bottom (cheaper, larger volume usually) + completion tokens on
 * top (pricier, smaller volume) makes the cost split visually intuitive
 * even before users learn the per-token rates.
 *
 * Falls back gracefully when the API didn't return the new prompt/completion
 * fields (older response shape, the demo fixture, etc.) by reusing the
 * legacy `tokens` field on the bottom area only.
 */
export function TokenTrendsCard({ series, rangeLabel = '24h' }: TokenTrendsProps) {
  const data = series.map((p) => ({
    date: p.date,
    promptTokens: p.promptTokens ?? Math.max(0, (p.tokens ?? 0) - (p.completionTokens ?? 0)),
    completionTokens: p.completionTokens ?? 0,
  }))

  // Empty buckets — recharts still renders a frame but the user sees nothing
  // useful, so show an explicit empty state instead.
  const totalAcross = data.reduce(
    (acc, p) => acc + p.promptTokens + p.completionTokens,
    0,
  )
  if (totalAcross === 0) {
    return (
      <div className="rounded-card border border-border bg-bg-elev px-5 py-[18px]">
        <div className="flex items-center justify-between mb-[14px]">
          <h3 className="text-[13.5px] font-semibold leading-[1.4] text-text">Token volume</h3>
          <span className="font-mono text-[11px] leading-[1.4] text-text-faint">{rangeLabel}</span>
        </div>
        <p className="text-[13px] text-text-faint py-6">No token usage recorded in this window.</p>
      </div>
    )
  }

  return (
    <div className="rounded-card border border-border bg-bg-elev px-5 py-[18px]">
      <div className="flex items-center justify-between mb-[14px]">
        <h3 className="text-[13.5px] font-semibold leading-[1.4] text-text">Token volume · {rangeLabel}</h3>
        <div className="flex items-center gap-3 font-mono text-[11px] leading-[1.4] text-text-faint">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-[2px]" style={{ background: C.prompt }} />
            prompt
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-[2px]" style={{ background: C.completion }} />
            completion
          </span>
        </div>
      </div>
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            {/* Flat fills, no vertical gradient. A gradient makes the bottom of
                a band lighter than its top for no reason in the data, which is
                exactly the kind of decoration this system rules out. */}
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={fmtTimeLabel}
              tick={TICK}
              tickLine={false}
              axisLine={{ stroke: C.rule }}
            />
            <YAxis
              tickFormatter={fmtTokens}
              tick={TICK}
              tickLine={false}
              axisLine={false}
              width={42}
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
              cursor={{ stroke: C.rule, strokeWidth: 1 }}
              labelFormatter={((label: string) => fmtTimeLabel(label)) as never}
              formatter={((value: number, key: string) => [
                fmtTokens(value),
                key === 'promptTokens' ? 'Prompt' : 'Completion',
              ] as [string, string]) as never}
            />
            <Legend wrapperStyle={{ display: 'none' }} />
            <Area
              type="monotone"
              dataKey="promptTokens"
              stackId="t"
              stroke={C.prompt}
              strokeWidth={1.5}
              fill={C.prompt}
              fillOpacity={0.22}
            />
            <Area
              type="monotone"
              dataKey="completionTokens"
              stackId="t"
              stroke={C.completion}
              strokeWidth={1.5}
              fill={C.completion}
              fillOpacity={0.22}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
