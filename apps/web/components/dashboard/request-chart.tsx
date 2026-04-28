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
}

// CSS vars are plain hex — do NOT wrap in hsl()
const C = {
  text:      'var(--text)',
  accent:    'var(--accent)',
  border:    'var(--border)',
  faint:     'var(--text-faint)',
  bg:        'var(--bg)',
  bgElev:    'var(--bg-elev)',
} as const

export function RequestChart({ data, firedAt = [] }: RequestChartProps) {
  if (data.length === 0) {
    return (
      <div className="h-[220px] flex items-center justify-center font-mono text-[12px] text-text-faint">
        No data for this time range.
      </div>
    )
  }

  const formatted = data.map((d) => ({
    ...d,
    label: d.date.length >= 10 ? d.date.slice(5) : d.date,
  }))

  const firedDateSet = new Set(firedAt.map((iso) => iso.slice(0, 10)))
  const alertPoints = formatted.filter((d) => firedDateSet.has(d.date.slice(0, 10)))
  const hasAlerts = alertPoints.length > 0

  const tickInterval = formatted.length > 14 ? Math.floor(formatted.length / 7) : 0

  return (
    <div>
      {/* Legend */}
      <div className="flex justify-end items-center gap-5 mb-3">
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
          <svg width="18" height="8" aria-hidden>
            <line x1="0" y1="4" x2="18" y2="4" stroke={C.text} strokeWidth="1.5" />
          </svg>
          Requests
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
          <svg width="18" height="8" aria-hidden>
            <line x1="0" y1="4" x2="18" y2="4" stroke={C.accent} strokeWidth="1.5" strokeDasharray="4 3" />
          </svg>
          Spend
        </span>
        {hasAlerts && (
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
            <span className="inline-block w-2 h-2 rounded-full bg-accent" />
            Alert fired
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={220}>
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
            yAxisId="req"
            tick={{ fontSize: 10, fontFamily: 'monospace', fill: C.faint }}
            tickLine={false}
            axisLine={false}
            width={38}
            tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
          />
          <YAxis
            yAxisId="cost"
            orientation="right"
            tick={{ fontSize: 10, fontFamily: 'monospace', fill: C.faint }}
            tickLine={false}
            axisLine={false}
            width={38}
            tickFormatter={(v: number) => `$${v.toFixed(0)}`}
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
              if (name === 'cost') return [`$${num.toFixed(2)}`, 'Spend']
              return [num.toLocaleString(), 'Requests']
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
