'use client'

import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceDot,
} from 'recharts'

interface TimeseriesPoint {
  date: string
  requests: number
  cost: number
  tokens: number
  errors: number
}

interface RequestChartProps {
  data: TimeseriesPoint[]
  /** ISO timestamps when alerts fired — rendered as dots on the requests line. */
  firedAt?: string[]
  /** True when data buckets are hourly; false for daily (7d/30d). */
  isHourly?: boolean
}

// CSS vars are plain hex — do NOT wrap in hsl()
const C = {
  text:      'var(--text)',
  accent:    'var(--accent)',
  border:    'var(--border)',
  rule:      'var(--border-strong)',
  grid:      'var(--grid)',
  faint:     'var(--text-faint)',
  bg:        'var(--bg)',
  bgElev:    'var(--bg-elev)',
  mono:      'var(--font-geist-mono), ui-monospace, monospace',
} as const

// Shared axis tick style. 10px mono in the faint ink is the dashboard's
// smallest legible step; anything below it stops being readable on a laptop
// panel at arm's length.
const TICK = { fontSize: 10, fontFamily: C.mono, fill: C.faint } as const

// Tooltip chrome, matched to the card radius ladder (10 = `rounded-md`).
const TOOLTIP_STYLE = {
  background: C.bgElev,
  border: `1px solid ${C.border}`,
  borderRadius: '10px',
  fontSize: 10,
  fontFamily: C.mono,
} as const

export function RequestChart({ data, firedAt = [], isHourly = true }: RequestChartProps) {
  if (data.length === 0) {
    return (
      <div className="h-[220px] flex items-center justify-center font-mono text-[12px] text-text-faint">
        No data for this time range.
      </div>
    )
  }

  const formatted = data.map((d) => ({
    ...d,
    label: isHourly ? d.date.slice(11, 16) : d.date.slice(5, 10),
  }))

  const firedDateSet = new Set(firedAt.map((iso) => iso.slice(0, 10)))
  const alertPoints = formatted.filter((d) => firedDateSet.has(d.date.slice(0, 10)))
  const hasAlerts = alertPoints.length > 0

  const tickInterval = isHourly
    ? Math.max(1, Math.floor(formatted.length / 6))
    : formatted.length > 14 ? Math.floor(formatted.length / 7) : 0

  return (
    <div>
      {/* Legend. 11px mono in faint ink, set flat rather than tracked-out caps
          so it reads as a key and not as a section heading. */}
      <div className="flex justify-end items-center gap-5 mb-[14px]">
        <span className="flex items-center gap-1.5 font-mono text-[11px] leading-[1.4] text-text-faint">
          <svg width="18" height="8" aria-hidden>
            <line x1="0" y1="4" x2="18" y2="4" stroke={C.text} strokeWidth="1.5" />
          </svg>
          Requests
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[11px] leading-[1.4] text-text-faint">
          <svg width="18" height="8" aria-hidden>
            <line x1="0" y1="4" x2="18" y2="4" stroke={C.accent} strokeWidth="1.5" strokeDasharray="4 3" />
          </svg>
          Spend
        </span>
        {hasAlerts && (
          <span className="flex items-center gap-1.5 font-mono text-[11px] leading-[1.4] text-text-faint">
            <span className="inline-block w-2 h-2 rounded-full bg-accent" />
            Alert fired
          </span>
        )}
      </div>

      {/* margin.left at 0 keeps both Y-axis tick labels (left: requests,
          right: $cost) inside the chart bounds. */}
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={formatted} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          {/* Solid hairlines. Dashes are reserved for reference lines so the
              two never compete for the same meaning. */}
          <CartesianGrid stroke={C.grid} vertical={false} />

          {/* The x axis line is the chart's baseline, so it is drawn a step
              darker than the gridlines it sits under. */}
          <XAxis
            dataKey="label"
            tick={TICK}
            tickLine={false}
            axisLine={{ stroke: C.rule }}
            interval={tickInterval}
          />
          <YAxis
            yAxisId="req"
            tick={TICK}
            tickLine={false}
            axisLine={false}
            width={38}
            tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
          />
          <YAxis
            yAxisId="cost"
            orientation="right"
            tick={TICK}
            tickLine={false}
            axisLine={false}
            width={38}
            tickFormatter={(v: number) => `$${v.toFixed(0)}`}
          />

          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            cursor={{ stroke: C.rule, strokeWidth: 1 }}
            labelFormatter={(label) => {
              if (typeof label !== 'string' || !isHourly) return String(label ?? '')
              const pt = formatted.find((d) => d.label === label)
              if (!pt) return label
              return new Date(pt.date).toLocaleString([], {
                month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit', hour12: false,
              })
            }}
            formatter={(value: unknown, name) => {
              const num = typeof value === 'number' ? value : 0
              if (name === 'cost') return [`$${num.toFixed(2)}`, 'Spend']
              if (name === 'requests') return [num.toLocaleString(), 'Requests']
              return [String(num), String(name ?? '')]
            }}
          />

          <Line
            yAxisId="req"
            type="monotone"
            dataKey="requests"
            stroke={C.text}
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3, fill: C.text, strokeWidth: 0 }}
            name="requests"
          />
          <Line
            yAxisId="cost"
            type="monotone"
            dataKey="cost"
            stroke={C.accent}
            strokeWidth={1.5}
            strokeDasharray="5 3"
            dot={false}
            activeDot={{ r: 3, fill: C.accent, strokeWidth: 0 }}
            name="cost"
          />

          {alertPoints.map((pt, i) => (
            <ReferenceDot
              key={`alert-${i}`}
              yAxisId="req"
              x={pt.label}
              y={pt.requests}
              r={5}
              fill={C.accent}
              stroke={C.bg}
              strokeWidth={2}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
