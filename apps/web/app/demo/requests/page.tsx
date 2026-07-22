'use client'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Bookmark, Plus, Check } from 'lucide-react'
import { useHydrationSafeNow } from '@/lib/hydration-safe-now'
import { cn, formatDateTime } from '@/lib/utils'
import { Topbar } from '@/components/layout/topbar'
import { DemoExportButton } from '@/components/ui/demo-export-button'
import {
  DEMO_REQUESTS,
  DEMO_REQUEST_DETAILS,
  DEMO_SECURITY_SUMMARY,
  DEMO_TIMESERIES,
  DEMO_TRACE_DETAILS,
} from '@/lib/demo-data'
import type { RequestRow, RequestDetail } from '@/lib/queries/types'
import { maskPii, maskPiiDeep } from '@/lib/pii-mask'

// ── Types ─────────────────────────────────────────────────────────────────────

type StatusFilter = 'all' | 'ok' | '4xx' | '5xx'
type SortField = 'created_at' | 'latency_ms' | 'cost_usd' | 'total_tokens'
type SortDir = 'asc' | 'desc'
type TimeRange = 'all' | 'today' | '7d' | '30d'
type DrawerTab = 'request' | 'response' | 'trace' | 'raw' | 'error'

const STATUS_LABELS: Record<StatusFilter, string> = { all: 'All', ok: 'OK', '4xx': '4xx', '5xx': '5xx' }

// Distinct provider-key names present in the static dataset. Powers the
// provider-key filter dropdown so the demo mirrors the real requests page,
// which filters rows by the key that served them.
const PROVIDER_KEY_OPTIONS: string[] = Array.from(
  new Set(DEMO_REQUESTS.map((r) => r.provider_key_name).filter((n): n is string => !!n)),
)

// ── Helpers ───────────────────────────────────────────────────────────────────

