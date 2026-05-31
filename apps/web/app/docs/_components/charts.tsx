'use client'

/**
 * Recharts-based data visualizations for /docs pages.
 *
 * Each chart is a self-contained <figure> with a caption. Data is illustrative
 * (representative of what users will see in their own /dashboard), not pulled
 * from any live source — so these stay stable as the product evolves.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ErrorBar,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Area,
  ComposedChart,
} from 'recharts'

const COLORS = {
  accent: '#c2410c',
  accentLight: '#fb923c',
  muted: '#a89c8d',
  mutedLight: '#d6cfc4',
  bg: '#fbfaf7',
  text: '#1c1a17',
  textMuted: '#6b6056',
  good: '#15803d',
}

interface FigureProps {
  caption: string
  children: React.ReactNode
  height?: number
}

function Figure({ caption, children, height = 280 }: FigureProps) {
  return (
    <figure className="not-prose my-6">
      <div className="rounded-lg border border-border bg-bg-elev p-4" style={{ height }}>
        {children}
      </div>
      <figcaption className="mt-2 text-xs text-muted-foreground text-center">
        {caption}
      </figcaption>
    </figure>
  )
}

/* ───────────────────────── 1. Prompt A/B: p-value + CI ───────────────────────── */

export function PromptAbChart() {
  const data = [
    { version: 'v1 (control)', score: 0.71, ci: 0.04, samples: 1245 },
    { version: 'v2 (variant)', score: 0.83, ci: 0.03, samples: 1187 },
  ]
  return (
    <Figure caption="Two prompt versions on a 0..1 quality score with 95% confidence intervals. Welch's t-test result is shown above the winning bar — p < 0.05 means the difference is unlikely to be noise.">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 30, right: 30, left: 0, bottom: 30 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.mutedLight} />
          <XAxis dataKey="version" tick={{ fontSize: 12, fill: COLORS.textMuted }} />
          <YAxis domain={[0, 1]} tick={{ fontSize: 12, fill: COLORS.textMuted }} label={{ value: 'Eval score (0..1)', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: COLORS.textMuted } }} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 6, border: `1px solid ${COLORS.mutedLight}` }}
            formatter={(value, _name, item) => {
              const samples = (item.payload as { samples?: number }).samples
              return [String(value), `score (n=${samples ?? '?'})`]
            }}
          />
          <Bar dataKey="score" radius={[4, 4, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={i === 1 ? COLORS.accent : COLORS.muted} />
            ))}
            <ErrorBar dataKey="ci" width={8} strokeWidth={1.5} stroke={COLORS.text} />
          </Bar>
          <ReferenceLine y={0.83} stroke="none" label={{ value: 'p = 0.012  ✓ v2 wins', position: 'top', fill: COLORS.accent, fontSize: 12, fontWeight: 600 }} />
        </BarChart>
      </ResponsiveContainer>
    </Figure>
  )
}

/* ───────────────────────── 2. Anomalies: 3-sigma distribution ───────────────────────── */

