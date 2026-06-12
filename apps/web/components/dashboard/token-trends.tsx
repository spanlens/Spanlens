'use client'

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import type { TimeseriesPoint } from '@/lib/queries/types'

const C = {
  text:   'var(--text)',
  faint:  'var(--text-faint)',
  border: 'var(--border)',
  bgElev: 'var(--bg-elev)',
  // Prompt = accent (orange). Completion = good (green) — chosen because
  // it contrasts cleanly with the prompt band in both themes and isn't
  // already used by the Errors-by-class card sitting next to this one.
  // An earlier draft used `var(--accent-2)` which doesn't exist in the
  // current theme, so the completion band rendered near-invisible.
  prompt:     'var(--accent)',
  completion: 'var(--good)',
} as const

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
      <div className="rounded-md border border-border bg-bg-elev p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[14px] font-medium text-text">Token volume</h3>
          <span className="text-[11px] text-text-faint font-mono">{rangeLabel}</span>
        </div>
        <p className="text-[13px] text-text-faint py-6">No token usage recorded in this window.</p>
      </div>
    )
  }

  return (
    <div className="rounded-md border border-border bg-bg-elev p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[14px] font-medium text-text">Token volume · {rangeLabel}</h3>
        <div className="flex items-center gap-3 text-[11px] text-text-faint font-mono">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: C.prompt }} />
            prompt
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: C.completion }} />
            completion
          </span>
        </div>
      </div>
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            <defs>
              <linearGradient id="gradPrompt" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.prompt} stopOpacity={0.55} />
                <stop offset="100%" stopColor={C.prompt} stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="gradCompletion" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.completion} stopOpacity={0.55} />
                <stop offset="100%" stopColor={C.completion} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={C.border} strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={fmtTimeLabel}
              tick={{ fill: C.faint, fontSize: 10 }}
              stroke={C.border}
            />
            <YAxis
              tickFormatter={fmtTokens}
              tick={{ fill: C.faint, fontSize: 10 }}
              stroke={C.border}
              width={42}
            />
            <Tooltip
              contentStyle={{ background: C.bgElev, border: `1px solid ${C.border}`, fontSize: 12 }}
              labelStyle={{ color: C.text }}
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
              fill="url(#gradPrompt)"
            />
            <Area
              type="monotone"
              dataKey="completionTokens"
              stackId="t"
              stroke={C.completion}
              strokeWidth={1.5}
              fill="url(#gradCompletion)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
