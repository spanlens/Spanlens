'use client'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ExportDropdown } from '@/components/ui/export-dropdown'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { Topbar } from '@/components/layout/topbar'
import {
  useRequests,
  useRequest,
} from '@/lib/queries/use-requests'
import { useProviderKeys } from '@/lib/queries/use-provider-keys'
import { useTrace } from '@/lib/queries/use-traces'
import { useStatsOverview, useStatsTimeseries } from '@/lib/queries/use-stats'
import { useAnomalies } from '@/lib/queries/use-anomalies'
import type { RequestRow, RequestDetail } from '@/lib/queries/types'

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

const DEFAULT_FILTERS: UiFilters = { provider: 'all', status: 'all', model: '', providerKeyId: 'all' }

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
  const from24h = useMemo(() => {
    const ms = Math.floor((Date.now() - 24 * 3600_000) / 60_000) * 60_000
    return new Date(ms).toISOString()
  }, [])
  const overview = useStatsOverview({ from: from24h })
  const timeseries = useStatsTimeseries({ from: from24h })
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
  const [tab, setTab] = useState<DrawerTab>('request')
  useEffect(() => { setTab('request') }, [requestId])
  const { data: req, isLoading, isError } = useRequest(requestId)
  const messages = useMemo(() => {
    if (!req?.request_body || typeof req.request_body !== 'object') return null
    const body = req.request_body as Record<string, unknown>

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
  }, [req?.request_body])

  return (
    <aside className={cn(
      'shrink-0 bg-bg-elev flex flex-col overflow-hidden',
      'transition-[width] duration-200 ease-out',
      visible ? 'w-[480px] border-l border-border' : 'w-0',
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
          {([
            ['Model', req.model],
            ['Provider', req.provider],
            ['Status', String(req.status_code)],
            ['Key', req.provider_key_name ?? '—'],
            ['Prompt tokens', req.prompt_tokens.toLocaleString()],
            ['Completion', req.completion_tokens.toLocaleString()],
          ] as [string, string][]).map(([k, v]) => (
            <div key={k}>
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-0.5">{k}</div>
              <div className="font-mono text-[12.5px] text-text truncate">{v}</div>
            </div>
          ))}

          {/* Trace — link to trace page + copy full ID */}
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
              <div className="font-mono text-[12.5px] text-text">—</div>
            )}
          </div>

          {/* Span — copy full ID */}
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-0.5">Span</div>
            {req.span_id ? (
              <div className="flex items-center gap-1 min-w-0">
                <span className="font-mono text-[12.5px] text-text truncate min-w-0">{req.span_id.slice(0, 12)}…</span>
                <CopyButton getText={() => req.span_id!} />
              </div>
            ) : (
              <div className="font-mono text-[12.5px] text-text">—</div>
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
              <CopyButton getText={() => JSON.stringify(req.request_body, null, 2)} />
            </div>
            <MessageDisplay messages={messages} body={req.request_body} />
          </div>
        ) : tab === 'response' ? (
          req.response_body == null ? (
            <p className="font-mono text-[11.5px] text-text-faint leading-relaxed">
              Response body is not stored — the proxy streams the response directly to your application without buffering it.<br /><br />
              Full response capture is planned for a future release.
            </p>
          ) : (
            <div className="space-y-2">
              <div className="flex justify-end">
                <CopyButton getText={() => JSON.stringify(req.response_body, null, 2)} />
              </div>
              <pre className="font-mono text-[11.5px] text-text-muted leading-relaxed whitespace-pre-wrap break-all">
                {JSON.stringify(req.response_body, null, 2)}
              </pre>
            </div>
          )
        ) : tab === 'trace' ? (
          <TraceTab traceId={req.trace_id ?? null} />
        ) : tab === 'error' ? (
          <pre className="font-mono text-[12px] text-bad leading-relaxed whitespace-pre-wrap break-all">
            {req.error_message}
          </pre>
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
            {JSON.stringify(req.request_body, null, 2)}
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
            {JSON.stringify(req.response_body, null, 2)}
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
            <div className="text-center py-12 font-mono text-[12.5px] text-text-faint">
              {hasActiveFilters
                ? 'No requests match the current filters.'
                : 'No requests yet. Make your first API call through the proxy.'}
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
                  <span
                    className="text-text-faint text-right"
                    title={new Date(req.created_at).toLocaleString()}
                  >{relAge(req.created_at)}</span>
                </div>
              )
            })}
    </div>
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
  const [modelInput, setModelInput] = useState(() => searchParams.get('model') ?? '')
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => ({ ...f, model: modelInput.trim() }))
      setPage(1)
      setSelectedId(null)
    }, 300)
    return () => clearTimeout(t)
  }, [modelInput])
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pendingNavigation, setPendingNavigation] = useState<'first' | 'last' | null>(null)
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [timeRange, setTimeRange] = useState<TimeRange>('all')

  const fromIso = useMemo(() => {
    const now = Date.now()
    if (timeRange === 'today') {
      const d = new Date()
      d.setUTCHours(0, 0, 0, 0)
      return d.toISOString()
    }
    if (timeRange === '7d') return new Date(now - 7 * 24 * 3_600_000).toISOString()
    if (timeRange === '30d') return new Date(now - 30 * 24 * 3_600_000).toISOString()
    return undefined
  }, [timeRange])

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
    }),
    [page, filters.provider, filters.model, filters.providerKeyId, filters.status, fromIso, sortField, sortDir],
  )

  const { data, isLoading, isFetching } = useRequests(serverFilters)
  const providerKeysQuery = useProviderKeys()

  const visibleKeys = useMemo(() => {
    const keys = providerKeysQuery.data ?? []
    if (filters.provider === 'all') return keys
    return keys.filter((k) => k.provider === filters.provider)
  }, [providerKeysQuery.data, filters.provider])

  const requests = data?.data ?? []
  const meta = data?.meta ?? { total: 0, page: 1, limit: 50 }

  // After a cross-page navigation, select the first or last item once the new page loads
  useEffect(() => {
    if (!pendingNavigation || isLoading || requests.length === 0) return
    const target = pendingNavigation === 'first' ? requests[0] : requests[requests.length - 1]
    if (target) setSelectedId(target.id)
    setPendingNavigation(null)
  }, [pendingNavigation, isLoading, requests])

  const hasActiveFilters =
    filters.provider !== 'all' ||
    filters.status !== 'all' ||
    filters.model.trim() !== '' ||
    filters.providerKeyId !== 'all' ||
    timeRange !== 'all'

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortField(field)
      setSortDir('desc')
    }
    setPage(1)
    setSelectedId(null)
  }

  const drawerOpen = selectedId !== null
  const selectedIdx = selectedId ? requests.findIndex((r) => r.id === selectedId) : -1

  function handleSelect(id: string) {
    setSelectedId((prev) => (prev === id ? null : id))
  }

  return (
    <div className="-m-7 flex h-screen overflow-hidden">
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
      <Topbar
        crumbs={[{ label: 'Workspace' }, { label: 'Requests' }]}
        right={null}
      />

      <StatStrip />
      <TrafficBars />

      {/* Filter row */}
      <div className="flex items-center gap-1.5 px-[22px] py-[10px] border-b border-border shrink-0 flex-wrap">
        {/* Time range */}
        <div className="flex border border-border rounded-[5px] overflow-hidden bg-bg-elev font-mono text-[10.5px] tracking-[0.03em] shrink-0">
          {(['all', 'today', '7d', '30d'] as TimeRange[]).map((r) => (
            <button
              key={r}
              onClick={() => { setTimeRange(r); setPage(1); setSelectedId(null) }}
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
              onClick={() => { setFilters((f) => ({ ...f, status: v })); setPage(1); setSelectedId(null) }}
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

        {/* Provider select */}
        <select
          value={filters.provider}
          onChange={(e) => { setFilters((f) => ({ ...f, provider: e.target.value, providerKeyId: 'all' })); setPage(1); setSelectedId(null) }}
          className="font-mono text-[11px] border border-border rounded-[5px] px-2 py-[5px] bg-bg text-text-muted hover:border-border-strong transition-colors focus:outline-none appearance-none cursor-pointer"
        >
          <option value="all">All providers</option>
          <option value="openai">openai</option>
          <option value="anthropic">anthropic</option>
          <option value="gemini">gemini</option>
        </select>

        {/* Model input — debounced, applies 300ms after last keystroke */}
        <input
          type="text"
          placeholder="Model…"
          value={modelInput}
          onChange={(e) => setModelInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setModelInput('') }
          }}
          className="font-mono text-[11px] border border-border rounded-[5px] px-2 py-[5px] bg-bg text-text-muted hover:border-border-strong focus:border-border-strong transition-colors outline-none w-28 placeholder:text-text-faint"
        />

        {/* Key select */}
        {visibleKeys.length > 0 && (
          <select
            value={filters.providerKeyId}
            onChange={(e) => { setFilters((f) => ({ ...f, providerKeyId: e.target.value })); setPage(1); setSelectedId(null) }}
            className="font-mono text-[11px] border border-border rounded-[5px] px-2 py-[5px] bg-bg text-text-muted hover:border-border-strong transition-colors focus:outline-none appearance-none cursor-pointer max-w-[140px] truncate"
          >
            <option value="all">All keys</option>
            {visibleKeys.map((k) => (
              <option key={k.id} value={k.id}>{k.name}</option>
            ))}
          </select>
        )}

        {hasActiveFilters && (
          <button
            onClick={() => {
              setFilters(DEFAULT_FILTERS)
              setModelInput('')
              setTimeRange('all')
              setPage(1)
              setSelectedId(null)
            }}
            className="font-mono text-[10.5px] px-[9px] py-[5px] border border-border rounded-[5px] text-text-faint hover:text-text hover:border-border-strong transition-colors shrink-0"
          >
            Clear filters
          </button>
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
            if (fromIso)                    params.set('from', fromIso)
            return `/api/v1/exports/requests?${params.toString()}`
          }}
        />
      </div>

      {/* Table + pagination */}
      <div className="flex flex-col flex-1 overflow-hidden">
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

          {/* Pagination */}
          <div className="flex items-center justify-between px-[22px] py-3 border-t border-border shrink-0">
            <span className="font-mono text-[11px] text-text-faint">
              Page {meta.page} · {meta.total.toLocaleString()} total
            </span>
            <div className="flex gap-1.5">
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
            </div>
          </div>
        </div>
      </div>{/* end left column */}

      <RequestDrawer
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
