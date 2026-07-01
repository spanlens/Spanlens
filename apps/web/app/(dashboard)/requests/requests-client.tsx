'use client'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ErrorBoundary } from '@/components/error-boundary'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ExportDropdown } from '@/components/ui/export-dropdown'
import { cn, formatDateTime } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { Topbar } from '@/components/layout/topbar'
import {
  useRequests,
  useRequest,
  type SavedFilterParams,
} from '@/lib/queries/use-requests'
import { SavedViewsBar } from './saved-views-bar'
import { EmptyRequestsHint } from './empty-requests-hint'
import { useProviderKeys } from '@/lib/queries/use-provider-keys'
import { useTrace } from '@/lib/queries/use-traces'
import { useStatsOverview, useStatsTimeseries, useTimeseriesBreakdown } from '@/lib/queries/use-stats'
import { useAnomalies } from '@/lib/queries/use-anomalies'
import type { RequestRow, RequestDetail } from '@/lib/queries/types'
import { maskPii, maskPiiDeep } from '@/lib/pii-mask'

// Hydration-safe "is this the client?" gate. SSR returns false, client paint
// returns true. Avoids the setState-in-effect lint rule. See dashboard-client.
const subscribeNoop = () => () => {}
const getTrue = () => true
const getFalse = () => false
function useMounted(): boolean {
  return useSyncExternalStore(subscribeNoop, getTrue, getFalse)
}

// Slow latency threshold for the table row callout. Above this latency a
// row's `latency_ms` cell is colored to draw attention.
const SLOW_LATENCY_MS = 2000

type StatusFilter = 'all' | 'ok' | '4xx' | '5xx'
type SortField = 'created_at' | 'latency_ms' | 'cost_usd' | 'total_tokens'
type SortDir = 'asc' | 'desc'
type TimeRange = 'all' | 'today' | '7d' | '30d'

const STATUS_LABELS: Record<StatusFilter, string> = { all: 'All', ok: 'OK', '4xx': '4xx', '5xx': '5xx' }

interface UiFilters {
  provider: string
  status: StatusFilter
  model: string
  providerKeyId: string
}


