'use client'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Star, X } from 'lucide-react'
import { ExportDropdown } from '@/components/ui/export-dropdown'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Topbar, LiveDot } from '@/components/layout/topbar'
import {
  useRequests,
  useRequest,
  useSavedFilters,
  useCreateSavedFilter,
  useDeleteSavedFilter,
  type SavedFilter,
} from '@/lib/queries/use-requests'
import { useProviderKeys } from '@/lib/queries/use-provider-keys'
import { useTrace } from '@/lib/queries/use-traces'
import { useStatsOverview, useStatsTimeseries } from '@/lib/queries/use-stats'
import { useAnomalies } from '@/lib/queries/use-anomalies'
import type { RequestRow, RequestDetail } from '@/lib/queries/types'

type StatusFilter = 'all' | 'ok' | '4xx' | '5xx'

interface UiFilters {
  provider: string
  status: StatusFilter
  model: string
  providerKeyId: string
}

const DEFAULT_FILTERS: UiFilters = { provider: 'all', status: 'all', model: '', providerKeyId: 'all' }

function relAge(dateStr: string): string {
  const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h`
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

function InlineSpark({ values, w = 120, h = 18, stroke = 'var(--border-strong)' }: { values: number[]; w?: number; h?: number; stroke?: string }) {
  const path = sparkPath(values, w, h)
  if (!path) return null
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block w-full">
      <path d={path} stroke={stroke} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ── Stat strip ────────────────────────────────────────────────────────────────
function StatStrip() {
  const overview = useStatsOverview()
  const timeseries = useStatsTimeseries()
  const anomalies = useAnomalies()

  const o = overview.data
  const ts = timeseries.data ?? []
  const sparkReqs = ts.slice(-10).map((d) => d.requests)
  const sparkCost = ts.slice(-10).map((d) => d.cost)
  const sparkErrors = ts.slice(-10).map((d) => d.errors)

  const errorRatePct = o && o.totalRequests > 0 ? (o.errorRequests / o.totalRequests) * 100 : 0
  const errorRateStr = errorRatePct.toFixed(1) + '%'
  const anomalyCount = (anomalies.data?.data ?? []).length

  const stats = [
    { label: 'Requests · 24h', value: o ? o.totalRequests.toLocaleString() : '—', spark: sparkReqs, warn: false, good: false },
    { label: 'Avg latency', value: o ? `${o.avgLatencyMs}ms` : '—', spark: [], warn: o ? o.avgLatencyMs > 1000 : false, good: false },
    { label: 'Spend · 24h', value: o ? '$' + o.totalCostUsd.toFixed(2) : '—', spark: sparkCost, warn: false, good: true },
    { label: 'Error rate', value: errorRateStr, spark: sparkErrors, warn: errorRatePct > 1, good: false },
    { label: 'Anomalies', value: anomalyCount.toString(), spark: [], warn: anomalyCount > 0, good: false },
  ]

  if (overview.isLoading) {
    return (
      <div className="grid grid-cols-5 border-b border-border shrink-0">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className={cn('px-[18px] py-[14px]', i < 4 && 'border-r border-border')}>
            <Skeleton className="h-2.5 w-20 mb-2" />
            <Skeleton className="h-7 w-24 mb-1.5" />
            <Skeleton className="h-[18px] w-full" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-5 border-b border-border shrink-0">
      {stats.map((s, i) => (
        <div key={i} className={cn('px-[18px] py-[14px]', i < 4 && 'border-r border-border')}>
          <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">{s.label}</div>
          <div className={cn('text-[24px] font-medium tracking-[-0.6px] leading-none mb-1.5', s.warn ? 'text-accent' : 'text-text')}>
            {s.value}
          </div>
          <InlineSpark
            values={s.spark}
            stroke={s.warn ? 'var(--accent)' : s.good ? 'var(--good)' : 'var(--border-strong)'}
          />
        </div>
      ))}
    </div>
  )
}

// ── Traffic bars ──────────────────────────────────────────────────────────────
function TrafficBars() {
  const timeseries = useStatsTimeseries()
  const rawTs = timeseries.data

  const bars = useMemo(() => {
    const ts = rawTs ?? []
    if (!ts.length) return Array.from({ length: 30 }).map(() => ({ h: 8, color: 'var(--border-strong)' }))
    const maxReq = Math.max(...ts.map((d) => d.requests), 1)
    return ts.slice(-30).map((d) => {
      const h = Math.max(4, (d.requests / maxReq) * 68)
      const color = d.errors > 0 ? 'var(--bad)' : 'var(--border-strong)'
      return { h, color }
    })
  }, [rawTs])

  const labels = useMemo(() => {
    const pts = (rawTs ?? []).slice(-30)
    const first = pts[0]
    if (!pts.length || !first) return ['—', '—', '—', '—', 'NOW']
    const fmt = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    return [
      fmt(first.date),
      fmt((pts[Math.floor(pts.length * 0.25)] ?? first).date),
      fmt((pts[Math.floor(pts.length * 0.5)] ?? first).date),
      fmt((pts[Math.floor(pts.length * 0.75)] ?? first).date),
      'NOW',
    ]
  }, [rawTs])

  return (
    <div className="px-[22px] py-[14px] border-b border-border shrink-0">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-[13.5px] font-medium">Traffic</span>
          <div className="flex gap-3 font-mono text-[10.5px] text-text-muted tracking-[0.03em]">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-border-strong inline-block" /> OK
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-bad inline-block" /> ERROR
            </span>
          </div>
        </div>
        <div className="font-mono text-[10.5px] text-text-faint tracking-[0.03em]">last 30d</div>
      </div>
      <div className="flex items-end gap-[2px] h-[72px]">
        {bars.map((b, i) => (
          <div
            key={i}
            className="flex-1 rounded-[1px]"
            style={{ height: b.h, background: b.color }}
          />
        ))}
      </div>
      <div className="flex justify-between font-mono text-[10px] text-text-faint tracking-[0.04em] mt-2">
        {labels.map((l, i) => <span key={i}>{l}</span>)}
      </div>
    </div>
  )
}

// ── Filter pill ───────────────────────────────────────────────────────────────
function FilterPill({ children, active, warn, onClick }: { children: React.ReactNode; active?: boolean; warn?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-[9px] py-1 rounded-[5px] font-mono text-[11px] tracking-[0.03em] whitespace-nowrap',
        warn ? 'border border-accent-border bg-accent-bg text-accent'
          : active ? 'border border-border-strong bg-bg-elev text-text'
          : 'border border-border text-text-muted hover:border-border-strong hover:text-text transition-colors',
      )}
    >
      {children}
    </button>
  )
}

// ── Request drawer ────────────────────────────────────────────────────────────
type DrawerTab = 'request' | 'response' | 'trace' | 'raw'

interface DrawerProps {
  requestId: string
  visible: boolean
  onClose: () => void
  onPrev: () => void
  onNext: () => void
  hasPrev: boolean
  hasNext: boolean
}

function RequestDrawer({ requestId, visible, onClose, onPrev, onNext, hasPrev, hasNext }: DrawerProps) {
  const [tab, setTab] = useState<DrawerTab>('request')
  const { data: req, isLoading } = useRequest(requestId)
  const messages = useMemo(() => {
    if (!req?.request_body || typeof req.request_body !== 'object') return null
    const body = req.request_body as Record<string, unknown>
    if (!Array.isArray(body.messages)) return null
    return (body.messages as unknown[]).filter(
      (m): m is { role: string; content: string } =>
        typeof m === 'object' && m !== null && typeof (m as { role?: unknown }).role === 'string',
    )
  }, [req?.request_body])
  if (!visible) return null

  return (
    <aside className="w-[440px] shrink-0 border-l border-border bg-bg-elev overflow-auto flex flex-col">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2 mb-2.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">Request</span>
          <span className="flex-1" />
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
        ) : req ? (
          <>
            <div className="font-mono text-[13px] text-text mb-1 truncate">{req.id}</div>
            <div className="flex items-center gap-2 text-[12px] text-text-muted">
              <span>{new Date(req.created_at).toLocaleString()}</span>
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
          {[
            ['Model', req.model],
            ['Provider', req.provider],
            ['Status', String(req.status_code)],
            ['Key', req.provider_key_name ?? '—'],
            ['Prompt tokens', req.prompt_tokens.toLocaleString()],
            ['Completion', req.completion_tokens.toLocaleString()],
            ['Trace', req.trace_id ? req.trace_id.slice(0, 12) + '…' : '—'],
            ['Span', req.span_id ? req.span_id.slice(0, 12) + '…' : '—'],
          ].map(([k, v]) => (
            <div key={k}>
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-0.5">{k}</div>
              <div className="font-mono text-[12.5px] text-text truncate">{v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Metrics row */}
      {req && (
        <div className="px-5 py-3.5 border-b border-border grid grid-cols-3">
          {[
            { label: 'Latency', value: `${req.latency_ms}ms`, sub: '', warn: req.latency_ms > 2000 },
            { label: 'Cost', value: fmtCost(req.cost_usd), sub: '' },
            { label: 'Tokens', value: req.total_tokens.toLocaleString(), sub: `${req.prompt_tokens} in / ${req.completion_tokens} out` },
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
      <div className="flex px-5 border-b border-border gap-5 shrink-0">
        {(['request', 'response', 'trace', 'raw'] as DrawerTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'py-2.5 font-mono text-[11px] uppercase tracking-[0.04em] border-b-[1.5px] -mb-px transition-colors',
              tab === t ? 'text-text border-accent' : 'text-text-muted border-transparent hover:text-text',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="px-5 py-4 flex-1 overflow-auto">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-3 w-12 mb-1" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-3 w-8 mb-1 mt-3" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : !req ? null : tab === 'request' ? (
          <MessageDisplay messages={messages} body={req.request_body} />
        ) : tab === 'response' ? (
          <pre className="font-mono text-[11.5px] text-text-muted leading-relaxed whitespace-pre-wrap break-all">
            {JSON.stringify(req.response_body, null, 2)}
          </pre>
        ) : tab === 'trace' ? (
          <TraceTab traceId={req.trace_id ?? null} />
        ) : (
          <RawTab req={req} />
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
            + {trace.spans.length - 8} more — open the full trace to see them all
          </div>
        )}
      </div>
    </div>
  )
}

// ── Raw tab: full request + response bodies as JSON ───────────────────────────
function RawTab({ req }: { req: RequestDetail }) {
  return (
    <div className="space-y-5">
      <section>
        <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">Request body</div>
        {req.request_body == null ? (
          <p className="font-mono text-[11.5px] text-text-faint">Not captured.</p>
        ) : (
          <pre className="font-mono text-[11.5px] text-text leading-relaxed whitespace-pre-wrap break-all bg-bg-elev border border-border rounded p-3">
            {JSON.stringify(req.request_body, null, 2)}
          </pre>
        )}
      </section>
      <section>
        <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">Response body</div>
        {req.response_body == null ? (
          <p className="font-mono text-[11.5px] text-text-faint">Not captured.</p>
        ) : (
          <pre className="font-mono text-[11.5px] text-text leading-relaxed whitespace-pre-wrap break-all bg-bg-elev border border-border rounded p-3">
            {JSON.stringify(req.response_body, null, 2)}
          </pre>
        )}
      </section>
    </div>
  )
}

// ── Message display ───────────────────────────────────────────────────────────
function MessageDisplay({ messages, body }: { messages: { role: string; content: string }[] | null; body: unknown }) {
  if (messages) {
    return (
      <div className="space-y-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">Messages</div>
        {messages.map((m, i) => (
          <div key={i}>
            <div className="font-mono text-[10px] text-text-faint tracking-[0.04em] mb-1">{m.role}</div>
            <div className={cn(
              'px-3 py-2.5 rounded-[5px] border font-mono text-[11.5px] leading-relaxed',
              m.role === 'assistant'
                ? 'bg-bg-elev border-border-strong text-text'
                : 'bg-bg-muted border-border text-text-muted',
            )}>
              {m.content}
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

function RequestsTable({
  rows,
  isLoading,
  selectedId,
  onSelect,
  drawerOpen,
}: {
  rows: RequestRow[]
  isLoading: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  drawerOpen: boolean
}) {
  const cols = drawerOpen ? COL_NARROW : COL_FULL
  return (
    <div className="overflow-auto flex-1 min-h-0">
      {/* Header */}
      <div
        className="grid px-[22px] py-2.5 font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint border-b border-border bg-bg-muted sticky top-0 z-10"
        style={{ gridTemplateColumns: cols }}
      >
        <span />
        <span>Model</span>
        {!drawerOpen && <span>Provider</span>}
        <span>Latency</span>
        <span>Tokens</span>
        <span>Cost</span>
        <span>Status</span>
        <span className="text-right">Age</span>
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
            <div className="text-center py-12 font-mono text-[12.5px] text-text-faint">
              No requests yet. Make your first API call through the proxy.
            </div>
          )
          : rows.map((req) => {
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
                  style={{ gridTemplateColumns: cols, paddingLeft: isSelected ? 20 : 22 }}
                >
                  <span>
                    {isErr && <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent" />}
                  </span>
                  <span className="text-text truncate pr-2">{req.model}</span>
                  {!drawerOpen && <span className="text-text-muted">{req.provider}</span>}
                  <span className={isErr ? 'text-accent' : 'text-text'}>{req.latency_ms}ms</span>
                  <span className="text-text-muted">{req.total_tokens.toLocaleString()}</span>
                  <span className="text-text">{fmtCost(req.cost_usd)}</span>
                  <span className={isErr ? 'text-bad' : 'text-good'}>{req.status_code}</span>
                  <span className="text-text-faint text-right">{relAge(req.created_at)}</span>
                </div>
              )
            })}
    </div>
  )
}

// ── Save filter dialog ────────────────────────────────────────────────────────
interface SaveFilterDialogProps {
  filters: UiFilters
  onSave: (name: string) => Promise<unknown>
}

function SaveFilterDialog({ filters, onSave }: SaveFilterDialogProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSave(): Promise<void> {
    if (!name.trim()) { setError('Name required'); return }
    setSaving(true)
    setError(null)
    try {
      await onSave(name.trim())
      setName('')
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="inline-flex items-center gap-1.5 px-2 py-1 rounded font-mono text-[11px] text-text-muted hover:text-text border border-border hover:border-border-strong transition-colors">
          <Star className="h-3 w-3" /> Save view
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Save current filter</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="filter-name" className="text-[12.5px] text-text-muted font-medium">Name</label>
            <input
              id="filter-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. prod errors"
              maxLength={80}
              className="w-full h-9 px-3 rounded-[6px] border border-border bg-bg text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors"
            />
          </div>
          <div className="rounded border bg-bg-muted p-3 font-mono text-[11.5px] text-text-muted space-y-1">
            {filters.provider !== 'all' && <div>provider = {filters.provider}</div>}
            {filters.status !== 'all' && <div>status = {filters.status}</div>}
            {filters.model.trim() && <div>model ∋ &quot;{filters.model}&quot;</div>}
            {filters.providerKeyId !== 'all' && <div>key = {filters.providerKeyId}</div>}
          </div>
          {error && <p className="text-[13px] text-bad">{error}</p>}
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="w-full px-4 py-2 rounded bg-text text-bg font-medium text-[13px] hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function RequestsPage() {
  const searchParams = useSearchParams()
  const [filters, setFilters] = useState<UiFilters>(() => {
    // Support deep-linking from Anomalies / etc. — ?provider=openai&model=gpt-4o
    const providerParam = searchParams.get('provider') ?? undefined
    const modelParam = searchParams.get('model') ?? undefined
    return {
      ...DEFAULT_FILTERS,
      ...(providerParam && { provider: providerParam }),
      ...(modelParam && { model: modelParam }),
    }
  })
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const serverFilters = useMemo(
    () => ({
      page,
      limit: 50,
      ...(filters.provider !== 'all' && { provider: filters.provider }),
      ...(filters.model.trim() && { model: filters.model.trim() }),
      ...(filters.providerKeyId !== 'all' && { providerKeyId: filters.providerKeyId }),
    }),
    [page, filters.provider, filters.model, filters.providerKeyId],
  )

  const { data, isLoading, isFetching } = useRequests(serverFilters)
  const savedFiltersQuery = useSavedFilters()
  const createSaved = useCreateSavedFilter()
  const deleteSaved = useDeleteSavedFilter()
  const providerKeysQuery = useProviderKeys()

  const visibleKeys = useMemo(() => {
    const keys = providerKeysQuery.data ?? []
    if (filters.provider === 'all') return keys
    return keys.filter((k) => k.provider === filters.provider)
  }, [providerKeysQuery.data, filters.provider])

  const requests = useMemo(() => {
    const rows = data?.data ?? []
    if (filters.status === 'ok') return rows.filter((r) => r.status_code < 400)
    if (filters.status === '4xx') return rows.filter((r) => r.status_code >= 400 && r.status_code < 500)
    if (filters.status === '5xx') return rows.filter((r) => r.status_code >= 500)
    return rows
  }, [data, filters.status])

  const meta = data?.meta ?? { total: 0, page: 1, limit: 50 }

  const statusCounts = useMemo(() => {
    const all = data?.data ?? []
    return {
      ok: all.filter((r) => r.status_code < 400).length,
      '4xx': all.filter((r) => r.status_code >= 400 && r.status_code < 500).length,
      '5xx': all.filter((r) => r.status_code >= 500).length,
    }
  }, [data])

  function applySavedFilter(sf: SavedFilter): void {
    const f = sf.filters as Partial<UiFilters>
    setFilters({
      provider: typeof f.provider === 'string' ? f.provider : 'all',
      status: (['ok', '4xx', '5xx'].includes(f.status ?? '') ? f.status : 'all') as StatusFilter,
      model: typeof f.model === 'string' ? f.model : '',
      providerKeyId: typeof f.providerKeyId === 'string' ? f.providerKeyId : 'all',
    })
    setPage(1)
  }

  const drawerOpen = selectedId !== null
  const selectedIdx = selectedId ? requests.findIndex((r) => r.id === selectedId) : -1

  function handleSelect(id: string) {
    setSelectedId((prev) => (prev === id ? null : id))
  }

  return (
    <div className="-m-7 flex flex-col h-screen overflow-hidden">
      <Topbar
        crumbs={[{ label: 'Workspace' }, { label: 'Requests' }]}
        right={<LiveDot />}
      />

      <StatStrip />
      <TrafficBars />

      {/* Filter row */}
      <div className="flex items-center gap-1.5 px-[22px] py-[10px] border-b border-border shrink-0 flex-wrap">
        {/* Segmented status */}
        <div className="flex border border-border rounded-[5px] overflow-hidden bg-bg-elev font-mono text-[10.5px] tracking-[0.03em] shrink-0">
          {([['all', 'All', meta.total], ['ok', 'OK', statusCounts.ok], ['4xx', '4xx', statusCounts['4xx']], ['5xx', '5xx', statusCounts['5xx']]] as [StatusFilter, string, number][]).map(([v, label, count]) => (
            <button
              key={v}
              onClick={() => { setFilters((f) => ({ ...f, status: v })); setPage(1) }}
              className={cn(
                'px-[10px] py-[5px] inline-flex items-center gap-1.5',
                filters.status === v ? 'bg-text text-bg' : 'text-text-muted hover:text-text transition-colors',
              )}
            >
              {label}
              <span className={filters.status === v ? 'opacity-60 text-bg' : 'text-text-faint'}>
                {count.toLocaleString()}
              </span>
            </button>
          ))}
        </div>

        {/* Saved views */}
        {(savedFiltersQuery.data ?? []).map((sf) => (
          <span key={sf.id} className="inline-flex items-center gap-1">
            <FilterPill active onClick={() => applySavedFilter(sf)}>
              <Star className="h-2.5 w-2.5 text-accent" /> {sf.name}
            </FilterPill>
            <button
              onClick={() => void deleteSaved.mutateAsync(sf.id)}
              className="text-text-faint hover:text-bad transition-colors"
              aria-label={`Remove ${sf.name}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}

        {/* Provider filter */}
        {filters.provider !== 'all' && (
          <FilterPill active onClick={() => setFilters((f) => ({ ...f, provider: 'all' }))}>
            provider · {filters.provider} <X className="h-2.5 w-2.5" />
          </FilterPill>
        )}

        {/* Model filter */}
        {filters.model.trim() && (
          <FilterPill active onClick={() => setFilters((f) => ({ ...f, model: '' }))}>
            model ∋ {filters.model} <X className="h-2.5 w-2.5" />
          </FilterPill>
        )}

        {/* Key filter */}
        {filters.providerKeyId !== 'all' && (
          <FilterPill active onClick={() => setFilters((f) => ({ ...f, providerKeyId: 'all' }))}>
            key · {visibleKeys.find((k) => k.id === filters.providerKeyId)?.name ?? filters.providerKeyId.slice(0, 8)} <X className="h-2.5 w-2.5" />
          </FilterPill>
        )}

        <span className="flex-1" />
        <span className="font-mono text-[11px] text-text-faint">
          {isFetching ? 'Loading…' : `Showing ${requests.length} of ${meta.total.toLocaleString()}`}
        </span>
        <ExportDropdown
          filename="spanlens-requests"
          buildUrl={(fmt) => {
            const params = new URLSearchParams({ format: fmt })
            if (filters.provider !== 'all') params.set('provider', filters.provider)
            if (filters.model.trim())       params.set('model', filters.model.trim())
            if (filters.providerKeyId !== 'all') params.set('providerKeyId', filters.providerKeyId)
            if (filters.status !== 'all')   params.set('status', filters.status)
            return `/api/v1/exports/requests?${params.toString()}`
          }}
        />
        <SaveFilterDialog
          filters={filters}
          onSave={(name) => createSaved.mutateAsync({ name, filters })}
        />
      </div>

      {/* Table + optional drawer */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-col flex-1 overflow-hidden">
          <RequestsTable
            rows={requests}
            isLoading={isLoading}
            selectedId={selectedId}
            onSelect={handleSelect}
            drawerOpen={drawerOpen}
          />

          {/* Pagination */}
          <div className="flex items-center justify-between px-[22px] py-3 border-t border-border shrink-0">
            <span className="font-mono text-[11px] text-text-faint">
              Page {meta.page} · {meta.total.toLocaleString()} total
            </span>
            <div className="flex gap-1.5">
              <button
                disabled={page <= 1 || isFetching}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="font-mono text-[11px] px-2.5 py-1 border border-border rounded text-text-muted disabled:opacity-30 hover:border-border-strong transition-colors"
              >
                ← Prev
              </button>
              <button
                disabled={requests.length < meta.limit || isFetching}
                onClick={() => setPage((p) => p + 1)}
                className="font-mono text-[11px] px-2.5 py-1 border border-border rounded text-text-muted disabled:opacity-30 hover:border-border-strong transition-colors"
              >
                Next →
              </button>
            </div>
          </div>
        </div>

        <RequestDrawer
          requestId={selectedId ?? ''}
          visible={drawerOpen && !!selectedId}
          onClose={() => setSelectedId(null)}
          onPrev={() => { if (selectedIdx > 0) setSelectedId(requests[selectedIdx - 1]?.id ?? null) }}
          onNext={() => { if (selectedIdx < requests.length - 1) setSelectedId(requests[selectedIdx + 1]?.id ?? null) }}
          hasPrev={selectedIdx > 0}
          hasNext={selectedIdx < requests.length - 1}
        />
      </div>
    </div>
  )
}
