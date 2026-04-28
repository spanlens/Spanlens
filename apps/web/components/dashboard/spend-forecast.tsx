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
  faint:  'var(--text-faint)',
  bg:     'var(--bg)',
  bgElev: 'var(--bg-elev)',
} as const

function fmtCost(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

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
    <div className="px-[22px] py-5 border-b border-border">
      {/* Header */}
      <div className="flex items-center mb-4">
        <span className="text-[15px] font-medium">This month · spend forecast</span>
        <div className="ml-auto flex items-center gap-5">
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
            <svg width="18" height="8" aria-hidden>
              <line x1="0" y1="4" x2="18" y2="4" stroke={C.text} strokeWidth="1.5" />
            </svg>
            Actual
          </span>
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
            <svg width="18" height="8" aria-hidden>
              <line x1="0" y1="4" x2="18" y2="4" stroke={C.faint} strokeWidth="1.5" strokeDasharray="4 3" />
            </svg>
            Projected
          </span>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 border border-border rounded-md mb-4 overflow-hidden">
        <div className="p-4 border-r border-border">
          <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">
            Month to date
          </div>
          <div className="text-[28px] font-medium tracking-[-0.6px] text-text leading-none mb-1.5">
            {fmtCost(monthToDate)}
          </div>
          <div className="font-mono text-[11px] text-text-muted">
            Day {dayOfMonth} of {daysInMonth} · {fmtCost(dailyAvgUsd)} / day avg
          </div>
        </div>

        <div className="p-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">
            Projected · month end
          </div>
          <div className="flex items-baseline gap-2.5 mb-1.5">
            <span className="text-[28px] font-medium tracking-[-0.6px] text-text leading-none">
              ~{fmtCost(projectedMonthEndUsd)}
            </span>
            {weeklyDeltaPct != null && (
              <span
                className={cn(
                  'font-mono text-[11.5px]',
                  weeklyDeltaPct > 0 ? 'text-accent' : 'text-good',
                )}
              >
                {weeklyDeltaPct > 0 ? '+' : ''}{weeklyDeltaPct.toFixed(1)}% wk
              </span>
            )}
          </div>
          <div className="font-mono text-[11px] text-text-muted">
            Linear regression ·{' '}
            <span className={dailyTrendUsd > 0.0001 ? 'text-accent' : dailyTrendUsd < -0.0001 ? 'text-good' : ''}>
              {dailyTrendUsd > 0.0001 ? '↑' : dailyTrendUsd < -0.0001 ? '↓' : '→'}{' '}
              ${Math.abs(dailyTrendUsd).toFixed(4)}/day
            </span>
          </div>
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={formatted} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fontFamily: 'monospace', fill: C.faint }}
            tickLine={false}
            axisLine={false}
            interval={tickInterval}
          />
          <YAxis
            tick={{ fontSize: 10, fontFamily: 'monospace', fill: C.faint }}
            tickLine={false}
            axisLine={false}
            width={46}
            tickFormatter={(v: number) => `$${v.toFixed(2)}`}
          />
          <Tooltip
            contentStyle={{
              background: C.bgElev,
              border: `1px solid ${C.border}`,
              borderRadius: '6px',
              fontSize: 11,
              fontFamily: 'monospace',
            }}
            formatter={(value: unknown, name: string) => {
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
              label={{ value: 'today', position: 'insideTopRight', fontSize: 10, fontFamily: 'monospace', fill: C.faint }}
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
