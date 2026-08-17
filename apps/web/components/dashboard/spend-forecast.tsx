'use client'

import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { cn } from '@/lib/utils'
import type { SpendForecast } from '@/lib/queries/types'

const C = {
  text:   'var(--text)',
  border: 'var(--border)',
  rule:   'var(--border-strong)',
  grid:   'var(--grid)',
  faint:  'var(--text-faint)',
  bg:     'var(--bg)',
  bgElev: 'var(--bg-elev)',
  mono:   'var(--font-geist-mono), ui-monospace, monospace',
} as const

const TICK = { fontSize: 10, fontFamily: C.mono, fill: C.faint } as const

import { fmtCostKpi as fmtCost } from '@/lib/format'

interface SpendForecastCardProps {
  data: SpendForecast
}

export function SpendForecastCard({ data }: SpendForecastCardProps) {
  const {
    monthToDate,
    dayOfMonth,
    daysInMonth,
    dailyAvgUsd,
    projectedMonthEndUsd,
    weeklyDeltaPct,
    dailyTrendUsd,
    timeseries,
  } = data

  const formatted = timeseries.map((d) => ({
    ...d,
    label: d.date.slice(5),
  }))

  const todayLabel = formatted.find((d) => d.actual !== null && d.projected !== null)?.label ?? ''
  const tickInterval = Math.max(1, Math.floor(formatted.length / 5))

  return (
    // Carries its own card chrome. It used to render as a bare section with a
    // bottom hairline, which read as a naked block once the dashboard moved to
    // a card canvas and both call sites had to wrap it to compensate.
    <div className="card-surface rounded-card px-5 py-[18px]">
      {/* Header */}
      <div className="flex items-center mb-4">
        <span className="text-[13.5px] font-semibold leading-[1.4] text-text">
          This month · spend forecast
        </span>
        <div className="ml-auto flex items-center gap-5">
          <span className="flex items-center gap-1.5 font-mono text-[11px] leading-[1.4] text-text-faint">
            <svg width="18" height="8" aria-hidden>
              <line x1="0" y1="4" x2="18" y2="4" stroke={C.text} strokeWidth="1.5" />
            </svg>
            Actual
          </span>
          <span className="flex items-center gap-1.5 font-mono text-[11px] leading-[1.4] text-text-faint">
            <svg width="18" height="8" aria-hidden>
              <line x1="0" y1="4" x2="18" y2="4" stroke={C.faint} strokeWidth="1.5" strokeDasharray="4 3" />
            </svg>
            Projected
          </span>
        </div>
      </div>

      {/* Stat cards. Same figure ramp as the KPI row above them: display face,
          28px, KPI tracking, so the two read as one family. */}
      <div className="grid grid-cols-2 border border-border rounded-lg mb-4 overflow-hidden">
        <div className="p-[18px] border-r border-border">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-faint mb-2.5">
            Month to date
          </div>
          <div className="font-display text-[28px] track-kpi leading-[1.05]! text-text mb-1.5">
            {fmtCost(monthToDate)}
          </div>
          <div className="font-mono text-[11px] leading-[1.4] text-text-muted">
            Day {dayOfMonth} of {daysInMonth} · {fmtCost(dailyAvgUsd)} / day avg
          </div>
        </div>

        <div className="p-[18px]">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-faint mb-2.5">
            Projected · month end
          </div>
          <div className="flex items-baseline gap-2.5 mb-1.5">
            <span className="font-display text-[28px] track-kpi leading-[1.05]! text-text">
              ~{fmtCost(projectedMonthEndUsd)}
            </span>
            {weeklyDeltaPct != null && (
              // Rising spend is a bad delta, not an accent event. The accent is
              // reserved for the data mark the reader is meant to track.
              <span
                className={cn(
                  'text-[11.5px] font-medium',
                  weeklyDeltaPct > 0 ? 'text-bad' : 'text-good',
                )}
              >
                {weeklyDeltaPct > 0 ? '+' : ''}{weeklyDeltaPct.toFixed(1)}% wk
              </span>
            )}
          </div>
          <div className="font-mono text-[11px] leading-[1.4] text-text-muted">
            Linear regression ·{' '}
            <span className={dailyTrendUsd > 0.0001 ? 'text-bad' : dailyTrendUsd < -0.0001 ? 'text-good' : ''}>
              {dailyTrendUsd > 0.0001 ? '↑' : dailyTrendUsd < -0.0001 ? '↓' : '→'}{' '}
              ${Math.abs(dailyTrendUsd).toFixed(4)}/day
            </span>
          </div>
        </div>
      </div>

      {/* Chart — margin.left at 0 so the `$` prefix on Y-axis ticks isn't
          clipped by the chart's clipping box. Earlier `left: -16` shaved off
          the dollar sign and the values read as dimensionless. */}
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={formatted} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          {/* Hairline grid, ruled baseline. The only dashes in this plot are
              the `today` marker and the projected series, both of which mean
              "not a measurement". */}
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis
            dataKey="label"
            tick={TICK}
            tickLine={false}
            axisLine={{ stroke: C.rule }}
            interval={tickInterval}
          />
          <YAxis
            tick={TICK}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={(v: number) => `$${v.toFixed(2)}`}
          />
          <Tooltip
            contentStyle={{
              background: C.bgElev,
              border: `1px solid ${C.border}`,
              borderRadius: '10px',
              fontSize: 10,
              fontFamily: C.mono,
            }}
            cursor={{ stroke: C.rule, strokeWidth: 1 }}
            formatter={(value: unknown, name) => {
              const num = typeof value === 'number' ? value : 0
              const label = name === 'actual' ? 'Actual' : 'Projected'
              return [`$${num.toFixed(4)}`, label]
            }}
            labelFormatter={(label) => `${label}`}
          />
          {todayLabel && (
            <ReferenceLine
              x={todayLabel}
              stroke={C.faint}
              strokeDasharray="3 3"
              label={{ value: 'today', position: 'insideTopRight', fontSize: 10, fontFamily: C.mono, fill: C.faint }}
            />
          )}
          <Line
            type="monotone"
            dataKey="actual"
            stroke={C.text}
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3, fill: C.text, strokeWidth: 0 }}
            connectNulls={false}
            name="actual"
          />
          <Line
            type="monotone"
            dataKey="projected"
            stroke={C.faint}
            strokeWidth={1.5}
            strokeDasharray="5 3"
            dot={false}
            activeDot={{ r: 3, fill: C.faint, strokeWidth: 0 }}
            connectNulls={false}
            name="projected"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
