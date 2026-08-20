'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { fmtCostKpi } from '@/lib/format'
import type { ModelStat } from '@/lib/queries/use-stats'

const C = {
  text:    'var(--text)',
  muted:   'var(--text-muted)',
  faint:   'var(--text-faint)',
  border:  'var(--border)',
  rule:    'var(--border-strong)',
  track:   'var(--track)',
  bgElev:  'var(--bg-elev)',
  accent:  'var(--accent)',
  mono:    'var(--font-geist-mono), ui-monospace, monospace',
} as const

// Rank colouring: the leader takes the single accent, everything below it goes
// neutral. An earlier version cycled a six-colour palette, which both invented
// meaning the data does not carry (green ≠ cheap) and referenced
// `var(--accent-2)`, a variable that does not exist in the token layer — that
// bar rendered with no fill at all.
const barFill = (rank: number) => (rank === 0 ? C.accent : C.faint)

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
 *
 * Ranked, so colour does not have to carry identity: the top spender is the
 * only accented bar and the tail is neutral. The reader's question here is
 * "what is eating the budget", and sorting answers it before colour does.
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
      <div className="rounded-card border border-border bg-bg-elev px-5 py-[18px]">
        <div className="flex items-center justify-between mb-[14px]">
          <h3 className="text-[13.5px] font-semibold leading-[1.4] text-text">{headerTitle}</h3>
        </div>
        <p className="text-[13px] text-text-faint py-6">No spend recorded in this window.</p>
      </div>
    )
  }

  return (
    <div className="rounded-card border border-border bg-bg-elev px-5 py-[18px]">
      <div className="flex items-center justify-between mb-[14px]">
        <h3 className="text-[13.5px] font-semibold leading-[1.4] text-text">{headerTitle}</h3>
        <span className="font-mono text-[11px] leading-[1.4] text-text-faint">top {sorted.length}</span>
      </div>
      <div className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={sorted}
            layout="vertical"
            margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
            barCategoryGap={6}
          >
            {/* No gridlines. Each bar sits in a slot that runs the full plot
                width, so the slot itself is the ruler and headroom against the
                top spender is readable without a second scale. */}
            <XAxis
              type="number"
              tick={{ fill: C.faint, fontSize: 10, fontFamily: C.mono }}
              tickFormatter={(v: number) => fmtCostKpi(v)}
              tickLine={false}
              axisLine={{ stroke: C.rule }}
            />
            <YAxis
              dataKey="label"
              type="category"
              tick={{ fill: C.muted, fontSize: 12, fontFamily: C.mono }}
              tickLine={false}
              axisLine={false}
              width={170}
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
              cursor={{ fill: 'transparent' }}
              formatter={((value: number, _key: unknown, payload: { payload?: { requests?: number } }) => {
                const requests = payload?.payload?.requests
                return [
                  `${fmtCostKpi(value)}${requests ? ` · ${requests.toLocaleString('en-US')} req` : ''}`,
                  'Cost',
                ] as [string, string]
              }) as never}
            />
            <Bar
              dataKey="cost"
              barSize={10}
              radius={5}
              background={{ fill: C.track, radius: 5 }}
            >
              {sorted.map((_, i) => (
                <Cell key={i} fill={barFill(i)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