function relAge(dateStr: string): string {
  const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function fmtCost(n: number | null): string {
  if (n == null) return '—'
  return n < 0.001 ? '$' + n.toFixed(5) : '$' + n.toFixed(4)
}

function sparkPath(values: number[], w: number, h: number): string {
  if (values.length < 2) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(1, max - min)
  const pad = 2
  const step = (w - pad * 2) / (values.length - 1)
  return values
    .map((v, i) => {
      const x = pad + i * step
      const y = h - pad - ((v - min) / span) * (h - pad * 2)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

// ── InlineSpark ───────────────────────────────────────────────────────────────

function InlineSpark({
  values,
  w = 120,
  h = 18,
  stroke = 'var(--border-strong)',
}: {
  values: number[]
  w?: number
  h?: number
  stroke?: string
}) {
  const path = sparkPath(values, w, h)
  if (!path) return null
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block w-full">
      <path
        d={path}
        stroke={stroke}
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ── StatStrip (demo: uses DEMO_TIMESERIES + DEMO_REQUESTS) ───────────────────

function StatStrip() {
  const ts = DEMO_TIMESERIES
  const reqs = DEMO_REQUESTS
  const sparkReqs = ts.slice(-10).map((d) => d.requests)
  const sparkCost = ts.slice(-10).map((d) => d.cost)
  const sparkErrors = ts.slice(-10).map((d) => d.errors)

  const totalReqs = reqs.length
  const errReqs = reqs.filter((r) => r.status_code >= 400).length
  const errorRate = totalReqs > 0 ? (errReqs / totalReqs) * 100 : 0
  const avgLatency = Math.round(
    reqs.reduce((s, r) => s + r.latency_ms, 0) / Math.max(1, reqs.length),
  )
  const totalCost = reqs.reduce((s, r) => s + (r.cost_usd ?? 0), 0)

  const summaryData = DEMO_SECURITY_SUMMARY
  const anomalyCount = summaryData.length

  const stats = [
    {
      label: 'Requests · 24h',
      value: totalReqs.toLocaleString('en-US'),
      spark: sparkReqs,
      warn: false,
      good: false,
    },
    {
      label: 'Avg latency',
      value: `${avgLatency}ms`,
      spark: [] as number[],
      warn: avgLatency > 1000,
      good: false,
    },
    {
      label: 'Spend · 24h',
      value: '$' + totalCost.toFixed(2),
      spark: sparkCost,
      warn: false,
      good: true,
    },
    {
      label: 'Error rate',
      value: errorRate.toFixed(1) + '%',
      spark: sparkErrors,
      warn: errorRate > 1,
      good: false,
    },
    {
      label: 'Anomalies',
      value: String(anomalyCount),
      spark: [] as number[],
      warn: anomalyCount > 0,
      good: false,
    },
  ]

  return (
    <div className="overflow-x-auto shrink-0 border-b border-border">
      <div className="grid grid-cols-5 min-w-[480px]">
        {stats.map((s, i) => (
          <div
            key={i}
            className={cn('px-[18px] py-[14px]', i < 4 && 'border-r border-border')}
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">
              {s.label}
            </div>
            <div
              className={cn(
                'text-[24px] font-medium tracking-[-0.6px] leading-none mb-1.5',
                s.warn ? 'text-accent' : 'text-text',
              )}
            >
              {s.value}
            </div>
            <InlineSpark
              values={s.spark}
              stroke={
                s.warn ? 'var(--accent)' : s.good ? 'var(--good)' : 'var(--border-strong)'
              }
            />
          </div>
        ))}
      </div>
    </div>
  )
}

// ── TrafficBars (demo: static stacked OK/4xx/5xx + p50/p95 overlay) ──────────
// Static traffic aggregation. Ported from the real requests client's
// TrafficBars but driven by a local, deterministic const instead of the
// live /stats timeseries queries. Numbers use Math.sin(index) noise so SSR
// and CSR module-load evaluations produce identical values (gotcha #22 E).

interface TrafficBucket {
  requests: number
  ok: number
  e4xx: number
  e5xx: number
  p50: number
  p95: number
  topStatus: { value: string; count: number }[]
  topModels: { value: string; count: number }[]
}

const TRAFFIC_MODELS = [
  'gpt-4o-mini',
  'gpt-4o',
  'claude-sonnet-4-5',
  'claude-haiku-4-5',
  'gemini-2.0-flash',
]

const BUCKET_COUNT = 30
const CHART_H = 96 // px — total bar/line plot area

function buildTrafficBuckets(): TrafficBucket[] {
  const out: TrafficBucket[] = []
  for (let i = 0; i < BUCKET_COUNT; i++) {
    const base = Math.round(140 + Math.sin(i * 0.5) * 42 + Math.sin(i * 1.7) * 16)
    const e4xx = Math.max(0, Math.round(Math.sin(i * 0.9) * 4 + 4))
    const e5xx = Math.max(
      0,
      i % 7 === 0 ? Math.round(Math.sin(i) * 2 + 3) : Math.round(Math.sin(i * 2.1) * 1.5),
    )
    const ok = Math.max(0, base - e4xx - e5xx)
    const p50 = Math.round(420 + Math.sin(i * 0.6) * 120 + 140)
    const p95 = Math.round(p50 * 2.3 + Math.abs(Math.sin(i * 1.3)) * 320 + 400)
    const m0 = Math.round(ok * 0.42)
    const m1 = Math.round(ok * 0.27)
    const m2 = Math.round(ok * 0.16)
    out.push({
      requests: base,
      ok,
      e4xx,
      e5xx,
      p50,
      p95,
      topStatus: [
        { value: '200', count: ok },
        ...(e4xx > 0 ? [{ value: '429', count: e4xx }] : []),
        ...(e5xx > 0 ? [{ value: '500', count: e5xx }] : []),
      ],
      topModels: [
        { value: TRAFFIC_MODELS[i % TRAFFIC_MODELS.length]!, count: m0 },
        { value: TRAFFIC_MODELS[(i + 1) % TRAFFIC_MODELS.length]!, count: m1 },
        { value: TRAFFIC_MODELS[(i + 2) % TRAFFIC_MODELS.length]!, count: m2 },
      ],
    })
  }
  return out
}

const TRAFFIC_BUCKETS = buildTrafficBuckets()
const DAY_MS = 86_400_000

function TrafficBars() {
  // Toggle whether the latency overlay lines are rendered.
  const [showLatency, setShowLatency] = useState(true)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  // Hydration-safe "now" for the date axis: returns 0 during SSR and the
  // first client paint (so the placeholder labels match), then a cached
  // real timestamp after hydration.
  const now = useHydrationSafeNow()

  const { bars, maxLatency } = useMemo(() => {
    const localMaxReq = Math.max(...TRAFFIC_BUCKETS.map((d) => d.requests), 1)
    const localMaxLat = Math.max(...TRAFFIC_BUCKETS.map((d) => d.p95), 1)
    const scaleH = (n: number) => (n / localMaxReq) * (CHART_H - 8)
    const computed = TRAFFIC_BUCKETS.map((d) => ({
      ...d,
      hOk: Math.max(d.requests > 0 ? 2 : 0, scaleH(d.ok)),
      hE4xx: scaleH(d.e4xx),
      hE5xx: scaleH(d.e5xx),
    }))
    return { bars: computed, maxLatency: localMaxLat }
  }, [])

  const dateFor = useCallback(
    (idx: number) => (now ? now - (BUCKET_COUNT - 1 - idx) * DAY_MS : null),
    [now],
  )

  const labels = useMemo(() => {
    if (!now) return ['—', '—', '—', '—', 'NOW']
    const fmt = (ms: number) =>
      new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    return [
      fmt(dateFor(0)!),
      fmt(dateFor(Math.floor(BUCKET_COUNT * 0.25))!),
      fmt(dateFor(Math.floor(BUCKET_COUNT * 0.5))!),
      fmt(dateFor(Math.floor(BUCKET_COUNT * 0.75))!),
      'NOW',
    ]
  }, [now, dateFor])

  // SVG polyline points for the latency overlay (percent-space X, px Y).
  const latencyPoints = useMemo(() => {
    const w = 100
    const stepX = w / Math.max(1, bars.length - 1)
    const yFor = (v: number) => (maxLatency === 0 ? null : CHART_H - 4 - (v / maxLatency) * (CHART_H - 12))
    const buildLine = (vals: number[]): string =>
      vals
        .map((v, i) => {
          const y = yFor(v)
          if (y == null) return null
          return `${(i * stepX).toFixed(2)},${y.toFixed(2)}`
        })
        .filter((p): p is string => p !== null)
        .join(' ')
    return {
      p50: buildLine(bars.map((b) => b.p50)),
      p95: buildLine(bars.map((b) => b.p95)),
    }
  }, [bars, maxLatency])

  const hoverBar = hoverIdx != null ? bars[hoverIdx] : null
  const hoverMs = hoverIdx != null ? dateFor(hoverIdx) : null

  return (
    <div className="px-[22px] py-[14px] border-b border-border shrink-0">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-[13.5px] font-medium">Traffic</h2>
          <div className="flex gap-3 font-mono text-[10.5px] text-text-muted tracking-[0.03em]">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-[1px] bg-border-strong inline-block" /> OK
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-[1px] bg-warn inline-block" /> 4xx
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-[1px] bg-bad inline-block" /> 5xx
            </span>
            <button
              type="button"
              onClick={() => setShowLatency((v) => !v)}
              className={cn(
                'inline-flex items-center gap-1.5 hover:text-text transition-colors',
                showLatency ? 'text-text-muted' : 'text-text-faint',
              )}
              title="Toggle latency overlay"
            >
              <span className="inline-block w-3 border-t-2 border-dotted border-text-muted" /> p50
              <span className="inline-block w-3 border-t-2 border-text-muted ml-1" /> p95
            </button>
          </div>
        </div>
        <div className="font-mono text-[10.5px] text-text-faint tracking-[0.03em]">last 30d</div>
      </div>

      <div className="relative" style={{ height: CHART_H }} onMouseLeave={() => setHoverIdx(null)}>
        {/* Bars (stacked OK / 4xx / 5xx, bottom-up) */}
        <div className="absolute inset-0 flex items-end gap-[2px]">
          {bars.map((b, i) => {
            const isHover = hoverIdx === i
            return (
              <div
                key={i}
                className="flex-1 flex flex-col-reverse min-w-0 cursor-default"
                onMouseEnter={() => setHoverIdx(i)}
              >
                {b.hOk > 0 && (
                  <div
                    className={cn(b.hE4xx === 0 && b.hE5xx === 0 ? 'rounded-t-[1px]' : 'rounded-none')}
                    style={{ height: b.hOk, background: isHover ? 'var(--text-muted)' : 'var(--border-strong)' }}
                  />
                )}
                {b.hE4xx > 0 && <div style={{ height: b.hE4xx, background: 'var(--warn)' }} />}
                {b.hE5xx > 0 && (
                  <div className="rounded-t-[1px]" style={{ height: b.hE5xx, background: 'var(--bad)' }} />
                )}
              </div>
            )
          })}
        </div>

        {/* Latency overlay (p50 dotted, p95 solid) */}
        {showLatency && bars.length > 1 && (
          <svg
            className="absolute inset-0 pointer-events-none"
            viewBox={`0 0 100 ${CHART_H}`}
            preserveAspectRatio="none"
            style={{ width: '100%', height: '100%' }}
          >
            {latencyPoints.p95 && (
              <polyline
                points={latencyPoints.p95}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {latencyPoints.p50 && (
              <polyline
                points={latencyPoints.p50}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={1.25}
                strokeDasharray="3 2"
                strokeOpacity={0.6}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
        )}

        {/* Hover tracker line */}
        {hoverIdx != null && bars.length > 0 && (
          <div
            className="absolute top-0 bottom-0 w-px bg-text-faint pointer-events-none"
            style={{ left: `${((hoverIdx + 0.5) / bars.length) * 100}%` }}
          />
        )}
      </div>

      <div className="flex justify-between font-mono text-[10px] text-text-faint tracking-[0.04em] mt-2">
        {labels.map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>

      {/* Tooltip */}
      {hoverIdx != null && hoverBar && (
        <div className="mt-3 rounded-[5px] border border-border bg-bg-elev px-3 py-2 font-mono text-[11px]">
          <div className="flex items-baseline justify-between gap-3 mb-1.5">
            <span className="text-text">
              {hoverMs
                ? new Date(hoverMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                : '—'}
            </span>
            <span className="text-text-faint text-[10.5px]">
              {hoverBar.requests.toLocaleString('en-US')} req
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[10.5px] text-text-muted">
            <div className="flex justify-between">
              <span>4xx</span>
              <span className={hoverBar.e4xx > 0 ? 'text-warn' : 'text-text-faint'}>
                {hoverBar.e4xx.toLocaleString('en-US')}
              </span>
            </div>
            <div className="flex justify-between">
              <span>p50</span>
              <span className="text-text">{Math.round(hoverBar.p50)}ms</span>
            </div>
            <div className="flex justify-between">
              <span>5xx</span>
              <span className={hoverBar.e5xx > 0 ? 'text-bad' : 'text-text-faint'}>
                {hoverBar.e5xx.toLocaleString('en-US')}
              </span>
            </div>
            <div className="flex justify-between">
              <span>p95</span>
              <span className="text-text">{Math.round(hoverBar.p95)}ms</span>
            </div>
          </div>
          {(hoverBar.topStatus.length > 0 || hoverBar.topModels.length > 0) && (
            <div className="mt-2 pt-2 border-t border-border grid grid-cols-2 gap-x-6 gap-y-0.5 text-[10.5px]">
              <div>
                <div className="text-text-faint uppercase tracking-[0.05em] text-[9.5px] mb-1">
                  Top status
                </div>
                {hoverBar.topStatus.slice(0, 3).map((s) => (
                  <div key={s.value} className="flex justify-between text-text-muted">
                    <span
                      className={cn(
                        Number(s.value) >= 500
                          ? 'text-bad'
                          : Number(s.value) >= 400
                            ? 'text-warn'
                            : 'text-text-muted',
                      )}
                    >
                      {s.value}
                    </span>
                    <span>{s.count.toLocaleString('en-US')}</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="text-text-faint uppercase tracking-[0.05em] text-[9.5px] mb-1">
                  Top models
                </div>
                {hoverBar.topModels.slice(0, 3).map((m) => (
                  <div key={m.value} className="flex justify-between text-text-muted gap-2">
                    <span className="truncate">{m.value}</span>
                    <span className="shrink-0">{m.count.toLocaleString('en-US')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Saved views (demo: static presets that set local filters) ────────────────

interface DemoView {
  id: string
  name: string
  status: StatusFilter
  provider: string
  providerKey: string
  timeRange: TimeRange
  sortField: SortField
  sortDir: SortDir
}

const DEFAULT_VIEW: Omit<DemoView, 'id' | 'name'> = {
  status: 'all',
  provider: 'all',
  providerKey: 'all',
  timeRange: 'all',
  sortField: 'created_at',
  sortDir: 'desc',
}

const PRESET_VIEWS: DemoView[] = [
  { id: 'openai', name: 'OpenAI traffic', ...DEFAULT_VIEW, provider: 'openai' },
  { id: 'errors', name: 'Errors (4xx)', ...DEFAULT_VIEW, status: '4xx' },
  { id: 'slow', name: 'Slowest first', ...DEFAULT_VIEW, sortField: 'latency_ms', sortDir: 'desc' },
  { id: 'anthropic-key', name: 'Production Anthropic', ...DEFAULT_VIEW, providerKey: 'Production Anthropic' },
]

interface SavedViewsBarProps {
  active: Omit<DemoView, 'id' | 'name'>
  onApply: (view: DemoView) => void
}

function SavedViewsBar({ active, onApply }: SavedViewsBarProps) {
  const [showNotice, setShowNotice] = useState(false)

  const matches = (v: DemoView) =>
    v.status === active.status &&
    v.provider === active.provider &&
    v.providerKey === active.providerKey &&
    v.timeRange === active.timeRange &&
    v.sortField === active.sortField &&
    v.sortDir === active.sortDir

  return (
    <div className="flex items-center gap-1.5 px-[22px] py-[7px] border-b border-border shrink-0 flex-wrap">
      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint inline-flex items-center gap-1 shrink-0">
        <Bookmark className="w-3 h-3" /> Views
      </span>

      {PRESET_VIEWS.map((v) => {
        const isActive = matches(v)
        return (
          <button
            key={v.id}
            type="button"
            onClick={() => onApply(v)}
            title={`Apply "${v.name}"`}
            className={cn(
              'inline-flex items-center gap-1 rounded-[5px] border font-mono text-[10.5px] px-[9px] py-[5px] transition-colors',
              isActive
                ? 'border-accent-border bg-accent-bg text-accent'
                : 'border-border bg-bg-elev text-text-muted hover:border-border-strong',
            )}
          >
            {v.name}
          </button>
        )
      })}

      <button
        type="button"
        onClick={() => setShowNotice((v) => !v)}
        className="font-mono text-[10.5px] px-[9px] py-[5px] border border-dashed border-border rounded-[5px] text-text-faint hover:text-text hover:border-border-strong transition-colors inline-flex items-center gap-1 shrink-0"
      >
        <Plus className="w-3 h-3" /> Save view
      </button>

      {showNotice && (
        <span className="inline-flex items-center gap-2 font-mono text-[10.5px] text-text-muted">
          <Check className="w-3 h-3 text-accent" />
          Saving custom views is available on your own workspace.
          <Link href="/signup" className="text-accent hover:opacity-80 transition-opacity">
            Sign up free →
          </Link>
        </span>
      )}
    </div>
  )
}

// ── Request drawer (inline, static) ──────────────────────────────────────────

function CopyButton({ getText }: { getText: () => string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(getText())
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className="font-mono text-[10px] px-1.5 py-0.5 border border-border rounded text-text-faint hover:text-text hover:border-border-strong transition-colors shrink-0"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

// Anthropic sends content as [{type:'text',text:'...'}], OpenAI as a plain string.
function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'object' && block !== null) {
          const b = block as Record<string, unknown>
          if (typeof b.text === 'string') return b.text
          if (b.type === 'image') return '[image]'
          if (b.type === 'tool_use') return `[tool_use: ${String(b.name ?? '')}]`
          if (b.type === 'tool_result') return '[tool_result]'
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return JSON.stringify(content)
}

function MessageDisplay({
  messages,
  body,
}: {
  messages: { role: string; content: unknown }[] | null
  body: unknown
}) {
  const systemText = useMemo(() => {
    if (!body || typeof body !== 'object') return null
    const b = body as Record<string, unknown>
    if (typeof b.system === 'string' && b.system.trim()) return b.system
    if (Array.isArray(b.system)) {
      const text = (b.system as unknown[])
        .map((s) => {
          if (typeof s === 'object' && s !== null && typeof (s as Record<string, unknown>).text === 'string')
            return (s as Record<string, unknown>).text as string
          return ''
        })
        .filter(Boolean)
        .join('\n')
      return text || null
    }
    return null
  }, [body])

  if (messages) {
    return (
      <div className="space-y-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">Messages</div>
        {systemText && (
          <div>
            <div className="font-mono text-[10px] text-text-faint tracking-[0.04em] mb-1">system</div>
            <div className="px-3 py-2.5 rounded-[5px] border font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap bg-bg-muted border-border text-text-faint">
              {systemText}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i}>
            <div className="font-mono text-[10px] text-text-faint tracking-[0.04em] mb-1">{m.role}</div>
            <div
              className={cn(
                'px-3 py-2.5 rounded-[5px] border font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap',
                m.role === 'assistant'
                  ? 'bg-bg-elev border-border-strong text-text'
                  : 'bg-bg-muted border-border text-text-muted',
              )}
            >
              {extractMessageText(m.content)}
            </div>
          </div>
        ))}
      </div>
    )
  }
  return (
    <pre className="font-mono text-[11.5px] text-text-muted leading-relaxed whitespace-pre-wrap break-all">
      {JSON.stringify(body, null, 2)}
    </pre>
  )
}

function TraceTab({ traceId }: { traceId: string | null }) {
  const trace = traceId ? DEMO_TRACE_DETAILS[traceId] ?? null : null

  if (!traceId) {
    return (
      <p className="font-mono text-[11.5px] text-text-faint">
        This request is not attached to a trace. Add <code className="text-text">X-Trace-Id</code> header
        (or use the Spanlens SDK&apos;s <code className="text-text">withTrace()</code>) to group requests into agent traces.
      </p>
    )
  }

  if (!trace) {
    return <p className="font-mono text-[11.5px] text-text-faint">Trace not found in the demo dataset.</p>
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10.5px] text-text-faint uppercase tracking-[0.05em]">
          Trace · {trace.span_count} span{trace.span_count === 1 ? '' : 's'}
        </div>
        <Link
          href={`/demo/traces/${traceId}`}
          className="font-mono text-[11px] text-accent hover:opacity-80 transition-opacity"
        >
          Open full trace →
        </Link>
      </div>
      <div className="rounded border border-border divide-y divide-border bg-bg-elev">
        {trace.spans.slice(0, 8).map((s) => (
          <div key={s.id} className="px-3 py-2 flex items-center gap-3">
            <span
              className={cn(
                'font-mono text-[9px] px-1.5 py-0.5 rounded border uppercase tracking-[0.04em] shrink-0',
                s.span_type === 'llm'
                  ? 'text-accent border-accent-border bg-accent-bg'
                  : s.span_type === 'tool'
                    ? 'text-text border-border'
                    : 'text-text-muted border-border',
              )}
            >
              {s.span_type}
            </span>
            <span className="text-[12px] text-text truncate flex-1">{s.name}</span>
            {s.duration_ms != null && (
              <span className="font-mono text-[10.5px] text-text-muted shrink-0">
                {s.duration_ms >= 1000 ? `${(s.duration_ms / 1000).toFixed(2)}s` : `${s.duration_ms}ms`}
              </span>
            )}
            {s.status === 'error' && (
              <span className="font-mono text-[10px] text-bad shrink-0">● error</span>
            )}
          </div>
        ))}
        {trace.spans.length > 8 && (
          <div className="px-3 py-2 font-mono text-[10.5px] text-text-faint">
            + {trace.spans.length - 8} more, open the full trace to see them all
          </div>
        )}
      </div>
    </div>
  )
}

function RawTab({
  req,
  displayRequestBody,
  displayResponseBody,
}: {
  req: RequestDetail
  displayRequestBody: unknown
  displayResponseBody: unknown
}) {
  return (
    <div className="space-y-5">
      <section>
        <div className="flex items-center justify-between mb-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">Request body</div>
          {req.request_body != null && (
            <CopyButton getText={() => JSON.stringify(req.request_body, null, 2)} />
          )}
        </div>
        {req.request_body == null ? (
          <p className="font-mono text-[11.5px] text-text-faint">Not captured.</p>
        ) : (
          <pre className="font-mono text-[11.5px] text-text leading-relaxed whitespace-pre-wrap break-all bg-bg-elev border border-border rounded p-3">
            {JSON.stringify(displayRequestBody, null, 2)}
          </pre>
        )}
      </section>
      <section>
        <div className="flex items-center justify-between mb-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">Response body</div>
          {req.response_body != null && (
            <CopyButton getText={() => JSON.stringify(req.response_body, null, 2)} />
          )}
        </div>
        {req.response_body == null ? (
          <p className="font-mono text-[11.5px] text-text-faint">Not captured.</p>
        ) : (
          <pre className="font-mono text-[11.5px] text-text leading-relaxed whitespace-pre-wrap break-all bg-bg-elev border border-border rounded p-3">
            {JSON.stringify(displayResponseBody, null, 2)}
          </pre>
        )}
      </section>
    </div>
  )
}

interface DrawerProps {
  req: RequestDetail | null
  visible: boolean
  onClose: () => void
  onPrev: () => void
  onNext: () => void
  hasPrev: boolean
  hasNext: boolean
  position: number
  total: number
}

function RequestDrawer({ req, visible, onClose, onPrev, onNext, hasPrev, hasNext, position, total }: DrawerProps) {
  // Parent remounts via key={selectedId} on row change, so tab + mask state
  // reset without a setState-in-effect.
  const [tab, setTab] = useState<DrawerTab>('request')
  const [maskPiiOn, setMaskPiiOn] = useState(false)

  // Close on Escape — matches side-panel conventions.
  useEffect(() => {
    if (!visible) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [visible, onClose])

  const displayBody = useMemo(() => {
    if (!req) return undefined
    if (!maskPiiOn) return req.request_body
    return maskPiiDeep(req.request_body)
  }, [maskPiiOn, req])

  const displayResponseBody = useMemo(() => {
    if (!req) return undefined
    if (!maskPiiOn) return req.response_body
    return maskPiiDeep(req.response_body)
  }, [maskPiiOn, req])

  const messages = useMemo(() => {
    if (!displayBody || typeof displayBody !== 'object') return null
    const body = displayBody as Record<string, unknown>

    // OpenAI / Anthropic: messages[]
    if (Array.isArray(body.messages)) {
      return (body.messages as unknown[]).filter(
        (m): m is { role: string; content: unknown } =>
          typeof m === 'object' && m !== null && typeof (m as { role?: unknown }).role === 'string',
      )
    }

    // Gemini: contents[].parts[].text
    if (Array.isArray(body.contents)) {
      return (body.contents as unknown[])
        .filter(
          (m): m is { role: string; parts: Array<{ text?: string }> } =>
            typeof m === 'object' &&
            m !== null &&
            typeof (m as Record<string, unknown>).role === 'string' &&
            Array.isArray((m as Record<string, unknown>).parts),
        )
        .map((m) => ({
          role: m.role === 'model' ? 'assistant' : m.role,
          content: m.parts.filter((p) => typeof p.text === 'string').map((p) => p.text as string).join(''),
        }))
    }

    return null
  }, [displayBody])

  return (
    <aside
      className={cn(
        'bg-bg-elev flex flex-col overflow-hidden',
        visible
          ? 'fixed inset-0 z-40 md:static md:z-auto md:w-[480px] md:shrink-0 md:border-l md:border-border border-t border-border'
          : 'hidden md:flex md:w-0 md:shrink-0',
        'transition-[width] duration-200 ease-out',
      )}
    >
      {req && (
        <>
          {/* Header */}
          <div className="px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2 mb-2.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">Request</span>
              {position > 0 && (
                <span className="font-mono text-[10px] text-text-faint">
                  {position} / {total}
                </span>
              )}
              <span className="flex-1" />
              <Link
                href={`/demo/requests/${req.id}`}
                className="font-mono text-[10px] px-1.5 py-0.5 border border-border rounded text-text-muted tracking-[0.04em] uppercase hover:border-border-strong transition-colors"
              >
                Open →
              </Link>
              <button
                type="button"
                onClick={() => setMaskPiiOn((v) => !v)}
                aria-pressed={maskPiiOn}
                title="Mask emails, phone numbers, card numbers, and API keys in the displayed body"
                className={cn(
                  'font-mono text-[10px] px-1.5 py-0.5 border rounded tracking-[0.04em] uppercase transition-colors',
                  maskPiiOn
                    ? 'border-accent text-accent bg-accent-bg'
                    : 'border-border text-text-muted hover:border-border-strong',
                )}
              >
                Mask PII{maskPiiOn ? ' · on' : ''}
              </button>
              {[
                { label: 'Prev', onClick: onPrev, disabled: !hasPrev },
                { label: 'Next', onClick: onNext, disabled: !hasNext },
              ].map(({ label, onClick, disabled }) => (
                <button
                  key={label}
                  onClick={onClick}
                  disabled={disabled}
                  className="font-mono text-[10px] px-1.5 py-0.5 border border-border rounded text-text-muted tracking-[0.04em] uppercase disabled:opacity-30 hover:border-border-strong transition-colors"
                >
                  {label}
                </button>
              ))}
              <button
                onClick={onClose}
                className="font-mono text-[10px] px-1.5 py-0.5 border border-border rounded text-text-muted tracking-[0.04em] uppercase hover:border-border-strong transition-colors"
              >
                Close
              </button>
            </div>
            <div className="font-mono text-[13px] text-text mb-1 truncate">{req.id}</div>
            <div className="flex items-center gap-2 text-[12px] text-text-muted">
              <span>{formatDateTime(req.created_at)}</span>
              {req.status_code >= 400 && (
                <>
                  <span className="text-text-faint">·</span>
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-accent-bg text-accent border border-accent-border uppercase tracking-[0.04em]">
                    Error {req.status_code}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* KV grid */}
          <div className="px-5 py-3.5 border-b border-border grid grid-cols-2 gap-x-3.5 gap-y-3">
            {(
              [
                ['Model', req.model],
                ['Key', req.provider_key_name ?? req.provider],
                ['Status', String(req.status_code)],
                ['Prompt tokens', req.prompt_tokens.toLocaleString('en-US')],
                ['Completion', req.completion_tokens.toLocaleString('en-US')],
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k}>
                <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-0.5">{k}</div>
                <div className="font-mono text-[12.5px] text-text truncate">{v}</div>
              </div>
            ))}

            {req.user_id && (
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-0.5">User</div>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[12.5px] text-text truncate">{req.user_id}</span>
                  <Link
                    href={`/demo/requests?userId=${encodeURIComponent(req.user_id)}`}
                    className="font-mono text-[10px] text-text-faint hover:text-text shrink-0"
                    title={`Filter requests by user: ${req.user_id}`}
                  >
                    filter
                  </Link>
                </div>
              </div>
            )}

            {req.session_id && (
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-0.5">Session</div>
                <Link
                  href={`/demo/requests?sessionId=${encodeURIComponent(req.session_id)}`}
                  className="font-mono text-[12.5px] text-text hover:underline truncate block"
                  title={`Filter by session: ${req.session_id}`}
                >
                  {req.session_id}
                </Link>
              </div>
            )}

            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-0.5">Trace</div>
              {req.trace_id ? (
                <div className="flex items-center gap-1 min-w-0">
                  <Link
                    href={`/demo/traces/${req.trace_id}`}
                    className="font-mono text-[12.5px] text-accent hover:opacity-70 transition-opacity truncate min-w-0"
                  >
                    {req.trace_id.slice(0, 12)}…
                  </Link>
                  <CopyButton getText={() => req.trace_id!} />
                </div>
              ) : (
                <div className="font-mono text-[12.5px] text-text-faint">Not attached</div>
              )}
            </div>

            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-0.5">Span</div>
              {req.span_id ? (
                <div className="flex items-center gap-1 min-w-0">
                  <span className="font-mono text-[12.5px] text-text truncate min-w-0">{req.span_id.slice(0, 12)}…</span>
                  <CopyButton getText={() => req.span_id!} />
                </div>
              ) : (
                <div className="font-mono text-[12.5px] text-text-faint">Not attached</div>
              )}
            </div>
          </div>

          {/* Metrics row */}
          <div className="px-5 py-3.5 border-b border-border grid grid-cols-3">
            {[
              { label: 'Latency', value: `${req.latency_ms}ms`, sub: '', warn: req.latency_ms > 2000 },
              { label: 'Cost', value: fmtCost(req.cost_usd), sub: '', warn: false },
              {
                label: 'Tokens',
                value: req.total_tokens.toLocaleString('en-US'),
                sub: `${req.prompt_tokens} in / ${req.completion_tokens} out`,
                warn: false,
              },
            ].map((s, i) => (
              <div
                key={s.label}
                className={cn('pr-3 pl-3', i === 0 && 'pl-0', i === 2 && 'pr-0', i < 2 && 'border-r border-border')}
              >
                <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-1.5">{s.label}</div>
                <div
                  className={cn(
                    'text-[20px] font-medium tracking-[-0.3px] leading-none',
                    s.warn ? 'text-accent' : 'text-text',
                  )}
                >
                  {s.value}
                </div>
                {s.sub && (
                  <div className="font-mono text-[10px] text-text-faint mt-1 tracking-[0.03em]">{s.sub}</div>
                )}
              </div>
            ))}
          </div>

          {/* Tabs */}
          {(() => {
            const tabs: DrawerTab[] = [
              'request',
              'response',
              'trace',
              'raw',
              ...(req.error_message ? ['error' as DrawerTab] : []),
            ]
            return (
              <div className="flex px-5 border-b border-border gap-5 shrink-0">
                {tabs.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={cn(
                      'py-2.5 font-mono text-[11px] uppercase tracking-[0.04em] border-b-[1.5px] -mb-px transition-colors',
                      tab === t ? 'text-text border-accent' : 'text-text-muted border-transparent hover:text-text',
                      t === 'error' && tab !== 'error' && 'text-bad',
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )
          })()}

          {/* Tab content */}
          <div className="px-5 py-4 flex-1 overflow-auto">
            {tab === 'request' ? (
              <div className="space-y-2">
                <div className="flex justify-end">
                  <CopyButton getText={() => JSON.stringify(req.request_body, null, 2)} />
                </div>
                <MessageDisplay messages={messages} body={displayBody} />
              </div>
            ) : tab === 'response' ? (
              req.response_body == null ? (
                <p className="font-mono text-[11.5px] text-text-faint leading-relaxed">
                  Response body is not stored, the proxy streams the response directly to your application without buffering it.
                  <br />
                  <br />
                  Full response capture is planned for a future release.
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="flex justify-end">
                    <CopyButton getText={() => JSON.stringify(req.response_body, null, 2)} />
                  </div>
                  <pre className="font-mono text-[11.5px] text-text-muted leading-relaxed whitespace-pre-wrap break-all">
                    {JSON.stringify(displayResponseBody, null, 2)}
                  </pre>
                </div>
              )
            ) : tab === 'trace' ? (
              <TraceTab traceId={req.trace_id ?? null} />
            ) : tab === 'error' ? (
              <pre className="font-mono text-[12px] text-bad leading-relaxed whitespace-pre-wrap break-all">
                {maskPiiOn && req.error_message ? maskPii(req.error_message) : req.error_message}
              </pre>
            ) : (
              <RawTab req={req} displayRequestBody={displayBody} displayResponseBody={displayResponseBody} />
            )}
          </div>
        </>
      )}
    </aside>
  )
}

// ── SortBtn ───────────────────────────────────────────────────────────────────

function SortBtn({
  field,
  label,
  sortField,
  sortDir,
  onSort,
}: {
  field: SortField
  label: string
  sortField: SortField
  sortDir: SortDir
  onSort: (f: SortField) => void
}) {
  const active = sortField === field
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={cn(
        'inline-flex items-center gap-0.5 hover:text-text transition-colors',
        active ? 'text-text' : '',
      )}
    >
      {label}
      <span className="ml-0.5 opacity-60">
        {active ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}
      </span>
    </button>
  )
}

// ── RequestsTable ─────────────────────────────────────────────────────────────

const COL_FULL = '20px 1.6fr 0.9fr 0.75fr 0.7fr 0.8fr 0.6fr 0.5fr'
const COL_NARROW = '20px 1.6fr 0.75fr 0.7fr 0.8fr 0.6fr 0.5fr'

function RequestsTable({
  rows,
  selectedId,
  onSelect,
  drawerOpen,
  sortField,
  sortDir,
  onSort,
  hasActiveFilters,
}: {
  rows: RequestRow[]
  selectedId: string | null
  onSelect: (id: string) => void
  drawerOpen: boolean
  sortField: SortField
  sortDir: SortDir
  onSort: (f: SortField) => void
  hasActiveFilters: boolean
}) {
  const cols = drawerOpen ? COL_NARROW : COL_FULL
  return (
    <div className="overflow-auto flex-1 min-h-0">
      <div className="min-w-[640px]">
        {/* Header */}
        <div
          className="grid px-[22px] py-2.5 font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint border-b border-border bg-bg-muted sticky top-0 z-10"
          style={{ gridTemplateColumns: cols }}
        >
          <span />
          <span>Model</span>
          {!drawerOpen && <span>Provider</span>}
          <SortBtn
            field="latency_ms"
            label="Latency"
            sortField={sortField}
            sortDir={sortDir}
            onSort={onSort}
          />
          <SortBtn
            field="total_tokens"
            label="Tokens"
            sortField={sortField}
            sortDir={sortDir}
            onSort={onSort}
          />
          <SortBtn
            field="cost_usd"
            label="Cost"
            sortField={sortField}
            sortDir={sortDir}
            onSort={onSort}
          />
          <span>Status</span>
          <span className="flex justify-end">
            <SortBtn
              field="created_at"
              label="Age"
              sortField={sortField}
              sortDir={sortDir}
              onSort={onSort}
            />
          </span>
        </div>

        {rows.length === 0 ? (
          <div className="text-center py-12 font-mono text-[12.5px] text-text-faint">
            {hasActiveFilters
              ? 'No requests match the current filters.'
              : 'No requests found.'}
          </div>
        ) : (
          rows.map((req) => {
            const isErr = req.status_code >= 400
            const isSelected = req.id === selectedId
            return (
              <div
                key={req.id}
                onClick={() => onSelect(req.id)}
                className={cn(
                  'grid px-[22px] py-2.5 border-b border-border font-mono text-[12.5px] items-center cursor-pointer transition-colors border-l-2',
                  isSelected
                    ? 'bg-bg-muted border-l-accent'
                    : isErr
                      ? 'bg-accent-bg border-l-transparent hover:bg-accent-bg/80'
                      : 'border-l-transparent hover:bg-bg-muted',
                )}
                style={{
                  gridTemplateColumns: cols,
                  paddingLeft: isSelected ? 20 : 22,
                }}
              >
                <span>
                  {isErr && (
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent" />
                  )}
                </span>
                <span className="text-text truncate pr-2">{req.model}</span>
                {!drawerOpen && <span className="text-text-muted">{req.provider}</span>}
                <span className={isErr ? 'text-accent' : 'text-text'}>
                  {req.latency_ms}ms
                </span>
                <span className="text-text-muted">{req.total_tokens.toLocaleString('en-US')}</span>
                <span className="text-text">{fmtCost(req.cost_usd)}</span>
                <span className={isErr ? 'text-bad' : 'text-good'}>{req.status_code}</span>
                <span
                  className="text-text-faint text-right"
                  title={new Date(req.created_at).toLocaleString('en-US')}
                >
                  {relAge(req.created_at)}
                </span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

function DemoRequestsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const userIdFilter = searchParams.get('userId')
  const sessionIdFilter = searchParams.get('sessionId')

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [providerFilter, setProviderFilter] = useState('all')
  const [providerKeyFilter, setProviderKeyFilter] = useState('all')
  const [modelInput, setModelInput] = useState('')
  const [timeRange, setTimeRange] = useState<TimeRange>('all')
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    setTimeout(() => setRefreshing(false), 400)
  }, [])

  // Capture "now" once at mount — demo data is static, no need for live time.
  const now = useHydrationSafeNow()

  const filtered = useMemo(() => {
    let rows = [...DEMO_REQUESTS]

    // Time range
    if (timeRange === 'today') {
      const startOfDay = new Date()
      startOfDay.setUTCHours(0, 0, 0, 0)
      rows = rows.filter((r) => new Date(r.created_at).getTime() >= startOfDay.getTime())
    } else if (timeRange === '7d') {
      const cutoff = now - 7 * 24 * 3_600_000
      rows = rows.filter((r) => new Date(r.created_at).getTime() >= cutoff)
    } else if (timeRange === '30d') {
      const cutoff = now - 30 * 24 * 3_600_000
      rows = rows.filter((r) => new Date(r.created_at).getTime() >= cutoff)
    }

    // Status
    if (statusFilter === 'ok') rows = rows.filter((r) => r.status_code < 400)
    else if (statusFilter === '4xx')
      rows = rows.filter((r) => r.status_code >= 400 && r.status_code < 500)
    else if (statusFilter === '5xx') rows = rows.filter((r) => r.status_code >= 500)

    // Provider
    if (providerFilter !== 'all') rows = rows.filter((r) => r.provider === providerFilter)

    // Provider key
    if (providerKeyFilter !== 'all')
      rows = rows.filter((r) => r.provider_key_name === providerKeyFilter)

    // User / Session (URL params)
    if (userIdFilter) rows = rows.filter((r) => r.user_id === userIdFilter)
    if (sessionIdFilter) rows = rows.filter((r) => r.session_id === sessionIdFilter)

    // Model search
    const modelTrim = modelInput.trim().toLowerCase()
    if (modelTrim) rows = rows.filter((r) => r.model.toLowerCase().includes(modelTrim))

    // Sort
    rows.sort((a, b) => {
      let av: number
      let bv: number
      if (sortField === 'created_at') {
        av = new Date(a.created_at).getTime()
        bv = new Date(b.created_at).getTime()
      } else if (sortField === 'cost_usd') {
        av = a.cost_usd ?? 0
        bv = b.cost_usd ?? 0
      } else {
        av = a[sortField] as number
        bv = b[sortField] as number
      }
      return sortDir === 'desc' ? bv - av : av - bv
    })

    return rows
  }, [statusFilter, providerFilter, providerKeyFilter, modelInput, timeRange, sortField, sortDir, now, userIdFilter, sessionIdFilter])

  const hasActiveFilters =
    statusFilter !== 'all' ||
    providerFilter !== 'all' ||
    providerKeyFilter !== 'all' ||
    modelInput.trim() !== '' ||
    timeRange !== 'all' ||
    !!userIdFilter ||
    !!sessionIdFilter

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortField(field)
      setSortDir('desc')
    }
    setSelectedId(null)
  }

  // Row click toggles the inline drawer. Selecting the same row again closes it.
  function handleSelect(id: string) {
    setSelectedId((prev) => (prev === id ? null : id))
  }

  function clearFilters() {
    setStatusFilter('all')
    setProviderFilter('all')
    setProviderKeyFilter('all')
    setModelInput('')
    setTimeRange('all')
    setSelectedId(null)
    if (userIdFilter || sessionIdFilter) router.push('/demo/requests')
  }

  function applyView(view: DemoView) {
    setStatusFilter(view.status)
    setProviderFilter(view.provider)
    setProviderKeyFilter(view.providerKey)
    setTimeRange(view.timeRange)
    setSortField(view.sortField)
    setSortDir(view.sortDir)
    setModelInput('')
    setSelectedId(null)
  }

  // Drawer navigation over the filtered list.
  const drawerOpen = selectedId !== null
  const selectedIdx = selectedId ? filtered.findIndex((r) => r.id === selectedId) : -1
  const selectedDetail = selectedId ? DEMO_REQUEST_DETAILS[selectedId] ?? null : null

  const savedViewsActive = {
    status: statusFilter,
    provider: providerFilter,
    providerKey: providerKeyFilter,
    timeRange,
    sortField,
    sortDir,
  }

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col md:flex-row h-screen overflow-hidden bg-bg">
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Topbar
          crumbs={[{ label: 'Demo', href: '/demo/dashboard' }, { label: 'Requests' }]}
          right={
            <DemoExportButton
              base="requests"
              rows={filtered}
              columns={[
                { header: 'Created', value: (r: RequestRow) => r.created_at },
                { header: 'Provider', value: (r: RequestRow) => r.provider },
                { header: 'Model', value: (r: RequestRow) => r.model },
                { header: 'Status', value: (r: RequestRow) => r.status_code },
                { header: 'Latency ms', value: (r: RequestRow) => r.latency_ms },
                { header: 'Tokens', value: (r: RequestRow) => r.total_tokens },
                { header: 'Cost USD', value: (r: RequestRow) => r.cost_usd ?? '' },
                { header: 'User', value: (r: RequestRow) => r.user_id ?? '' },
              ]}
            />
          }
        />

        {(userIdFilter || sessionIdFilter) && (
          <div className="shrink-0 flex items-center gap-2 px-[22px] py-[8px] border-b border-border bg-accent/5 font-mono text-[11.5px]">
            <span className="text-text-faint">Filtering by</span>
            {userIdFilter && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-accent/10 border border-accent/20 text-accent">
                user: {userIdFilter}
              </span>
            )}
            {sessionIdFilter && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-accent/10 border border-accent/20 text-accent">
                session: {sessionIdFilter}
              </span>
            )}
            <button
              onClick={clearFilters}
              className="ml-1 text-text-faint hover:text-text transition-colors"
            >
              ✕
            </button>
          </div>
        )}

        <StatStrip />
        <TrafficBars />

        {/* Filter row */}
        <div className="flex items-center gap-1.5 px-[22px] py-[10px] border-b border-border shrink-0 flex-wrap">
          {/* Time range */}
          <div className="flex border border-border rounded-[5px] overflow-hidden bg-bg-elev font-mono text-[10.5px] tracking-[0.03em] shrink-0">
            {(['all', 'today', '7d', '30d'] as TimeRange[]).map((r) => (
              <button
                key={r}
                onClick={() => {
                  setTimeRange(r)
                  setSelectedId(null)
                }}
                className={cn(
                  'px-[10px] py-[5px]',
                  timeRange === r
                    ? 'bg-text text-bg'
                    : 'text-text-muted hover:text-text transition-colors',
                )}
              >
                {r === 'all' ? 'All time' : r === 'today' ? 'Today' : r}
              </button>
            ))}
          </div>

          {/* Status segmented */}
          <div className="flex border border-border rounded-[5px] overflow-hidden bg-bg-elev font-mono text-[10.5px] tracking-[0.03em] shrink-0">
            {(['all', 'ok', '4xx', '5xx'] as StatusFilter[]).map((v) => (
              <button
                key={v}
                onClick={() => {
                  setStatusFilter(v)
                  setSelectedId(null)
                }}
                className={cn(
                  'px-[10px] py-[5px] inline-flex items-center gap-1.5',
                  statusFilter === v
                    ? 'bg-text text-bg'
                    : 'text-text-muted hover:text-text transition-colors',
                )}
              >
                {STATUS_LABELS[v]}
                {statusFilter === v && (
                  <span className="opacity-60 text-bg">{filtered.length}</span>
                )}
              </button>
            ))}
          </div>

          {/* Provider select */}
          <select
            value={providerFilter}
            onChange={(e) => {
              setProviderFilter(e.target.value)
              setSelectedId(null)
            }}
            className="font-mono text-[11px] border border-border rounded-[5px] px-2 py-[5px] bg-bg text-text-muted hover:border-border-strong transition-colors focus:outline-none appearance-none cursor-pointer"
          >
            <option value="all">All providers</option>
            <option value="openai">openai</option>
            <option value="anthropic">anthropic</option>
            <option value="google">google</option>
          </select>

          {/* Provider key select */}
          <select
            value={providerKeyFilter}
            onChange={(e) => {
              setProviderKeyFilter(e.target.value)
              setSelectedId(null)
            }}
            className="font-mono text-[11px] border border-border rounded-[5px] px-2 py-[5px] bg-bg text-text-muted hover:border-border-strong transition-colors focus:outline-none appearance-none cursor-pointer max-w-[190px]"
          >
            <option value="all">All keys</option>
            {PROVIDER_KEY_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>

          {/* Model input */}
          <input
            type="text"
            placeholder="Model…"
            value={modelInput}
            onChange={(e) => setModelInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setModelInput('')
            }}
            className="font-mono text-[11px] border border-border rounded-[5px] px-2 py-[5px] bg-bg text-text-muted hover:border-border-strong focus:border-border-strong transition-colors outline-none w-28 placeholder:text-text-faint"
          />

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="font-mono text-[10.5px] px-[9px] py-[5px] border border-border rounded-[5px] text-text-faint hover:text-text hover:border-border-strong transition-colors shrink-0"
            >
              Clear filters
            </button>
          )}

          <span className="flex-1" />
          <span className="font-mono text-[11px] text-text-faint">
            Showing {filtered.length} of {DEMO_REQUESTS.length}
          </span>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="font-mono text-[10.5px] px-[9px] py-[4px] border border-border rounded-[5px] text-text-muted hover:text-text hover:border-border-strong disabled:opacity-40 transition-colors"
          >
            {refreshing ? '↻ …' : '↻'}
          </button>
        </div>

        {/* Saved views — static presets that set the local filters. */}
        <SavedViewsBar active={savedViewsActive} onApply={applyView} />

        {/* Table */}
        <div className="flex flex-col flex-1 overflow-hidden">
          <RequestsTable
            rows={filtered}
            selectedId={selectedId}
            onSelect={handleSelect}
            drawerOpen={drawerOpen}
            sortField={sortField}
            sortDir={sortDir}
            onSort={handleSort}
            hasActiveFilters={hasActiveFilters}
          />

          {/* Pagination (demo: single page) */}
          <div className="flex items-center justify-between px-[22px] py-3 border-t border-border shrink-0">
            <span className="font-mono text-[11px] text-text-faint">
              Page 1 · {filtered.length.toLocaleString('en-US')} total
            </span>
            <div className="flex gap-1.5">
              <button
                disabled
                className="font-mono text-[11px] px-2.5 py-1 border border-border rounded text-text-muted disabled:opacity-30"
              >
                ← Prev
              </button>
              <button
                disabled
                className="font-mono text-[11px] px-2.5 py-1 border border-border rounded text-text-muted disabled:opacity-30"
              >
                Next →
              </button>
            </div>
          </div>
        </div>
      </div>

      <RequestDrawer
        // key remounts the drawer on row change so tab + mask state reset.
        key={selectedId ?? '__none__'}
        req={selectedDetail}
        visible={drawerOpen && !!selectedDetail}
        onClose={() => setSelectedId(null)}
        onPrev={() => {
          if (selectedIdx > 0) setSelectedId(filtered[selectedIdx - 1]?.id ?? null)
        }}
        onNext={() => {
          if (selectedIdx >= 0 && selectedIdx < filtered.length - 1)
            setSelectedId(filtered[selectedIdx + 1]?.id ?? null)
        }}
        hasPrev={selectedIdx > 0}
        hasNext={selectedIdx >= 0 && selectedIdx < filtered.length - 1}
        position={selectedIdx + 1}
        total={filtered.length}
      />
    </div>
  )
}

export default function DemoRequestsPage() {
  return (
    <Suspense fallback={null}>
      <DemoRequestsContent />
    </Suspense>
  )
}