function relAge(dateStr: string): string {
  const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

// Cost rendering rationale documented at fmtCostDense in lib/format.ts.
// Note: this site previously rendered `$0.00000` for zero cost; the
// shared helper renders "—" so zero rows visually match the "no data"
// path. Intentional unification.
import { fmtCostDense as fmtCost } from '@/lib/format'

// Provider colors — used as a small dot before the model name to make the
// table scannable at a glance. Brand-leaning hues to match user mental model
// (OpenAI green-teal, Anthropic warm orange, Gemini blue, Mistral red).
// Falls back to a muted gray for unknown providers.
const PROVIDER_DOT: Record<string, string> = {
  openai:    '#10a37f',
  anthropic: '#cc785c',
  gemini:    '#4285f4',
  google:    '#4285f4',
  mistral:   '#fa520f',
}

function providerDotColor(provider: string): string {
  return PROVIDER_DOT[provider.toLowerCase()] ?? 'var(--text-faint)'
}

// Tiered latency color — gives the column visual depth so the eye finds
// outliers without needing the user to read every number.
// <500ms quiet, <2s normal, <5s warn, ≥5s loud.
function latencyClass(latencyMs: number, isError: boolean): string {
  if (isError) return 'text-accent'
  if (latencyMs >= 5000) return 'text-bad'
  if (latencyMs >= SLOW_LATENCY_MS) return 'text-warn'
  if (latencyMs < 500) return 'text-text-muted'
  return 'text-text'
}

// Status code pill — same shape across 2xx/4xx/5xx so column width stays
// stable, color tells the story.
function statusPillClass(code: number): string {
  if (code >= 500) return 'border-bad/30 bg-bad/10 text-bad'
  if (code >= 400) return 'border-warn/30 bg-warn/10 text-warn'
  if (code >= 200 && code < 300) return 'border-good/30 bg-good/10 text-good'
  return 'border-border bg-bg text-text-muted'
}

// Maps the URL `timeRange` enum to a human label used in stat-strip and
// any "Last X" copy that the page renders.
function timeRangeLabel(r: 'all' | 'today' | '7d' | '30d'): string {
  switch (r) {
    case 'today': return 'today'
    case '7d': return '7d'
    case '30d': return '30d'
    default: return 'all time'
  }
}
function timeRangeHours(r: 'all' | 'today' | '7d' | '30d'): number {
  switch (r) {
    case 'today': return 24
    case '7d': return 24 * 7
    case '30d': return 24 * 30
    default: return 24 * 30
  }
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

function InlineSpark({ values, w = 120, h = 18, stroke = 'var(--border-strong)' }: { values: number[]; w?: number; h?: number; stroke?: string }) {
  const path = sparkPath(values, w, h)
  if (!path) return null
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block w-full">
      <path d={path} stroke={stroke} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" suppressHydrationWarning />
    </svg>
  )
}

// ── Stat strip ────────────────────────────────────────────────────────────────
interface StatStripProps {
  timeRange: 'all' | 'today' | '7d' | '30d'
  fromIso: string | undefined
}

function StatStrip({ timeRange, fromIso }: StatStripProps) {
  // Same window the table is showing — keeps the stat strip and the table
  // visually consistent so the user can never see "0 requests" up here while
  // 252 rows render below.
  const hours = timeRangeHours(timeRange)
  const overview = useStatsOverview(
    fromIso ? { from: fromIso, compare: true } : { hours, compare: true },
  )
  const timeseries = useStatsTimeseries(
    fromIso ? { from: fromIso } : { hours },
  )
  const anomalies = useAnomalies({ observationHours: hours })
  const mounted = useMounted()

  const o = overview.data
  const ts = timeseries.data ?? []
  const sparkReqs = ts.slice(-10).map((d) => d.requests)
  const sparkCost = ts.slice(-10).map((d) => d.cost)
  const sparkErrors = ts.slice(-10).map((d) => d.errors)

  const errorRatePct = o && o.totalRequests > 0 ? (o.errorRequests / o.totalRequests) * 100 : 0
  const errorRateStr = errorRatePct.toFixed(1) + '%'
  const anomalyCount = (anomalies.data?.data ?? []).length

  const rangeLabel = timeRangeLabel(timeRange)

  const stats = [
    { label: `Requests · ${rangeLabel}`, value: o ? o.totalRequests.toLocaleString() : '—', spark: sparkReqs, warn: false, good: false },
    { label: 'Avg latency', value: o ? `${o.avgLatencyMs}ms` : '—', spark: [], warn: o ? o.avgLatencyMs > 1000 : false, good: false },
    { label: `Spend · ${rangeLabel}`, value: o ? '$' + o.totalCostUsd.toFixed(2) : '—', spark: sparkCost, warn: false, good: true },
    { label: 'Error rate', value: errorRateStr, spark: sparkErrors, warn: errorRatePct > 1, good: false },
    { label: 'Anomalies', value: anomalyCount.toString(), spark: [], warn: anomalyCount > 0, good: false },
  ]

  return (
    <div className="overflow-x-auto shrink-0 border-b border-border">
      <div className="grid grid-cols-5 min-w-[480px]">
        {stats.map((s, i) => (
          <div key={i} className={cn('px-[18px] py-[14px]', i < 4 && 'border-r border-border')}>
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">{s.label}</div>
            <div
              className={cn('text-[24px] font-medium tracking-[-0.6px] leading-none mb-1.5', s.warn ? 'text-accent' : 'text-text')}
            >
              {/* Render an em-dash until the client hydrates so SSR and the
                  first client paint produce identical text — eliminates the
                  prior `suppressHydrationWarning`. */}
              {mounted ? s.value : '—'}
            </div>
            <InlineSpark
              values={mounted ? s.spark : []}
              stroke={s.warn ? 'var(--accent)' : s.good ? 'var(--good)' : 'var(--border-strong)'}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Traffic bars ──────────────────────────────────────────────────────────────
interface TrafficBarsProps {
  timeRange: 'all' | 'today' | '7d' | '30d'
  fromIso: string | undefined
}

const CHART_H = 96  // px — total bar/line plot area

function TrafficBars({ timeRange, fromIso }: TrafficBarsProps) {
  // Lock to "last 30d" when the user has selected All time so the chart still
  // has a meaningful baseline; otherwise honor the same window as the stat
  // strip and the table.
  const hours = timeRange === 'all' ? 24 * 30 : timeRangeHours(timeRange)
  const queryParams = fromIso ? { from: fromIso } : { hours }
  const timeseries = useStatsTimeseries(queryParams)
  const breakdown = useTimeseriesBreakdown(queryParams)
  const rawTs = timeseries.data

  // Toggle whether the latency overlay lines are rendered.
  const [showLatency, setShowLatency] = useState(true)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const bucketCount = useMemo(() => {
    if (timeRange === 'today') return 24
    if (timeRange === '7d') return 7
    return 30
  }, [timeRange])

  const slice = useMemo(() => (rawTs ?? []).slice(-bucketCount), [rawTs, bucketCount])

  const breakdownByDate = useMemo(() => {
    const m = new Map<string, { topStatus: { value: string; count: number }[]; topModels: { value: string; count: number }[] }>()
    for (const p of breakdown.data ?? []) {
      m.set(p.date, { topStatus: p.topStatus, topModels: p.topModels })
    }
    return m
  }, [breakdown.data])

  const { bars, maxReq, maxLatency } = useMemo(() => {
    if (!slice.length) {
      return {
        bars: Array.from({ length: bucketCount }).map(() => ({
          requests: 0, ok: 0, e4xx: 0, e5xx: 0, p50: null as number | null, p95: null as number | null,
          hOk: 4, hE4xx: 0, hE5xx: 0,
        })),
        maxReq: 1,
        maxLatency: 1,
      }
    }
    const localMaxReq = Math.max(...slice.map((d) => d.requests), 1)
    const localMaxLat = Math.max(...slice.map((d) => d.p95LatencyMs ?? 0), 1)
    const bars = slice.map((d) => {
      const e4xx = d.errors4xx ?? 0
      const e5xx = d.errors5xx ?? Math.max(0, (d.errors ?? 0) - e4xx)
      const ok = Math.max(0, d.requests - e4xx - e5xx)
      const total = d.requests
      const scaleH = (n: number) => (total === 0 ? 0 : (n / localMaxReq) * (CHART_H - 8))
      return {
        requests: total,
        ok,
        e4xx,
        e5xx,
        p50: d.p50LatencyMs ?? null,
        p95: d.p95LatencyMs ?? null,
        hOk:  Math.max(total > 0 ? 2 : 0, scaleH(ok)),
        hE4xx: scaleH(e4xx),
        hE5xx: scaleH(e5xx),
      }
    })
    return { bars, maxReq: localMaxReq, maxLatency: localMaxLat }
  }, [slice, bucketCount])

  const labels = useMemo(() => {
    const pts = slice
    const first = pts[0]
    if (!pts.length || !first) return ['—', '—', '—', '—', 'NOW']
    const fmt = (s: string) =>
      timeRange === 'today'
        ? new Date(s).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
        : new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    return [
      fmt(first.date),
      fmt((pts[Math.floor(pts.length * 0.25)] ?? first).date),
      fmt((pts[Math.floor(pts.length * 0.5)] ?? first).date),
      fmt((pts[Math.floor(pts.length * 0.75)] ?? first).date),
      'NOW',
    ]
  }, [slice, timeRange])

  const trailingLabel =
    timeRange === 'all'   ? 'last 30d' :
    timeRange === 'today' ? 'today' :
    `last ${timeRange}`

  // SVG polyline points for the latency overlay
  const latencyPoints = useMemo(() => {
    if (!slice.length) return { p50: '', p95: '' }
    const w = 100 // percent units
    const stepX = w / Math.max(1, slice.length - 1)
    const yFor = (v: number | null) => {
      if (v == null || maxLatency === 0) return null
      return CHART_H - 4 - (v / maxLatency) * (CHART_H - 12)
    }
    const buildLine = (vals: (number | null)[]): string => {
      const pts: string[] = []
      vals.forEach((v, i) => {
        const y = yFor(v)
        if (y == null) return
        pts.push(`${(i * stepX).toFixed(2)},${y.toFixed(2)}`)
      })
      return pts.join(' ')
    }
    return {
      p50: buildLine(bars.map((b) => b.p50)),
      p95: buildLine(bars.map((b) => b.p95)),
    }
  }, [bars, slice, maxLatency])

  const hoverDate = hoverIdx != null ? slice[hoverIdx]?.date ?? null : null
  const hoverBreakdown = hoverDate ? breakdownByDate.get(hoverDate) : undefined
  const hoverBar = hoverIdx != null ? bars[hoverIdx] : null

  const fmtTooltipDate = (s: string) =>
    timeRange === 'today'
      ? new Date(s).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
      : new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

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
        <div className="font-mono text-[10.5px] text-text-faint tracking-[0.03em]">{trailingLabel}</div>
      </div>

      <div
        className="relative"
        style={{ height: CHART_H }}
        onMouseLeave={() => setHoverIdx(null)}
      >
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
                    className={cn('rounded-t-[1px]', b.hE4xx === 0 && b.hE5xx === 0 ? 'rounded-t-[1px]' : 'rounded-none')}
                    style={{ height: b.hOk, background: isHover ? 'var(--text-muted)' : 'var(--border-strong)' }}
                  />
                )}
                {b.hE4xx > 0 && (
                  <div style={{ height: b.hE4xx, background: 'var(--warn)' }} />
                )}
                {b.hE5xx > 0 && (
                  <div
                    className="rounded-t-[1px]"
                    style={{ height: b.hE5xx, background: 'var(--bad)' }}
                  />
                )}
              </div>
            )
          })}
        </div>

        {/* Latency overlay (p50 dotted, p95 solid) */}
        {showLatency && slice.length > 1 && (
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
        {labels.map((l, i) => <span key={i}>{l}</span>)}
      </div>

      {/* Tooltip */}
      {hoverIdx != null && hoverBar && hoverDate && (
        <div className="mt-3 rounded-[5px] border border-border bg-bg-elev px-3 py-2 font-mono text-[11px]">
          <div className="flex items-baseline justify-between gap-3 mb-1.5">
            <span className="text-text">{fmtTooltipDate(hoverDate)}</span>
            <span className="text-text-faint text-[10.5px]">
              {hoverBar.requests.toLocaleString()} req
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[10.5px] text-text-muted">
            <div className="flex justify-between">
              <span>4xx</span>
              <span className={hoverBar.e4xx > 0 ? 'text-warn' : 'text-text-faint'}>
                {hoverBar.e4xx.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span>p50</span>
              <span className="text-text">{hoverBar.p50 != null ? `${Math.round(hoverBar.p50)}ms` : '—'}</span>
            </div>
            <div className="flex justify-between">
              <span>5xx</span>
              <span className={hoverBar.e5xx > 0 ? 'text-bad' : 'text-text-faint'}>
                {hoverBar.e5xx.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span>p95</span>
              <span className="text-text">{hoverBar.p95 != null ? `${Math.round(hoverBar.p95)}ms` : '—'}</span>
            </div>
          </div>
          {hoverBreakdown && (hoverBreakdown.topStatus.length > 0 || hoverBreakdown.topModels.length > 0) && (
            <div className="mt-2 pt-2 border-t border-border grid grid-cols-2 gap-x-6 gap-y-0.5 text-[10.5px]">
              <div>
                <div className="text-text-faint uppercase tracking-[0.05em] text-[9.5px] mb-1">Top status</div>
                {hoverBreakdown.topStatus.slice(0, 3).map((s) => (
                  <div key={s.value} className="flex justify-between text-text-muted">
                    <span className={cn(
                      Number(s.value) >= 500 ? 'text-bad' :
                      Number(s.value) >= 400 ? 'text-warn' : 'text-text-muted',
                    )}>{s.value}</span>
                    <span>{s.count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="text-text-faint uppercase tracking-[0.05em] text-[9.5px] mb-1">Top models</div>
                {hoverBreakdown.topModels.slice(0, 3).map((m) => (
                  <div key={m.value} className="flex justify-between text-text-muted gap-2">
                    <span className="truncate">{m.value.split(' / ').pop()}</span>
                    <span className="shrink-0">{m.count.toLocaleString()}</span>
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

// ── Request drawer ────────────────────────────────────────────────────────────
type DrawerTab = 'request' | 'response' | 'trace' | 'raw' | 'error'

interface DrawerProps {
  requestId: string
  visible: boolean
  onClose: () => void
  onPrev: () => void
  onNext: () => void
  hasPrev: boolean
  hasNext: boolean
  position: number
  total: number
}

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

function RequestDrawer({ requestId, visible, onClose, onPrev, onNext, hasPrev, hasNext, position, total }: DrawerProps) {
  // Parent remounts via `key={selectedId}` on row change.
  const [tab, setTab] = useState<DrawerTab>('request')
  // PII mask toggle — masks emails/phones/cards/API keys in the body for
  // display only. Off by default since most users want to see the raw
  // request they're debugging.
  const [maskPiiOn, setMaskPiiOn] = useState(false)
  const { data: req, isLoading, isError } = useRequest(requestId)

  // Close on Escape — matches the dashboard's export-dropdown pattern and
  // is what users expect from any side panel / modal.
  useEffect(() => {
    if (!visible) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [visible, onClose])
  // Display copy of request_body: optionally PII-masked. Raw `req.request_body`
  // is preserved for the Copy buttons (so debuggers can still get unmasked
  // payloads), only the rendered text uses this masked copy.
  const displayBody = useMemo(() => {
    if (!maskPiiOn) return req?.request_body
    return maskPiiDeep(req?.request_body)
  }, [maskPiiOn, req?.request_body])
  const displayResponseBody = useMemo(() => {
    if (!maskPiiOn) return req?.response_body
    return maskPiiDeep(req?.response_body)
  }, [maskPiiOn, req?.response_body])

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
    <aside className={cn(
      'bg-bg-elev flex flex-col overflow-hidden',
      // Mobile (< md): full-screen overlay so the user isn't squeezed by
      // both the table and a 480px panel on the same screen.
      // Desktop (md+): inline 480px side panel that the table layout
      // accounts for via flex shrinkage.
      visible
        ? 'fixed inset-0 z-40 md:static md:z-auto md:w-[480px] md:shrink-0 md:border-l md:border-border border-t border-border'
        : 'hidden md:flex md:w-0 md:shrink-0',
      'transition-[width] duration-200 ease-out',
    )}>
      {/* Header */}
      <div className="px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2 mb-2.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">Request</span>
          {position > 0 && (
            <span className="font-mono text-[10px] text-text-faint">{position} / {total}</span>
          )}
          <span className="flex-1" />
          {requestId && (
            <Link
              href={`/requests/${requestId}`}
              className="font-mono text-[10px] px-1.5 py-0.5 border border-border rounded text-text-muted tracking-[0.04em] uppercase hover:border-border-strong transition-colors"
            >
              Open →
            </Link>
          )}
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
        {isLoading ? (
          <>
            <Skeleton className="h-4 w-48 mb-2" />
            <Skeleton className="h-3.5 w-56" />
          </>
        ) : isError ? (
          <p className="font-mono text-[12px] text-bad">Failed to load request.</p>
        ) : req ? (
          <>
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
          </>
        ) : null}
      </div>

      {/* KV grid */}
      {req && (
        <div className="px-5 py-3.5 border-b border-border grid grid-cols-2 gap-x-3.5 gap-y-3">
          {([
            ['Model', req.model],
            ['Key', req.provider_key_name ?? req.provider],
            ['Status', String(req.status_code)],
            ['Prompt tokens', req.prompt_tokens.toLocaleString()],
            ['Completion', req.completion_tokens.toLocaleString()],
          ] as [string, string][]).map(([k, v]) => (
            <div key={k}>
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-0.5">{k}</div>
              <div className="font-mono text-[12.5px] text-text truncate">{v}</div>
            </div>
          ))}

          {/* User, clickable analytics + filter link */}
          {req.user_id && (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-0.5">User</div>
              <div className="flex items-baseline gap-2">
                <Link
                  href={`/users/${encodeURIComponent(req.user_id)}`}
                  className="font-mono text-[12.5px] text-text hover:underline truncate"
                  title={`View user analytics: ${req.user_id}`}
                >
                  {req.user_id}
                </Link>
                <Link
                  href={`/requests?userId=${encodeURIComponent(req.user_id)}`}
                  className="font-mono text-[10px] text-text-faint hover:text-text shrink-0"
                  title={`Filter requests by user: ${req.user_id}`}
                >
                  filter
                </Link>
              </div>
            </div>
          )}

          {/* Session, clickable filter link */}
          {req.session_id && (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-0.5">Session</div>
              <Link
                href={`/requests?sessionId=${encodeURIComponent(req.session_id)}`}
                className="font-mono text-[12.5px] text-text hover:underline truncate block"
                title={`Filter by session: ${req.session_id}`}
              >
                {req.session_id}
              </Link>
            </div>
          )}

          {/* Trace, link to trace page + copy full ID */}
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-0.5">Trace</div>
            {req.trace_id ? (
              <div className="flex items-center gap-1 min-w-0">
                <Link
                  href={`/traces/${req.trace_id}`}
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

          {/* Span, copy full ID */}
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
      )}

      {/* Metrics row */}
      {req && (
        <div className="px-5 py-3.5 border-b border-border grid grid-cols-3">
          {[
            { label: 'Latency', value: `${req.latency_ms}ms`, sub: '', warn: req.latency_ms > 2000 },
            { label: 'Cost', value: fmtCost(req.cost_usd), sub: '' },
            {
              label: 'Tokens',
              value: req.total_tokens.toLocaleString(),
              sub: (req.cache_read_tokens ?? 0) > 0
                ? `${req.prompt_tokens} in (${(req.cache_read_tokens ?? 0).toLocaleString()} cached) / ${req.completion_tokens} out`
                : `${req.prompt_tokens} in / ${req.completion_tokens} out`,
            },
          ].map((s, i) => (
            <div key={s.label} className={cn('pr-3 pl-3', i === 0 && 'pl-0', i === 2 && 'pr-0', i < 2 && 'border-r border-border')}>
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-1.5">{s.label}</div>
              <div className={cn('text-[20px] font-medium tracking-[-0.3px] leading-none', s.warn ? 'text-accent' : 'text-text')}>
                {s.value}
              </div>
              {s.sub && <div className="font-mono text-[10px] text-text-faint mt-1 tracking-[0.03em]">{s.sub}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      {req && (() => {
        const tabs: DrawerTab[] = ['request', 'response', 'trace', 'raw', ...(req.error_message ? ['error' as DrawerTab] : [])]
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
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-3 w-12 mb-1" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-3 w-8 mb-1 mt-3" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : isError ? (
          <p className="font-mono text-[12px] text-bad">Failed to load request details.</p>
        ) : !req ? null : tab === 'request' ? (
          <div className="space-y-2">
            <div className="flex justify-end">
              {/* Copy always uses the RAW body — the toggle is for on-screen
                  display, not for sanitizing what a developer pastes into
                  their own debugger. */}
              <CopyButton getText={() => JSON.stringify(req.request_body, null, 2)} />
            </div>
            <MessageDisplay messages={messages} body={displayBody} />
          </div>
        ) : tab === 'response' ? (
          req.response_body == null ? (
            <p className="font-mono text-[11.5px] text-text-faint leading-relaxed">
              Response body is not stored, the proxy streams the response directly to your application without buffering it.<br /><br />
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
    </aside>
  )
}

// ── Trace tab: link to full trace + inline span preview if available ──────────
function TraceTab({ traceId }: { traceId: string | null }) {
  const { data: trace, isLoading } = useTrace(traceId ?? '')

  if (!traceId) {
    return (
      <p className="font-mono text-[11.5px] text-text-faint">
        This request is not attached to a trace. Add <code className="text-text">X-Trace-Id</code> header
        (or use the Spanlens SDK&apos;s <code className="text-text">withTrace()</code>) to group requests into agent traces.
      </p>
    )
  }

  if (isLoading) return <Skeleton className="h-20 w-full" />
  if (!trace) {
    return <p className="font-mono text-[11.5px] text-text-faint">Trace not found (deleted or not yet ingested).</p>
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10.5px] text-text-faint uppercase tracking-[0.05em]">
          Trace · {trace.span_count} span{trace.span_count === 1 ? '' : 's'}
        </div>
        <Link
          href={`/traces/${traceId}`}
          className="font-mono text-[11px] text-accent hover:opacity-80 transition-opacity"
        >
          Open full trace →
        </Link>
      </div>
      <div className="rounded border border-border divide-y divide-border bg-bg-elev">
        {trace.spans.slice(0, 8).map((s) => (
          <div key={s.id} className="px-3 py-2 flex items-center gap-3">
            <span className={cn(
              'font-mono text-[9px] px-1.5 py-0.5 rounded border uppercase tracking-[0.04em] shrink-0',
              s.span_type === 'llm' ? 'text-accent border-accent-border bg-accent-bg'
                : s.span_type === 'tool' ? 'text-text border-border'
                : 'text-text-muted border-border',
            )}>
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

// ── Raw tab: full request + response bodies as JSON ───────────────────────────
function RawTab({
  req,
  displayRequestBody,
  displayResponseBody,
}: {
  req: RequestDetail
  // Pre-masked copies when the drawer's "Mask PII" toggle is on. Copy buttons
  // still use the raw bodies from `req` so a developer can paste the real
  // payload into their debugger.
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

// ── Message display ───────────────────────────────────────────────────────────

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
          if (b.type === 'tool_result') return `[tool_result]`
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return JSON.stringify(content)
}

function MessageDisplay({ messages, body }: { messages: { role: string; content: unknown }[] | null; body: unknown }) {
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
            <div className={cn(
              'px-3 py-2.5 rounded-[5px] border font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap',
              m.role === 'assistant'
                ? 'bg-bg-elev border-border-strong text-text'
                : 'bg-bg-muted border-border text-text-muted',
            )}>
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

// ── Requests table ────────────────────────────────────────────────────────────
const COL_FULL = '20px 1.6fr 0.9fr 0.75fr 0.7fr 0.8fr 0.6fr 0.5fr'
const COL_NARROW = '20px 1.6fr 0.75fr 0.7fr 0.8fr 0.6fr 0.5fr'

function SortBtn({ field, label, sortField, sortDir, onSort }: {
  field: SortField; label: string
  sortField: SortField; sortDir: SortDir; onSort: (f: SortField) => void
}) {
  const active = sortField === field
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={cn('inline-flex items-center gap-0.5 hover:text-text transition-colors', active ? 'text-text' : '')}
    >
      {label}
      <span className="ml-0.5 opacity-60">{active ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}</span>
    </button>
  )
}

function RequestsTable({
  rows,
  isLoading,
  selectedId,
  onSelect,
  drawerOpen,
  sortField,
  sortDir,
  onSort,
  hasActiveFilters,
}: {
  rows: RequestRow[]
  isLoading: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  drawerOpen: boolean
  sortField: SortField
  sortDir: SortDir
  onSort: (f: SortField) => void
  hasActiveFilters: boolean
}) {
  const cols = drawerOpen ? COL_NARROW : COL_FULL

  // Keyboard navigation: ↑/↓ move the selected row, Enter opens the drawer
  // for the selected row (which it already is via row click, but Enter
  // matches list-widget conventions). We bind on the table container only
  // when a row is selected so we don't steal global Escape from other UI.
  function handleKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return
    if (rows.length === 0) return
    const idx = selectedId ? rows.findIndex((r) => r.id === selectedId) : -1
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = idx < 0 ? 0 : Math.min(rows.length - 1, idx + 1)
      const row = rows[next]
      if (row) onSelect(row.id)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const next = idx <= 0 ? 0 : idx - 1
      const row = rows[next]
      if (row) onSelect(row.id)
    } else if (e.key === 'Enter') {
      // No-op when nothing is selected; otherwise toggling via Enter feels
      // surprising, so we only re-emit the selection (parent treats same id
      // as a no-op toggle into-out, so we skip).
    }
  }

  return (
    <div
      className="overflow-auto flex-1 min-h-0 focus:outline-none"
      tabIndex={0}
      onKeyDown={handleKey}
      // Visually hide the focus ring on the scroller — keyboard nav is
      // discoverable via the highlighted row instead.
      role="grid"
      aria-label="Requests table"
    >
      <div className="min-w-[700px]">
      {/* Header */}
      <div
        className="grid px-[22px] py-2.5 font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint border-b border-border bg-bg-muted sticky top-0 z-10"
        style={{ gridTemplateColumns: cols }}
      >
        <span />
        <span>Model</span>
        {!drawerOpen && <span>Key</span>}
        <SortBtn field="latency_ms" label="Latency" sortField={sortField} sortDir={sortDir} onSort={onSort} />
        <SortBtn field="total_tokens" label="Tokens" sortField={sortField} sortDir={sortDir} onSort={onSort} />
        <SortBtn field="cost_usd" label="Cost" sortField={sortField} sortDir={sortDir} onSort={onSort} />
        <span>Status</span>
        <span className="flex justify-end">
          <SortBtn field="created_at" label="Age" sortField={sortField} sortDir={sortDir} onSort={onSort} />
        </span>
      </div>

      {isLoading
        ? Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="grid px-[22px] py-2.5 border-b border-border" style={{ gridTemplateColumns: cols }}>
              <span />
              <Skeleton className="h-4 w-32" />
              {!drawerOpen && <Skeleton className="h-4 w-20" />}
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-4 w-8" />
              <Skeleton className="h-4 w-8 ml-auto" />
            </div>
          ))
        : rows.length === 0
          ? (
            <div className="py-12 font-mono text-[12.5px] text-text-faint flex flex-col items-center gap-3 text-center px-4">
              {hasActiveFilters ? (
                <span>No requests match the current filters.</span>
              ) : (
                <EmptyRequestsHint />
              )}
            </div>
          )
          : rows.map((req) => {
              const isErr = req.status_code >= 400
              const isSelected = req.id === selectedId
              return (
                <div
                  // data-testid is the stable hook the R-3 smoke test
                  // (apps/web/__e2e__/smoke.spec.ts) waits on after
                  // running a proxy call. Cosmetic className changes
                  // would otherwise break the spec.
                  data-testid="request-row"
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
                  style={{ gridTemplateColumns: cols, paddingLeft: isSelected ? 20 : 22 }}
                >
                  <span className="flex items-center">
                    <span
                      className="inline-block w-2 h-2 rounded-full shrink-0"
                      style={{ background: providerDotColor(req.provider) }}
                      title={req.provider}
                      aria-label={`provider ${req.provider}`}
                    />
                  </span>
                  <span className="text-text truncate pr-2 flex items-center gap-1.5">
                    <span className="truncate">{req.model}</span>
                    {req.truncated && (
                      <span
                        className="shrink-0 px-1.5 py-px text-[10px] uppercase tracking-wide rounded bg-accent/10 text-accent border border-accent/30"
                        title="Stream closed early, request approached the Spanlens proxy deadline"
                      >
                        truncated
                      </span>
                    )}
                  </span>
                  {!drawerOpen && <span className="text-text-muted">{req.provider_key_name ?? req.provider}</span>}
                  {/* Slow rows draw the eye even when they returned 200 — a
                      9-second OK request often points at a model/prompt
                      problem worth investigating. Tiered colors via latencyClass. */}
                  <span className={latencyClass(req.latency_ms, isErr)}>{req.latency_ms}ms</span>
                  <span className="text-text-muted">{req.total_tokens.toLocaleString()}</span>
                  <span className="text-text">{fmtCost(req.cost_usd)}</span>
                  <span>
                    <span
                      className={cn(
                        'inline-flex items-center justify-center font-mono text-[10.5px] px-1.5 py-px rounded-[3px] border tabular-nums',
                        statusPillClass(req.status_code),
                      )}
                    >
                      {req.status_code}
                    </span>
                  </span>
                  <span
                    className="text-text-faint text-right"
                    title={formatDateTime(req.created_at)}
                    suppressHydrationWarning
                  >{relAge(req.created_at)}</span>
                </div>
              )
            })}
      </div>{/* end min-w-[700px] */}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function RequestsClient() {
  const searchParams = useSearchParams()
  const router = useRouter()

  // Derive filter state from URL — makes links shareable and browser back/forward work
  const provider = searchParams.get('provider') ?? 'all'
  const status = (searchParams.get('status') ?? 'all') as StatusFilter
  const providerKeyId = searchParams.get('providerKeyId') ?? 'all'
  const sortField = (searchParams.get('sortBy') ?? 'created_at') as SortField
  const sortDir = (searchParams.get('sortDir') ?? 'desc') as SortDir
  const timeRange = (searchParams.get('timeRange') ?? 'all') as TimeRange

  // Reconstruct the UiFilters struct consumed by serverFilters / UI
  const filters: UiFilters = useMemo(() => ({
    provider,
    status,
    model: searchParams.get('model') ?? '',
    providerKeyId,
  }), [provider, status, providerKeyId, searchParams])

  // model input stays local for debounce; synced to URL 300ms after last keystroke
  const [modelInput, setModelInput] = useState(() => searchParams.get('model') ?? '')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pendingNavigation, setPendingNavigation] = useState<'first' | 'last' | null>(null)

  // Capture "now" once at mount — time-range filters anchor to load time.
  const [mountNow] = useState(() => Date.now())

  // Ref so the debounce effect always reads the latest searchParams without re-firing
  const searchParamsRef = useRef(searchParams)
  useEffect(() => { searchParamsRef.current = searchParams }, [searchParams])

  // Merge updates into the current URL params and replace without scroll
  function pushParams(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParamsRef.current.toString())
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') params.delete(key)
      else params.set(key, val)
    }
    router.replace(`/requests?${params.toString()}`, { scroll: false })
  }

  // Most filter handlers do the same three things: push URL params, reset
  // pagination to page 1, and clear the row selection. Wrapping them keeps
  // each handler honest about what it's actually changing.
  const applyFilter = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParamsRef.current.toString())
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') params.delete(key)
      else params.set(key, val)
    }
    router.replace(`/requests?${params.toString()}`, { scroll: false })
    setPage(1)
    setSelectedId(null)
  }, [router])

  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams(searchParamsRef.current.toString())
      if (modelInput.trim()) params.set('model', modelInput.trim())
      else params.delete('model')
      router.replace(`/requests?${params.toString()}`, { scroll: false })
      setPage(1)
      setSelectedId(null)
    }, 300)
    return () => clearTimeout(t)
  // router is stable; searchParamsRef is a ref — neither needs to be a dep
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelInput])

  const fromIso = useMemo(() => {
    if (timeRange === 'today') {
      const d = new Date(mountNow)
      d.setUTCHours(0, 0, 0, 0)
      return d.toISOString()
    }
    if (timeRange === '7d') return new Date(mountNow - 7 * 24 * 3_600_000).toISOString()
    if (timeRange === '30d') return new Date(mountNow - 30 * 24 * 3_600_000).toISOString()
    return undefined
  }, [timeRange, mountNow])

  const promptVersionId = searchParams.get('promptVersionId') ?? undefined
  const userIdFilter = searchParams.get('userId') ?? undefined
  const sessionIdFilter = searchParams.get('sessionId') ?? undefined

  const serverFilters = useMemo(
    () => ({
      page,
      limit: 50,
      ...(filters.provider !== 'all' && { provider: filters.provider }),
      ...(filters.model.trim() && { model: filters.model.trim() }),
      ...(filters.providerKeyId !== 'all' && { providerKeyId: filters.providerKeyId }),
      ...(filters.status !== 'all' && { status: filters.status }),
      ...(fromIso && { from: fromIso }),
      ...(sortField !== 'created_at' && { sortBy: sortField }),
      ...(sortDir !== 'desc' && { sortDir }),
      ...(promptVersionId && { promptVersionId }),
      ...(userIdFilter && { userId: userIdFilter }),
      ...(sessionIdFilter && { sessionId: sessionIdFilter }),
    }),
    [page, filters.provider, filters.model, filters.providerKeyId, filters.status, fromIso, sortField, sortDir, promptVersionId, userIdFilter, sessionIdFilter],
  )

  const { data, isLoading, isFetching, refetch } = useRequests(serverFilters)
  const providerKeysQuery = useProviderKeys()

  // Filter dropdown: lets the user narrow requests to a specific provider key.
  // Under the unified-keys model the row is tagged with provider_key_id at
  // proxy time, so filtering by provider_keys.id is the right pivot.
  const visibleKeys = useMemo(() => {
    const keys = providerKeysQuery.data ?? []
    if (filters.provider === 'all') return keys
    return keys.filter((k) => k.provider === filters.provider)
  }, [providerKeysQuery.data, filters.provider])

  // Only show provider options the user actually has keys for. If they've
  // never set up an Anthropic key, the dropdown shouldn't tease an
  // Anthropic option that returns zero results when clicked. The fallback
  // to the four canonical providers handles the moment between page mount
  // and the first useProviderKeys response — better than an empty list.
  const availableProviders = useMemo<string[]>(() => {
    const keys = providerKeysQuery.data ?? []
    if (keys.length === 0) return ['openai', 'anthropic', 'gemini', 'azure']
    return Array.from(new Set(keys.map((k) => k.provider))).sort()
  }, [providerKeysQuery.data])

  const requests = useMemo(() => data?.data ?? [], [data])
  const meta = data?.meta ?? { total: 0, page: 1, limit: 50 }

  // After a cross-page navigation, select the first or last item once the new page loads.
  // We track the desired target with `pendingNavigation` and consume it here when data
  // arrives. The set-state-in-effect rule flags this, but the underlying need ("react
  // to an external async event") is exactly what an effect is for, and there is no
  // synchronous derivation path because requests data lands via useQuery.
  useEffect(() => {
    if (!pendingNavigation || isLoading || requests.length === 0) return
    const target = pendingNavigation === 'first' ? requests[0] : requests[requests.length - 1]
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data arrival, no derived-state path
    if (target) setSelectedId(target.id)
    setPendingNavigation(null)
  }, [pendingNavigation, isLoading, requests])

  const hasActiveFilters =
    filters.provider !== 'all' ||
    filters.status !== 'all' ||
    filters.model.trim() !== '' ||
    filters.providerKeyId !== 'all' ||
    timeRange !== 'all'

  // The current filter set as bare URL params — what a "saved view" stores.
  // Only non-default values are included so equality with a saved view is exact.
  const currentSaveParams = useMemo<SavedFilterParams>(() => {
    const p: SavedFilterParams = {}
    if (provider !== 'all') p.provider = provider
    if (status !== 'all') p.status = status
    if (filters.model.trim()) p.model = filters.model.trim()
    if (providerKeyId !== 'all') p.providerKeyId = providerKeyId
    if (timeRange !== 'all') p.timeRange = timeRange
    if (sortField !== 'created_at') p.sortBy = sortField
    if (sortDir !== 'desc') p.sortDir = sortDir
    if (promptVersionId) p.promptVersionId = promptVersionId
    if (userIdFilter) p.userId = userIdFilter
    if (sessionIdFilter) p.sessionId = sessionIdFilter
    return p
  }, [provider, status, filters.model, providerKeyId, timeRange, sortField, sortDir, promptVersionId, userIdFilter, sessionIdFilter])

  // Apply a saved view: replace the URL with exactly its params (dropping
  // pagination + any stale filter), and re-sync the debounced model input.
  const applySavedView = useCallback((params: SavedFilterParams) => {
    const sp = new URLSearchParams(params)
    router.replace(`/requests?${sp.toString()}`, { scroll: false })
    setModelInput(params.model ?? '')
    setPage(1)
    setSelectedId(null)
  }, [router])

  function handleSort(field: SortField) {
    const newDir = sortField === field ? (sortDir === 'desc' ? 'asc' : 'desc') : 'desc'
    applyFilter({
      sortBy: field === 'created_at' ? null : field,
      sortDir: newDir === 'desc' ? null : newDir,
    })
  }

  // Pagination math, shared between the bottom pager and the count chip.
  const totalPages = Math.max(1, Math.ceil(meta.total / meta.limit))
  const currentPage = meta.page

  const drawerOpen = selectedId !== null
  const selectedIdx = selectedId ? requests.findIndex((r) => r.id === selectedId) : -1

  function handleSelect(id: string) {
    setSelectedId((prev) => (prev === id ? null : id))
  }

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col md:flex-row min-h-screen">
      <div className="flex flex-col flex-1 min-w-0">
      {/* Sticky topbar — same pattern as the dashboard. Body scrolls
          natively while the page header and crumb stay visible. */}
      <div className="sticky top-0 z-20 bg-bg flex items-center justify-between">
        <Topbar
          crumbs={[{ label: 'Requests' }]}
          right={null}
        />
        {/* Visually-hidden h1 — gives the page a heading for a11y/SEO
            without changing the existing Topbar layout. */}
        <h1 className="sr-only">Requests</h1>
      </div>

      <StatStrip timeRange={timeRange} fromIso={fromIso} />
      <TrafficBars timeRange={timeRange} fromIso={fromIso} />

      {/* Active URL filter banner, shown when ?promptVersionId / ?userId / ?sessionId
         is present in the URL. Click × to clear and return to unfiltered view. */}
      {(promptVersionId || userIdFilter || sessionIdFilter) && (
        <div className="flex items-center gap-2 px-[22px] py-[8px] bg-accent-bg border-b border-accent-border font-mono text-[11px] flex-wrap">
          <span className="text-text-faint uppercase tracking-[0.05em] text-[10px]">Filter:</span>
          {promptVersionId && (
            <span className="px-2 py-[2px] bg-bg border border-border rounded-[3px] text-text">
              prompt version {promptVersionId.slice(0, 8)}…
            </span>
          )}
          {userIdFilter && (
            <span className="px-2 py-[2px] bg-bg border border-border rounded-[3px] text-text">
              user: {userIdFilter}
            </span>
          )}
          {sessionIdFilter && (
            <span className="px-2 py-[2px] bg-bg border border-border rounded-[3px] text-text">
              session: {sessionIdFilter}
            </span>
          )}
          <Link
            href="/requests"
            className="ml-auto text-text-faint hover:text-text text-[11px]"
            aria-label="Clear URL filters"
          >
            Clear ×
          </Link>
        </div>
      )}

      {/* Filter row */}
      <div className="flex items-center gap-1.5 px-[22px] py-[10px] border-b border-border shrink-0 flex-wrap">
        {/* Time range */}
        <div className="flex border border-border rounded-[5px] overflow-hidden bg-bg-elev font-mono text-[10.5px] tracking-[0.03em] shrink-0">
          {(['all', 'today', '7d', '30d'] as TimeRange[]).map((r) => (
            <button
              key={r}
              onClick={() => applyFilter({ timeRange: r === 'all' ? null : r })}
              className={cn(
                'px-[10px] py-[5px]',
                timeRange === r ? 'bg-text text-bg' : 'text-text-muted hover:text-text transition-colors',
              )}
            >
              {r === 'all' ? 'All time' : r === 'today' ? 'Today' : r}
            </button>
          ))}
        </div>

        {/* Segmented status */}
        <div className="flex border border-border rounded-[5px] overflow-hidden bg-bg-elev font-mono text-[10.5px] tracking-[0.03em] shrink-0">
          {(['all', 'ok', '4xx', '5xx'] as StatusFilter[]).map((v) => (
            <button
              key={v}
              onClick={() => applyFilter({ status: v === 'all' ? null : v })}
              className={cn(
                'px-[10px] py-[5px] inline-flex items-center gap-1.5',
                filters.status === v ? 'bg-text text-bg' : 'text-text-muted hover:text-text transition-colors',
              )}
            >
              {STATUS_LABELS[v]}
              {filters.status === v && (
                <span className="opacity-60 text-bg">{meta.total.toLocaleString()}</span>
              )}
            </button>
          ))}
        </div>

        {/* Provider select — only options the user actually has keys for.
            `min-w-[130px]` keeps the trigger (and therefore the dropdown
            panel, which inherits trigger width via Radix's
            --radix-select-trigger-width var) wide enough for "All providers"
            to render on a single line regardless of the current value. */}
        <Select value={filters.provider} onValueChange={(v) => applyFilter({ provider: v === 'all' ? null : v, providerKeyId: null })}>
          <SelectTrigger className="w-auto min-w-[150px] h-auto py-[5px] text-[11px] text-text-muted rounded-[5px] hover:border-border-strong transition-colors">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All providers</SelectItem>
            {availableProviders.map((p) => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Model input, debounced, applies 300ms after last keystroke.
            Wider than before so dated model names like
            `gpt-4o-mini-2024-07-18` are visible while typing. */}
        <input
          type="text"
          placeholder="Model…"
          value={modelInput}
          onChange={(e) => setModelInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setModelInput('') }
          }}
          className="font-mono text-[11px] border border-border rounded-[5px] px-2 py-[5px] bg-bg text-text-muted hover:border-border-strong focus:border-border-strong transition-colors outline-none w-44 placeholder:text-text-faint"
        />

        {/* Key select — same min-width treatment as the provider select so
            the dropdown panel doesn't wrap "All keys" / long key names
            when the current selection happens to be short. */}
        {visibleKeys.length > 0 && (
          <div className="max-w-[180px]">
            <Select value={filters.providerKeyId} onValueChange={(v) => applyFilter({ providerKeyId: v === 'all' ? null : v })}>
              <SelectTrigger className="w-auto min-w-[110px] h-auto py-[5px] text-[11px] text-text-muted rounded-[5px] hover:border-border-strong transition-colors">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All keys</SelectItem>
                {visibleKeys.map((k) => (
                  <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {hasActiveFilters && (
          <button
            onClick={() => {
              setModelInput('')
              applyFilter({ provider: null, status: null, model: null, providerKeyId: null, timeRange: null, sortBy: null, sortDir: null })
            }}
            className="font-mono text-[10.5px] px-[9px] py-[5px] border border-border rounded-[5px] text-text-faint hover:text-text hover:border-border-strong transition-colors shrink-0"
          >
            Clear filters
          </button>
        )}

        <span className="flex-1" />
        {/* Refetch button with spinning indicator while a fetch is in flight. */}
        <button
          type="button"
          onClick={() => { void refetch() }}
          disabled={isFetching}
          aria-label="Refetch requests"
          className="font-mono text-[10.5px] px-[9px] py-[4px] border border-border rounded-[5px] text-text-muted hover:text-text hover:border-border-strong disabled:opacity-40 transition-colors inline-flex items-center"
        >
          <span className={cn('inline-block', isFetching && 'animate-spin')}>↻</span>
        </button>
        <ExportDropdown
          filename="spanlens-requests"
          buildUrl={(fmt) => {
            const params = new URLSearchParams({ format: fmt })
            if (filters.provider !== 'all') params.set('provider', filters.provider)
            if (filters.model.trim())       params.set('model', filters.model.trim())
            if (filters.providerKeyId !== 'all') params.set('providerKeyId', filters.providerKeyId)
            if (filters.status !== 'all')   params.set('status', filters.status)
            if (fromIso)                    params.set('from', fromIso)
            return `/api/v1/exports/requests?${params.toString()}`
          }}
        />
      </div>

      {/* Saved views — name the current filter combo, one-click back into it. */}
      <SavedViewsBar
        current={currentSaveParams}
        onApply={applySavedView}
        canSave={Object.keys(currentSaveParams).length > 0}
      />

      {/* Table + pagination */}
      <div className="flex flex-col flex-1">
          <ErrorBoundary label="requests:table">
            <RequestsTable
              rows={requests}
              isLoading={isLoading}
              selectedId={selectedId}
              onSelect={handleSelect}
              drawerOpen={drawerOpen}
              sortField={sortField}
              sortDir={sortDir}
              onSort={handleSort}
              hasActiveFilters={hasActiveFilters}
            />
          </ErrorBoundary>

          {/* Pagination — single source of truth for "where am I in the
              list", with First/Last jump for big result sets. */}
          <div className="flex items-center justify-between px-[22px] py-3 border-t border-border shrink-0 gap-3 flex-wrap">
            <span className="font-mono text-[11px] text-text-faint">
              {isFetching
                ? 'Loading…'
                : `Page ${currentPage} of ${totalPages.toLocaleString()} · ${requests.length} / ${meta.total.toLocaleString()} total`}
            </span>
            <div className="flex gap-1.5">
              <button
                disabled={currentPage <= 1 || isFetching}
                onClick={() => { setPage(1); setSelectedId(null) }}
                className="font-mono text-[11px] px-2.5 py-1 border border-border rounded text-text-muted disabled:opacity-30 hover:border-border-strong transition-colors"
                aria-label="First page"
              >
                « First
              </button>
              <button
                disabled={page <= 1 || isFetching}
                onClick={() => { setPage((p) => Math.max(1, p - 1)); setSelectedId(null) }}
                className="font-mono text-[11px] px-2.5 py-1 border border-border rounded text-text-muted disabled:opacity-30 hover:border-border-strong transition-colors"
              >
                ← Prev
              </button>
              <button
                disabled={page * meta.limit >= meta.total || isFetching}
                onClick={() => { setPage((p) => p + 1); setSelectedId(null) }}
                className="font-mono text-[11px] px-2.5 py-1 border border-border rounded text-text-muted disabled:opacity-30 hover:border-border-strong transition-colors"
              >
                Next →
              </button>
              <button
                disabled={currentPage >= totalPages || isFetching}
                onClick={() => { setPage(totalPages); setSelectedId(null) }}
                className="font-mono text-[11px] px-2.5 py-1 border border-border rounded text-text-muted disabled:opacity-30 hover:border-border-strong transition-colors"
                aria-label="Last page"
              >
                Last »
              </button>
            </div>
          </div>
        </div>
      </div>{/* end left column */}

      <RequestDrawer
        // key={selectedId} remounts the drawer on row change so internal
        // tab state resets without a setState-in-effect.
        key={selectedId ?? '__none__'}
        requestId={selectedId ?? ''}
        visible={drawerOpen && !!selectedId}
        onClose={() => setSelectedId(null)}
        onPrev={() => {
          if (selectedIdx > 0) {
            setSelectedId(requests[selectedIdx - 1]?.id ?? null)
          } else if (page > 1) {
            setPendingNavigation('last')
            setPage((p) => p - 1)
            setSelectedId(null)
          }
        }}
        onNext={() => {
          if (selectedIdx < requests.length - 1) {
            setSelectedId(requests[selectedIdx + 1]?.id ?? null)
          } else if (page * meta.limit < meta.total) {
            setPendingNavigation('first')
            setPage((p) => p + 1)
            setSelectedId(null)
          }
        }}
        hasPrev={selectedIdx > 0 || page > 1}
        hasNext={selectedIdx < requests.length - 1 || page * meta.limit < meta.total}
        position={selectedIdx + 1}
        total={requests.length}
      />
    </div>
  )
}
