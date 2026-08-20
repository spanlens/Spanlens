'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Topbar } from '@/components/layout/topbar'
import { DemoExportButton } from '@/components/ui/demo-export-button'
import { cn } from '@/lib/utils'
import { DEMO_TRACES } from '@/lib/demo-data'
import type { TraceRow } from '@/lib/queries/types'

// ── Helpers ────────────────────────────────────────────────────

function fmtDuration(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1) return '<1ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
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
  durationMs, maxDurationMs, hasError, isRunning,
}: {
  durationMs: number | null; maxDurationMs: number; hasError: boolean; isRunning: boolean
}) {
  if (durationMs == null || maxDurationMs <= 0) {
    return <div className="h-[10px] rounded-[2px] border border-border bg-bg-muted w-full" />
  }
  const pct = Math.max(4, Math.min(100, (durationMs / maxDurationMs) * 100))
  const color = hasError ? 'bg-bad' : isRunning ? 'bg-accent animate-pulse' : 'bg-text opacity-70'
  return (
    <div className="h-[10px] rounded-[2px] border border-border bg-bg-muted w-full overflow-hidden">
      <div style={{ width: `${pct}%` }} className={cn('h-full rounded-[1px]', color)} />
    </div>
  )
}

// ── Filter / Sort types ────────────────────────────────────────

type StatusFilter = 'all' | 'ok' | 'error' | 'running'
type TimeRange = '1h' | '24h' | '7d' | '30d' | 'all'
type SortField = 'started_at' | 'duration_ms' | 'total_cost_usd' | 'span_count'
type SortDir = 'asc' | 'desc'

const GRID = '20px 1.4fr 1.2fr 0.6fr 0.8fr 0.8fr 0.9fr 1.2fr 1.2fr 0.5fr'

// Rows shown per page. The static fixture is small, so 10 keeps the demo to a
// couple of pages, enough to exercise the First / Prev / Next / Last controls.
const PAGE_SIZE = 10

// Millisecond span for each selectable time range. 'all' has no lower bound.
const RANGE_MS: Record<Exclude<TimeRange, 'all'>, number> = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
}

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
        'flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.1em] hover:text-text transition-colors',
        active ? 'text-text' : 'text-text-faint',
      )}
    >
      {label}
      {active && <span className="text-[9px]">{sortDir === 'desc' ? '↓' : '↑'}</span>}
    </button>
  )
}

// ── Page ───────────────────────────────────────────────────────

