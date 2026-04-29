'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTraces } from '@/lib/queries/use-traces'
import type { TraceRow, TraceStatus } from '@/lib/queries/types'
import { Topbar } from '@/components/layout/topbar'
import { ExportDropdown } from '@/components/ui/export-dropdown'
import { cn } from '@/lib/utils'

function fmtDuration(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function fmtCost(n: number): string {
  if (n <= 0) return '—'
  return n < 0.001 ? `$${n.toFixed(5)}` : `$${n.toFixed(4)}`
}

function fmtAge(dateStr: string): string {
  const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function TraceDurationBar({
  durationMs,
  maxDurationMs,
  hasError,
  isRunning,
}: {
  durationMs: number | null
  maxDurationMs: number
  hasError: boolean
  isRunning: boolean
}) {
  if (durationMs == null || maxDurationMs <= 0) {
    return <div className="h-[10px] rounded-[2px] border border-border bg-bg-muted w-full" />
  }
  const pct = Math.max(4, Math.min(100, (durationMs / maxDurationMs) * 100))
  const color = hasError ? 'bg-bad' : isRunning ? 'bg-accent' : 'bg-text opacity-70'
  return (
    <div className="h-[10px] rounded-[2px] border border-border bg-bg-muted w-full overflow-hidden">
      <div style={{ width: `${pct}%` }} className={cn('h-full rounded-[1px]', color)} />
    </div>
  )
}

type StatusFilter = 'all' | 'ok' | 'error'
type TimeRange = '1h' | '24h' | '7d' | '30d' | 'all'
type SortField = 'started_at' | 'duration_ms' | 'total_cost_usd' | 'span_count'
type SortDir = 'asc' | 'desc'

function timeRangeToFrom(range: TimeRange): string | undefined {
  if (range === 'all') return undefined
  const ms = { '1h': 3600_000, '24h': 86400_000, '7d': 7 * 86400_000, '30d': 30 * 86400_000 }[range]
  return new Date(Date.now() - ms).toISOString()
}

const GRID = '20px 1.4fr 1.2fr 0.6fr 0.8fr 0.8fr 0.9fr 1.2fr 1.2fr 0.5fr'

function SortHeader({
  label, field, sortBy, sortDir, onSort,
}: {
  label: string; field: SortField; sortBy: SortField; sortDir: SortDir
  onSort: (f: SortField) => void
}) {
  const active = sortBy === field
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={cn(
        'flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.05em] hover:text-text transition-colors',
        active ? 'text-text' : 'text-text-faint',
      )}
    >
      {label}
      {active && <span className="text-[9px]">{sortDir === 'desc' ? '↓' : '↑'}</span>}
    </button>
  )
}

export default function TracesPage() {
  const router = useRouter()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [timeRange, setTimeRange] = useState<TimeRange>('all')
  const [nameSearch, setNameSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortField>('started_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(1)

  const apiStatus: TraceStatus | 'all' =
    statusFilter === 'ok' ? 'completed' : statusFilter === 'error' ? 'error' : 'all'

  const fromIso = timeRangeToFrom(timeRange)

  const { data, isLoading, isFetching } = useTraces({
    page,
    limit: 50,
    status: apiStatus,
    ...(fromIso ? { from: fromIso } : {}),
  })

  const rawTraces = useMemo(() => data?.data ?? [], [data])
  const meta = data?.meta ?? { total: 0, page: 1, limit: 50 }

  // Client-side name search + sort
  const traces = useMemo(() => {
    let list = rawTraces
    if (nameSearch.trim()) {
      const q = nameSearch.toLowerCase()
      list = list.filter(
        (t) => t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q),
      )
    }
    return [...list].sort((a, b) => {
      let av: number, bv: number
      if (sortBy === 'started_at') {
        av = new Date(a.started_at).getTime()
        bv = new Date(b.started_at).getTime()
      } else if (sortBy === 'duration_ms') {
        av = a.duration_ms ?? -1
        bv = b.duration_ms ?? -1
      } else if (sortBy === 'total_cost_usd') {
        av = a.total_cost_usd
        bv = b.total_cost_usd
      } else {
        av = a.span_count
        bv = b.span_count
      }
      return sortDir === 'desc' ? bv - av : av - bv
    })
  }, [rawTraces, nameSearch, sortBy, sortDir])

  const withDuration = traces.filter((t) => t.duration_ms != null).map((t) => t.duration_ms!)
  const sortedDur = [...withDuration].sort((a, b) => a - b)
  const p50 = sortedDur.length ? sortedDur[Math.floor(sortedDur.length * 0.5)] ?? null : null
  const p95 = sortedDur.length ? sortedDur[Math.floor(sortedDur.length * 0.95)] ?? null : null
  const maxDurationMs = withDuration.length ? Math.max(...withDuration) : 0
  const avgSpans = traces.length ? traces.reduce((s, t) => s + t.span_count, 0) / traces.length : null
  const errors = traces.filter((t) => t.status === 'error').length

  function handleSort(field: SortField) {
    if (sortBy === field) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortBy(field)
      setSortDir('desc')
    }
  }

  // Store nav list in sessionStorage before navigating so detail page can Prev/Next
  function handleRowClick(t: TraceRow) {
    try {
      sessionStorage.setItem(
        'traceNavList',
        JSON.stringify({ ids: traces.map((tr) => tr.id) }),
      )
    } catch { /* ignore */ }
    router.push(`/traces/${t.id}`)
  }

  return (
    <div className="-m-7 flex flex-col h-screen overflow-hidden bg-bg">
      <Topbar
        crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Traces' }]}
      />

      {/* Stat strip */}
      <div className="grid grid-cols-5 border-b border-border shrink-0">
        {[
          { label: 'Traces',           value: meta.total.toLocaleString(), warn: false },
          { label: 'p50 duration',     value: fmtDuration(p50),            warn: false },
          { label: 'p95 duration',     value: fmtDuration(p95),            warn: p95 != null && p95 > 8000 },
          { label: 'Avg spans / trace',value: avgSpans != null ? avgSpans.toFixed(1) : '—', warn: false },
          { label: 'Errors',           value: String(errors),              warn: errors > 0 },
        ].map((s, i) => (
          <div key={i} className={cn('px-[18px] py-[14px]', i < 4 && 'border-r border-border')}>
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">{s.label}</div>
            <span className={cn('text-[24px] font-medium leading-none tracking-[-0.6px]', s.warn ? 'text-accent' : 'text-text')}>
              {s.value}
            </span>
          </div>
        ))}
      </div>

      {/* Filter toolbar */}
      <div className="flex items-center gap-[6px] px-[22px] py-[10px] border-b border-border shrink-0 flex-wrap">
        {/* Status */}
        <div className="flex p-0.5 border border-border rounded-[5px] bg-bg-elev font-mono text-[10.5px] tracking-[0.03em]">
          {([['all', 'All'], ['ok', 'OK'], ['error', 'Error']] as [StatusFilter, string][]).map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => { setStatusFilter(v); setPage(1) }}
              className={cn(
                'px-[10px] py-[3px] rounded-[3px] transition-colors',
                statusFilter === v ? 'bg-text text-bg' : 'text-text-muted hover:text-text',
              )}
            >{l}</button>
          ))}
        </div>

        {/* Time range */}
        <div className="flex p-0.5 border border-border rounded-[5px] bg-bg-elev font-mono text-[10.5px] tracking-[0.03em]">
          {(['1h', '24h', '7d', '30d', 'all'] as TimeRange[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => { setTimeRange(v); setPage(1) }}
              className={cn(
                'px-[10px] py-[3px] rounded-[3px] transition-colors',
                timeRange === v ? 'bg-text text-bg' : 'text-text-muted hover:text-text',
              )}
            >{v === 'all' ? 'All time' : v}</button>
          ))}
        </div>

        {/* Name / ID search */}
        <div className="inline-flex items-center gap-2 px-[10px] py-[5px] border border-border rounded-[5px] bg-bg-elev font-mono text-[11px] text-text-muted">
          <span className="text-text-faint text-[12px]">⌕</span>
          <input
            value={nameSearch}
            onChange={(e) => setNameSearch(e.target.value)}
            placeholder="Search agent or trace ID…"
            className="w-44 bg-transparent outline-none placeholder:text-text-faint text-[11px]"
          />
          {nameSearch && (
            <button
              type="button"
              onClick={() => setNameSearch('')}
              className="text-text-faint hover:text-text transition-colors text-[12px] leading-none"
            >×</button>
          )}
        </div>

        <span className="flex-1" />
        <ExportDropdown
          filename="spanlens-traces"
          buildUrl={(fmt) => {
            const params = new URLSearchParams({ format: fmt })
            if (apiStatus !== 'all') params.set('status', apiStatus)
            if (fromIso) params.set('from', fromIso)
            return `/api/v1/exports/traces?${params.toString()}`
          }}
        />
        <span className="font-mono text-[11px] text-text-faint">
          {traces.length.toLocaleString()} of {meta.total.toLocaleString()}
        </span>
      </div>

      {/* Column header */}
      <div
        className="grid border-b border-border bg-bg-muted shrink-0 px-[22px] py-[9px]"
        style={{ gridTemplateColumns: GRID }}
      >
        <span />
        <span className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em]">Agent</span>
        <span className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em]">Trace id</span>
        <SortHeader label="Spans"    field="span_count"      sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
        <SortHeader label="Duration" field="duration_ms"     sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
        <SortHeader label="Cost"     field="total_cost_usd"  sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
        <span className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em]">Tokens</span>
        <span className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em]">Span timeline</span>
        <span className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em]">Tag</span>
        <SortHeader label="Age"      field="started_at"      sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-6 space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-10 bg-bg-elev rounded animate-pulse" />
            ))}
          </div>
        ) : traces.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
            <p className="text-[13px]">No traces found.</p>
            <p className="font-mono text-[12px]">Try adjusting your filters or use the Spanlens SDK to start recording agent traces.</p>
          </div>
        ) : (
          traces.map((t) => {
            const isErr = t.status === 'error'
            const isRunning = t.status === 'running'
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => handleRowClick(t)}
                title={isErr && t.error_message ? t.error_message : undefined}
                className={cn(
                  'grid items-center w-full text-left px-[22px] py-[11px] border-b border-border font-mono text-[12.5px] hover:bg-bg-elev transition-colors',
                  isErr && 'bg-accent-bg',
                )}
                style={{ gridTemplateColumns: GRID }}
              >
                <span>
                  {isErr ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-bad block" title={t.error_message ?? undefined} />
                  ) : isRunning ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse block" />
                  ) : null}
                </span>
                <span className="text-text font-sans text-[13px] font-medium truncate pr-4">{t.name}</span>
                <span className="text-text-muted truncate pr-4">{t.id.slice(0, 14)}…</span>
                <span className="text-text-muted">{t.span_count}</span>
                <span className={isErr ? 'text-bad' : 'text-text'}>{fmtDuration(t.duration_ms)}</span>
                <span className="text-text">{fmtCost(t.total_cost_usd)}</span>
                <span className="text-text-muted">{t.total_tokens.toLocaleString()}</span>
                <span className="pr-4 flex items-center">
                  <TraceDurationBar
                    durationMs={t.duration_ms}
                    maxDurationMs={maxDurationMs}
                    hasError={isErr}
                    isRunning={isRunning}
                  />
                </span>
                <span className={cn('text-[11px] font-sans truncate', isErr ? 'text-bad' : isRunning ? 'text-accent' : 'text-text-faint')}>
                  {isErr
                    ? (t.error_message ? t.error_message.slice(0, 24) + (t.error_message.length > 24 ? '…' : '') : 'error')
                    : isRunning ? 'running' : '—'}
                </span>
                <span className="text-text-faint text-right" title={new Date(t.started_at).toLocaleString()}>
                  {fmtAge(t.started_at)}
                </span>
              </button>
            )
          })
        )}
      </div>

      {/* Pagination */}
      {!isLoading && rawTraces.length > 0 && (
        <div className="flex items-center justify-between px-[22px] py-3 border-t border-border shrink-0">
          <span className="font-mono text-[11.5px] text-text-muted">
            {rawTraces.length.toLocaleString()} of {meta.total.toLocaleString()} traces
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isFetching}
              className="font-mono text-[11.5px] px-3 py-[5px] border border-border rounded-[5px] text-text-muted hover:text-text disabled:opacity-40 transition-colors"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={rawTraces.length < (data?.meta.limit ?? 50) || isFetching}
              className="font-mono text-[11.5px] px-3 py-[5px] border border-border rounded-[5px] text-text-muted hover:text-text disabled:opacity-40 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
