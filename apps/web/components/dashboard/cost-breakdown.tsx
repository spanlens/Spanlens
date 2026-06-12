'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { fmtCostKpi } from '@/lib/format'
import type { ModelStat } from '@/lib/queries/use-stats'

const C = {
  text:   'var(--text)',
  faint:  'var(--text-faint)',
  border: 'var(--border)',
  bgElev: 'var(--bg-elev)',
  accent: 'var(--accent)',
} as const

// A small repeatable palette for the model bars. Drawn from the warm
// monochrome dashboard palette so the chart blends with the existing
// KPI tiles instead of fighting them for attention.
const BAR_PALETTE = [
  'var(--accent)',
  'var(--accent-2)',
  'var(--good)',
  'var(--warn)',
  'var(--text-muted)',
  'var(--text-faint)',
]

interface CostBreakdownProps {
  models: ModelStat[]
  /** Limit to the top-N highest-cost rows. Default 6 — beyond that the
   * vertical density gets uncomfortable on the standard tile width. */
  topN?: number
  /** Range label shown in the card header (e.g. "24h", "7d") so this
   * card matches the Token volume / Errors by class siblings. */
  rangeLabel?: string
}

/**
 * Cost-by-model horizontal bar chart for the main dashboard.
 *
 * Why horizontal: model labels (`anthropic / claude-sonnet-4-6`) are long
 * and don't fit on a vertical bar's X axis without truncation. Horizontal
 * orientation reads naturally as "biggest cost first" and the label has
 * room to breathe on the left side.
 *
 * Tooltip carries the absolute USD; the bar length itself encodes the
 * share visually so we don't need to render percent text alongside.
 */
export function CostBreakdownCard({ models, topN = 6, rangeLabel }: CostBreakdownProps) {
  const sorted = [...models]
    .filter((m) => m.totalCostUsd > 0)
    .sort((a, b) => b.totalCostUsd - a.totalCostUsd)
    .slice(0, topN)
    .map((m) => ({
      // Provider/model collapsed to one label — the slash separates the two
      // dimensions naturally and keeps the recharts payload simple.
      label: `${m.provider} / ${m.model}`,
      cost: m.totalCostUsd,
      requests: m.requests,
    }))

  const headerTitle = rangeLabel ? `Cost by model · ${rangeLabel}` : 'Cost by model'

  if (sorted.length === 0) {
    return (
      <div className="rounded-md border border-border bg-bg-elev p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[14px] font-medium text-text">{headerTitle}</h3>
        </div>
        <p className="text-[13px] text-text-faint py-6">No spend recorded in this window.</p>
      </div>
    )
  }

  return (
    <div className="rounded-md border border-border bg-bg-elev p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[14px] font-medium text-text">{headerTitle}</h3>
        <span className="text-[11px] text-text-faint font-mono">top {sorted.length}</span>
      </div>
      <div className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={sorted}
            layout="vertical"
            margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
            barCategoryGap={6}
          >
            <CartesianGrid stroke={C.border} strokeDasharray="2 4" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fill: C.faint, fontSize: 10 }}
              tickFormatter={(v: number) => fmtCostKpi(v)}
              stroke={C.border}
            />
            <YAxis
              dataKey="label"
              type="category"
              tick={{ fill: C.text, fontSize: 11 }}
              width={170}
              stroke={C.border}
            />
            <Tooltip
              contentStyle={{ background: C.bgElev, border: `1px solid ${C.border}`, fontSize: 12 }}
              labelStyle={{ color: C.text }}
              formatter={((value: number, _key: unknown, payload: { payload?: { requests?: number } }) => {
                const requests = payload?.payload?.requests
                return [
                  `${fmtCostKpi(value)}${requests ? ` · ${requests.toLocaleString('en-US')} req` : ''}`,
                  'Cost',
                ] as [string, string]
              }) as never}
            />
            <Bar dataKey="cost" radius={[0, 3, 3, 0]}>
              {sorted.map((_, i) => (
                <Cell key={i} fill={BAR_PALETTE[i % BAR_PALETTE.length] ?? 'var(--accent)'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