export default function DemoTracesPage() {
  const router = useRouter()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [timeRange, setTimeRange] = useState<TimeRange>('all')
  const [nameSearch, setNameSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortField>('started_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(1)

  // Stable mount-time snapshot for the time-range lower bound. Date.now() in a
  // lazy useState initializer runs once (on mount) and is never used on the
  // default 'all' path, so SSR and first client paint render identical rows.
  const [now] = useState(() => Date.now())
  const fromMs = useMemo(
    () => (timeRange === 'all' ? null : now - RANGE_MS[timeRange]),
    [timeRange, now],
  )

  const traces = useMemo(() => {
    let list = DEMO_TRACES as TraceRow[]

    // Status filter
    if (statusFilter === 'ok') {
      list = list.filter((t) => t.status === 'completed')
    } else if (statusFilter === 'error') {
      list = list.filter((t) => t.status === 'error')
    } else if (statusFilter === 'running') {
      list = list.filter((t) => t.status === 'running')
    }

    // Time range filter (static rows filtered by their own timestamp)
    if (fromMs != null) {
      list = list.filter((t) => new Date(t.started_at).getTime() >= fromMs)
    }

    // Search
    if (nameSearch.trim()) {
      const q = nameSearch.toLowerCase()
      list = list.filter(
        (t) => t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q),
      )
    }

    // Sort
    return [...list].sort((a, b) => {
      let av: number, bv: number
      if (sortBy === 'started_at') {
        av = new Date(a.started_at).getTime(); bv = new Date(b.started_at).getTime()
      } else if (sortBy === 'duration_ms') {
        av = a.duration_ms ?? -1; bv = b.duration_ms ?? -1
      } else if (sortBy === 'total_cost_usd') {
        av = a.total_cost_usd; bv = b.total_cost_usd
      } else {
        av = a.span_count; bv = b.span_count
      }
      return sortDir === 'desc' ? bv - av : av - bv
    })
  }, [statusFilter, fromMs, nameSearch, sortBy, sortDir])

  // Pagination derived values. currentPage is clamped so a filter that shrinks
  // the result set never strands the user on an out-of-range page.
  const totalPages = Math.max(1, Math.ceil(traces.length / PAGE_SIZE))
  const currentPage = Math.min(Math.max(1, page), totalPages)
  const pageRows = useMemo(
    () => traces.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [traces, currentPage],
  )

  // Stat strip computations
  const withDuration = traces.filter((t) => t.duration_ms != null).map((t) => t.duration_ms!)
  const sortedDur = [...withDuration].sort((a, b) => a - b)
  const p50 = sortedDur.length ? sortedDur[Math.floor(sortedDur.length * 0.5)] ?? null : null
  const p95 = sortedDur.length ? sortedDur[Math.floor(sortedDur.length * 0.95)] ?? null : null
  const maxDurationMs = withDuration.length ? Math.max(...withDuration) : 0
  const avgSpans = traces.length ? traces.reduce((s, t) => s + t.span_count, 0) / traces.length : null
  const errors = traces.filter((t) => t.status === 'error').length

  const hasActiveFilters = statusFilter !== 'all' || timeRange !== 'all' || nameSearch.trim() !== ''

  function handleSort(field: SortField) {
    if (sortBy === field) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortBy(field)
      setSortDir('desc')
    }
  }

  function handleClearFilters() {
    setStatusFilter('all')
    setTimeRange('all')
    setNameSearch('')
    setPage(1)
  }

  function handleRowClick(t: TraceRow) {
    router.push(`/demo/traces/${t.id}`)
  }

  return (
    <div className="-mx-4 -my-4 md:-mx-7 md:-mt-5 md:-mb-7 flex flex-col h-screen overflow-hidden bg-bg">
      <Topbar
        crumbs={[{ label: 'Demo', href: '/demo/dashboard' }, { label: 'Traces' }]}
        right={
          <DemoExportButton
            base="traces"
            rows={traces}
            columns={[
              { header: 'Name', value: (t: TraceRow) => t.name },
              { header: 'Status', value: (t: TraceRow) => t.status },
              { header: 'Started', value: (t: TraceRow) => t.started_at },
              { header: 'Duration ms', value: (t: TraceRow) => t.duration_ms ?? '' },
              { header: 'Spans', value: (t: TraceRow) => t.span_count },
              { header: 'Cost USD', value: (t: TraceRow) => t.total_cost_usd },
            ]}
          />
        }
      />

      {/* Stat strip */}
      {/* Content canvas — 16px rhythm between rows, per the Figma board. */}
      <div className="flex flex-col gap-4 flex-1 min-h-0 px-4 md:px-8 pt-5 pb-7">

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <>
          {[
            { label: 'Traces',            value: DEMO_TRACES.length.toLocaleString('en-US'), warn: false },
            { label: 'p50 duration',      value: fmtDuration(p50),                   warn: false },
            { label: 'p95 duration',      value: fmtDuration(p95),                   warn: p95 != null && p95 > 8000 },
            { label: 'Avg spans / trace', value: avgSpans != null ? avgSpans.toFixed(1) : '—', warn: false },
            { label: 'Errors',            value: String(errors),                      warn: errors > 0 },
          ].map((s, i) => (
            <div key={i} className="card-surface rounded-card px-5 py-[18px]">
              <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-faint mb-2">{s.label}</div>
              <span className={cn('font-display text-[28px] track-kpi leading-[1.05] block', s.warn ? 'text-accent' : 'text-text')}>
                {s.value}
              </span>
            </div>
          ))}
        </>
      </div>

      {/* Filter toolbar */}
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        <div className="inline-flex items-center gap-[2px] rounded-full bg-secondary p-[3px]">
          {([['all', 'All'], ['ok', 'OK'], ['error', 'Error'], ['running', 'Live']] as [StatusFilter, string][]).map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => { setStatusFilter(v); setPage(1) }}
              className={cn(
                'font-mono text-[12px] leading-[17px] px-3 py-[5px] rounded-full transition-colors',
                statusFilter === v ? 'bg-bg-elev text-text' : 'text-text-faint hover:text-text',
              )}
            >{l}</button>
          ))}
        </div>

        <div className="inline-flex items-center gap-[2px] rounded-full bg-secondary p-[3px]">
          {(['1h', '24h', '7d', '30d', 'all'] as TimeRange[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => { setTimeRange(v); setPage(1) }}
              className={cn(
                'font-mono text-[12px] leading-[17px] px-3 py-[5px] rounded-full transition-colors',
                timeRange === v ? 'bg-bg-elev text-text' : 'text-text-faint hover:text-text',
              )}
            >{v === 'all' ? 'All time' : v}</button>
          ))}
        </div>

        <div className="inline-flex items-center gap-2 h-[33px] px-3 border border-border rounded-md bg-bg-elev text-[12.5px] text-text">
          <span className="text-text-faint text-[12px]">⌕</span>
          <input
            value={nameSearch}
            onChange={(e) => { setNameSearch(e.target.value); setPage(1) }}
            placeholder="Search agent or trace ID…"
            className="w-44 bg-transparent outline-none placeholder:text-text-faint text-[11px]"
          />
          {nameSearch && (
            <button
              type="button"
              onClick={() => { setNameSearch(''); setPage(1) }}
              className="text-text-faint hover:text-text transition-colors text-[12px] leading-none"
            >×</button>
          )}
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={handleClearFilters}
            className="text-[12.5px] font-medium px-3 py-[7px] border border-border rounded-md bg-bg-elev text-text-muted hover:text-text hover:border-border-strong transition-colors"
          >
            Clear
          </button>
        )}

        <span className="flex-1" />
        <span className="font-mono text-[11px] text-text-faint">
          {traces.length} of {DEMO_TRACES.length}
        </span>
      </div>

      {/* Table — one card, header band and pager footer inside it. */}
      <div className="card-surface rounded-card flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex-1 overflow-auto">
        {traces.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted py-20 px-6 text-center">
            <p className="text-[13px]">No traces match your filters.</p>
            <button
              type="button"
              onClick={handleClearFilters}
              className="font-mono text-[11.5px] text-accent hover:opacity-80 transition-opacity"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="min-w-[700px]">
            {/* Column header */}
            <div
              className="grid px-[18px] py-2.5 border-b border-border bg-bg-muted sticky top-0 z-10"
              style={{ gridTemplateColumns: GRID }}
            >
              <span />
              <span className="font-mono text-[10px] text-text-faint uppercase tracking-[0.1em]">Agent</span>
              <span className="font-mono text-[10px] text-text-faint uppercase tracking-[0.1em]">Trace id</span>
              <SortHeader label="Spans"    field="span_count"     sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortHeader label="Duration" field="duration_ms"    sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <SortHeader label="Cost"     field="total_cost_usd" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              <span className="font-mono text-[10px] text-text-faint uppercase tracking-[0.1em]">Tokens</span>
              <span className="font-mono text-[10px] text-text-faint uppercase tracking-[0.1em]">Timeline</span>
              <span className="font-mono text-[10px] text-text-faint uppercase tracking-[0.1em]">Status</span>
              <SortHeader label="Age"      field="started_at"     sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
            </div>

            {pageRows.map((t) => {
              const isErr = t.status === 'error'
              const isRunning = t.status === 'running'
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleRowClick(t)}
                  title={isErr && t.error_message ? t.error_message : undefined}
                  className={cn(
                    'grid items-center w-full text-left px-[18px] py-[11px] border-b border-border last:border-b-0 font-mono text-[12px] hover:bg-bg-muted transition-colors',
                    isErr && 'bg-bad-bg/50',
                  )}
                  style={{ gridTemplateColumns: GRID }}
                >
                  <span>
                    {isErr ? (
                      <span className="w-1.5 h-1.5 rounded-full bg-bad block" />
                    ) : isRunning ? (
                      <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse block" />
                    ) : null}
                  </span>
                  <span className="text-text font-sans text-[13px] font-medium truncate pr-4">{t.name}</span>
                  <span className="text-text-muted truncate pr-4">{t.id.slice(0, 14)}…</span>
                  <span className="text-text-muted">{t.span_count}</span>
                  <span className={isErr ? 'text-bad' : 'text-text'}>{fmtDuration(t.duration_ms)}</span>
                  <span className="text-text">{fmtCost(t.total_cost_usd)}</span>
                  <span className="text-text-muted">{t.total_tokens.toLocaleString('en-US')}</span>
                  <span className="pr-4 flex items-center">
                    <TraceDurationBar
                      durationMs={t.duration_ms}
                      maxDurationMs={maxDurationMs}
                      hasError={isErr}
                      isRunning={isRunning}
                    />
                  </span>
                  <span>
                    {isErr ? (
                      <span className="text-[11px] font-semibold px-2 py-[3px] rounded-full bg-bad-bg text-bad">error</span>
                    ) : isRunning ? (
                      <span className="text-[11px] font-semibold px-2 py-[3px] rounded-full bg-accent-bg text-accent animate-pulse">live</span>
                    ) : (
                      <span className="text-[11px] font-semibold px-2 py-[3px] rounded-full bg-good-bg text-good">ok</span>
                    )}
                  </span>
                  <span className="text-text-faint text-right" title={new Date(t.started_at).toLocaleString('en-US')}>
                    {fmtAge(t.started_at)}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Pagination footer — pages the static rows client-side. First / Last
          let the user jump across the (small) result set, Prev / Next step by
          one. currentPage is the clamped source of truth. */}
      {traces.length > 0 && (
        <div className="flex items-center justify-between px-[18px] py-3 border-t border-border bg-bg-muted shrink-0 gap-3 flex-wrap">
          <span className="font-mono text-[11.5px] text-text-faint">
            Page {currentPage} of {totalPages.toLocaleString('en-US')} · {pageRows.length} / {traces.length.toLocaleString('en-US')} total
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage(1)}
              disabled={currentPage <= 1}
              aria-label="First page"
              className="text-[12px] font-medium px-3 py-[6px] border border-border rounded-full bg-bg-elev text-text hover:border-border-strong disabled:opacity-30 transition-colors"
            >
              « First
            </button>
            <button
              type="button"
              onClick={() => setPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
              className="text-[12px] font-medium px-3 py-[6px] border border-border rounded-full bg-bg-elev text-text hover:border-border-strong disabled:opacity-30 transition-colors"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage >= totalPages}
              className="text-[12px] font-medium px-3 py-[6px] border border-border rounded-full bg-bg-elev text-text hover:border-border-strong disabled:opacity-30 transition-colors"
            >
              Next
            </button>
            <button
              type="button"
              onClick={() => setPage(totalPages)}
              disabled={currentPage >= totalPages}
              aria-label="Last page"
              className="text-[12px] font-medium px-3 py-[6px] border border-border rounded-full bg-bg-elev text-text hover:border-border-strong disabled:opacity-30 transition-colors"
            >
              Last »
            </button>
          </div>
        </div>
      )}
      </div>{/* end table card */}
      </div>{/* end content canvas */}
    </div>
  )
}