export function AnomalyChart() {
  // Simulated normal distribution (mean=500ms, σ=80ms)
  const data = Array.from({ length: 41 }, (_, i) => {
    const x = 240 + i * 16 // 240..880ms range
    const mean = 500
    const sigma = 80
    const z = (x - mean) / sigma
    const density = Math.exp(-0.5 * z * z) // unnormalized
    return { latency: x, density: Math.round(density * 100) }
  })
  return (
    <Figure caption="Anomaly = a sample beyond ±3σ of the rolling baseline. Roughly 0.3% of normal samples land there by chance, so persistent breaches signal a real shift, not noise.">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 20, right: 30, left: 0, bottom: 30 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.mutedLight} />
          <XAxis dataKey="latency" tick={{ fontSize: 11, fill: COLORS.textMuted }} label={{ value: 'Latency (ms)', position: 'insideBottom', offset: -10, style: { fontSize: 11, fill: COLORS.textMuted } }} />
          <YAxis hide domain={[0, 110]} />
          <ReferenceArea x1={260} x2={740} y1={0} y2={110} fill={COLORS.muted} fillOpacity={0.08} label={{ value: '±3σ baseline', position: 'insideTopLeft', offset: 12, fill: COLORS.textMuted, fontSize: 11 }} />
          <Area type="monotone" dataKey="density" stroke={COLORS.muted} fill={COLORS.muted} fillOpacity={0.4} strokeWidth={2} />
          <ReferenceLine x={500} stroke={COLORS.text} strokeDasharray="3 3" label={{ value: 'μ', position: 'top', fill: COLORS.text, fontSize: 11, fontWeight: 600 }} />
          <ReferenceLine x={260} stroke={COLORS.muted} strokeDasharray="3 3" label={{ value: '-3σ', position: 'top', fill: COLORS.textMuted, fontSize: 10 }} />
          <ReferenceLine x={740} stroke={COLORS.muted} strokeDasharray="3 3" label={{ value: '+3σ', position: 'top', fill: COLORS.textMuted, fontSize: 10 }} />
          <ReferenceLine x={820} stroke={COLORS.accent} strokeWidth={2} label={{ value: '⚠ anomaly', position: 'top', fill: COLORS.accent, fontSize: 12, fontWeight: 600 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </Figure>
  )
}

/* ───────────────────────── 3. Cost tracking: model price comparison ───────────────────────── */

export function ModelPriceChart() {
  // Prices per 1M tokens, USD (illustrative — actual numbers live in seeds/model_prices.sql)
  const data = [
    { model: 'gpt-4o-mini', input: 0.15, output: 0.6 },
    { model: 'gpt-4o', input: 2.5, output: 10 },
    { model: 'claude-haiku-4-5', input: 0.25, output: 1.25 },
    { model: 'claude-sonnet-4-5', input: 3, output: 15 },
    { model: 'gemini-2.0-flash', input: 0.1, output: 0.4 },
  ]
  return (
    <Figure caption="Input vs output price per 1M tokens for popular models (May 2026 list rates). Output is typically 4–5× input — your prompt-to-completion ratio drives total spend more than model choice alone.">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 20, right: 30, left: 0, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.mutedLight} />
          <XAxis dataKey="model" tick={{ fontSize: 10, fill: COLORS.textMuted }} angle={-15} textAnchor="end" height={50} />
          <YAxis tick={{ fontSize: 11, fill: COLORS.textMuted }} label={{ value: 'USD / 1M tokens', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: COLORS.textMuted } }} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6, border: `1px solid ${COLORS.mutedLight}` }} />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
          <Bar dataKey="input" name="Input" fill={COLORS.muted} radius={[3, 3, 0, 0]} />
          <Bar dataKey="output" name="Output" fill={COLORS.accent} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Figure>
  )
}

/* ───────────────────────── 4. Billing: plan quotas ───────────────────────── */

export function PlanQuotaChart() {
  // Must mirror MONTHLY_REQUEST_LIMITS in apps/server/src/lib/quota.ts —
  // the server is authoritative, this chart just visualizes it. Enterprise
  // is actually unlimited; we render a finite headroom value (10× Team)
  // for a sensible bar height while keeping the caption honest about it.
  const data = [
    { plan: 'Free', requests: 50_000, retention: 14 },
    { plan: 'Pro', requests: 100_000, retention: 90 },
    { plan: 'Team', requests: 1_000_000, retention: 365 },
    { plan: 'Enterprise', requests: 10_000_000, retention: 365 },
  ]
  return (
    <Figure caption="Monthly request quota (left) and retention window (right) per plan. The Enterprise bar is shown at an illustrative 10M to keep the chart readable; the actual Enterprise quota is unlimited and negotiated per contract. Paid quotas overflow into metered overage at the rate shown in the billing table.">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 20, right: 60, left: 20, bottom: 30 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.mutedLight} />
          <XAxis dataKey="plan" tick={{ fontSize: 12, fill: COLORS.textMuted }} />
          <YAxis yAxisId="left" tick={{ fontSize: 11, fill: COLORS.textMuted }} tickFormatter={(v: number) => v >= 1_000_000 ? `${v / 1_000_000}M` : v >= 1000 ? `${v / 1000}k` : String(v)} label={{ value: 'Requests / mo', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: COLORS.textMuted } }} />
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: COLORS.textMuted }} label={{ value: 'Retention (days)', angle: 90, position: 'insideRight', style: { fontSize: 11, fill: COLORS.textMuted } }} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 6, border: `1px solid ${COLORS.mutedLight}` }}
            formatter={(value, name) => {
              const num = typeof value === 'number' ? value : Number(value)
              return name === 'requests'
                ? [num.toLocaleString(), 'Requests/mo']
                : [`${num} days`, 'Retention']
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
          <Bar yAxisId="left" dataKey="requests" name="Requests / mo" fill={COLORS.accent} radius={[3, 3, 0, 0]} />
          <Bar yAxisId="right" dataKey="retention" name="Retention days" fill={COLORS.muted} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Figure>
  )
}

/* ───────────────────────── 5. Why: feature coverage radar ───────────────────────── */

export function FeatureCoverageRadar() {
  // 6 axes × 4 tools, 0..100 coverage score
  const data = [
    { axis: 'Proxy install', Spanlens: 100, Helicone: 60, Langfuse: 30, LangSmith: 20 },
    { axis: 'Cache billing', Spanlens: 100, Helicone: 50, Langfuse: 50, LangSmith: 40 },
    { axis: 'Critical Path', Spanlens: 100, Helicone: 0, Langfuse: 0, LangSmith: 0 },
    { axis: 'Prompt A/B', Spanlens: 100, Helicone: 0, Langfuse: 40, LangSmith: 40 },
    { axis: 'Model-swap $', Spanlens: 100, Helicone: 0, Langfuse: 0, LangSmith: 0 },
    { axis: 'OTel ingest', Spanlens: 90, Helicone: 0, Langfuse: 90, LangSmith: 90 },
  ]
  const series: { name: string; color: string; key: 'Spanlens' | 'Helicone' | 'Langfuse' | 'LangSmith' }[] = [
    { name: 'Spanlens', key: 'Spanlens', color: COLORS.accent },
    { name: 'Helicone', key: 'Helicone', color: COLORS.muted },
    { name: 'Langfuse', key: 'Langfuse', color: '#0891b2' },
    { name: 'LangSmith', key: 'LangSmith', color: '#7c3aed' },
  ]
  return (
    <figure className="not-prose my-6">
      <div className="rounded-lg border border-border bg-bg-elev p-4">
        <div style={{ height: 360 }}>
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={data} outerRadius="72%" margin={{ top: 10, right: 70, bottom: 10, left: 70 }}>
              <PolarGrid stroke={COLORS.mutedLight} />
              <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: COLORS.textMuted }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 9, fill: COLORS.textMuted }} />
              {series.map((s) => (
                <Radar key={s.key} name={s.name} dataKey={s.key} stroke={s.color} fill={s.color} fillOpacity={s.key === 'Spanlens' ? 0.35 : 0.15} />
              ))}
            </RadarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[11px]">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: s.color, opacity: 0.7 }} />
              <span style={{ color: s.color }} className="font-medium">{s.name}</span>
            </span>
          ))}
        </div>
      </div>
      <figcaption className="mt-2 text-xs text-muted-foreground text-center">
        Coverage score across six differentiator axes. The bigger the polygon, the broader the out-of-box capability — read alongside the detailed checkmark table below.
      </figcaption>
    </figure>
  )
}

// suppress unused warnings (Line/Cell imported in case future variants need them)
void Line
void LineChart
