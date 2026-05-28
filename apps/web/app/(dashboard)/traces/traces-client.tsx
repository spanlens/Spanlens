'use client'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTraces } from '@/lib/queries/use-traces'
import { LIVE_REFETCH_MS_SECONDARY } from '@/lib/queries/live-polling'
import type { TraceRow, TraceStatus } from '@/lib/queries/types'
import { Topbar } from '@/components/layout/topbar'
import { ExportDropdown } from '@/components/ui/export-dropdown'
import { cn, formatDateTime } from '@/lib/utils'

// Hydration-safe "is this the client?" gate — same pattern as the dashboard
// and the requests page. Returns false on SSR / first hydration paint and
// true once mounted, without setState-in-effect.
const subscribeNoop = () => () => {}
const getTrue = () => true
const getFalse = () => false
function useMounted(): boolean {
  return useSyncExternalStore(subscribeNoop, getTrue, getFalse)
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1) return '<1ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

// Cost rendered at fixed 5 fraction digits so the column aligns vertically.
// Matches the convention used on /requests.
function fmtCost(n: number): string {
  if (n <= 0) return '—'
  return `$${n.toFixed(5)}`
}

function fmtAge(dateStr: string, now: number): string {
  const s = Math.floor((now - new Date(dateStr).getTime()) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

// Small inline Copy button — used on truncated trace IDs in the table so a
// developer can grab the full ID without opening the detail page.
function CopyButton({ getText, label = 'copy' }: { getText: () => string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        void navigator.clipboard.writeText(getText())
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      title="Copy full ID"
      className="font-mono text-[9.5px] px-1 py-px border border-border rounded text-text-faint hover:text-text hover:border-border-strong transition-colors shrink-0"
    >
      {copied ? 'copied' : label}
    </button>
  )
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

type StatusFilter = 'all' | 'ok' | 'error' | 'running'
type TimeRange = '1h' | '24h' | '7d' | '30d' | 'all'
type SortField = 'started_at' | 'duration_ms' | 'total_cost_usd' | 'span_count'
type SortDir = 'asc' | 'desc'


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

// Lazy init from URL search params. SSR returns the default; on client mount
// the initializer runs and reads window.location.search.
function readUrlParams() {
  const empty = {
    statusFilter: 'all' as StatusFilter,
    timeRange: 'all' as TimeRange,
    nameSearch: '',
    sortBy: 'started_at' as SortField,
    sortDir: 'desc' as SortDir,
    page: 1,
  }
  if (typeof window === 'undefined') return empty
  const p = new URLSearchParams(window.location.search)
  const s = p.get('status')
  const r = p.get('range')
  const q = p.get('q')
  const sort = p.get('sort')
  const pg = parseInt(p.get('page') ?? '', 10)
  return {
    statusFilter: (s === 'ok' || s === 'error' || s === 'running' ? s : 'all') as StatusFilter,
    timeRange: (r === '1h' || r === '24h' || r === '7d' || r === '30d' ? r : 'all') as TimeRange,
    nameSearch: q ?? '',
    sortBy: (sort === 'duration_ms' || sort === 'total_cost_usd' || sort === 'span_count'
      ? sort
      : 'started_at') as SortField,
    sortDir: (p.get('dir') === 'asc' ? 'asc' : 'desc') as SortDir,
    page: !isNaN(pg) && pg > 1 ? pg : 1,
  }
}

export function TracesClient() {
  const router = useRouter()
  const initial = useMemo(() => readUrlParams(), [])
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initial.statusFilter)
  const [timeRange, setTimeRange] = useState<TimeRange>(initial.timeRange)
  const [nameSearch, setNameSearch] = useState(initial.nameSearch)
  const [sortBy, setSortBy] = useState<SortField>(initial.sortBy)
  const [sortDir, setSortDir] = useState<SortDir>(initial.sortDir)
  const [page, setPage] = useState(initial.page)

  // Sync filter state → URL
  useEffect(() => {
    const p = new URLSearchParams()
    if (statusFilter !== 'all') p.set('status', statusFilter)
    if (timeRange !== 'all') p.set('range', timeRange)
    if (nameSearch.trim()) p.set('q', nameSearch.trim())
    if (sortBy !== 'started_at') p.set('sort', sortBy)
    if (sortDir !== 'desc') p.set('dir', sortDir)
    if (page > 1) p.set('page', String(page))
    const qs = p.toString()
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
  }, [statusFilter, timeRange, nameSearch, sortBy, sortDir, page])

  const apiStatus: TraceStatus | 'all' =
    statusFilter === 'ok' ? 'completed'
    : statusFilter === 'error' ? 'error'
    : statusFilter === 'running' ? 'running'
    : 'all'

  // Stable mount-time snapshot for the from-date calculation.
  // Date.now() in a lazy useState initializer is allowed (runs once on mount).
  const [now] = useState(() => Date.now())
  const fromIso = useMemo(() => {
    if (timeRange === 'all') return undefined
    const ms = { '1h': 3600_000, '24h': 86400_000, '7d': 7 * 86400_000, '30d': 30 * 86400_000 }[timeRange]!
    const fromMs = Math.floor((now - ms) / 60_000) * 60_000
    return new Date(fromMs).toISOString()
  }, [timeRange, now])

  // Debounce the search input so we don't fire a server query on every
  // keystroke. 300ms matches the convention used on /requests.
  const [debouncedSearch, setDebouncedSearch] = useState(nameSearch)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(nameSearch.trim()), 300)
    return () => clearTimeout(t)
  }, [nameSearch])

  // Reset the page back to 1 whenever the search settles to a new value so
  // the user doesn't end up on page 4 of a smaller result set.
  const lastDebouncedSearchRef = useRef(debouncedSearch)
  useEffect(() => {
    if (lastDebouncedSearchRef.current !== debouncedSearch) {
      lastDebouncedSearchRef.current = debouncedSearch
      setPage(1)
    }
  }, [debouncedSearch])

  const { data, isLoading, isFetching, refetch } = useTraces(
    {
      page,
      limit: 50,
      status: apiStatus,
      ...(fromIso ? { from: fromIso } : {}),
      ...(debouncedSearch ? { q: debouncedSearch } : {}),
    },
    { refetchInterval: LIVE_REFETCH_MS_SECONDARY },
  )

  const rawTraces = useMemo(() => data?.data ?? [], [data])
  const meta = data?.meta ?? { total: 0, page: 1, limit: 50 }

  // Server-side filtering (status, from/to, q) is already applied; client
  // only re-sorts the page so the chosen sort field stays interactive
  // without a re-fetch.
  const traces = useMemo(() => {
    return [...rawTraces].sort((a, b) => {
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
  }, [rawTraces, sortBy, sortDir])

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
    const ids = traces.map((tr) => tr.id)
    try { sessionStorage.setItem('traceNavList', JSON.stringify({ ids })) } catch { /* ignore */ }
    router.push(`/traces/${t.id}`)
  }

  // Highlighted row for keyboard navigation. Arrow keys move the highlight;
  // Enter / Space navigates to the trace detail. Click also updates this so
  // the visual stays in sync with the user's last interaction. When the
  // list shrinks (filter narrows the result set), key handlers clamp the
  // index back into range — no explicit reset effect needed, and that
  // keeps us out of the react-hooks/set-state-in-effect rule.
  const [focusedIdx, setFocusedIdx] = useState<number>(-1)

  function handleTableKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (traces.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIdx((i) => Math.min(traces.length - 1, (i < 0 ? -1 : i) + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIdx((i) => Math.max(0, (i < 0 ? 0 : i) - 1))
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (focusedIdx >= 0 && focusedIdx < traces.length) {
        e.preventDefault()
        const t = traces[focusedIdx]
        if (t) handleRowClick(t)
      }
    }
  }

  // `now` for fmtAge — snapshot once on mount so the age string is stable
  // across renders (and avoids the previous suppressHydrationWarning kludge).
  const [nowSnap] = useState(() => Date.now())
  const mounted = useMounted()

  // Pagination derived values — single source of truth.
  const totalPages = Math.max(1, Math.ceil(meta.total / meta.limit))
  const currentPage = meta.page

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 bg-bg">
      {/* Sticky topbar — body scrolls natively, header stays visible. */}
      <div className="sticky top-0 z-20 bg-bg">
        <Topbar crumbs={[{ label: 'Traces' }]} />
        <h1 className="sr-only">Traces</h1>
      </div>

      {/* Stat strip. p50/p95/avg are computed from the rows currently on
          screen ("this page" suffix makes that explicit), while Traces and
          Errors come from the server response and reflect the full filtered
          set. */}
      <div className="overflow-x-auto shrink-0 border-b border-border">
      <div className="grid grid-cols-5 min-w-[480px]">
        {[
          { label: 'Traces',                value: mounted ? meta.total.toLocaleString() : '—',                   warn: false },
          { label: 'p50 duration · page',   value: mounted ? fmtDuration(p50)  : '—',                              warn: false },
          { label: 'p95 duration · page',   value: mounted ? fmtDuration(p95)  : '—',                              warn: mounted && p95 != null && p95 > 8000 },
          { label: 'Avg spans · page',      value: mounted && avgSpans != null ? avgSpans.toFixed(1) : '—',        warn: false },
          { label: 'Errors · page',         value: mounted ? String(errors) : '—',                                 warn: mounted && errors > 0 },
        ].map((s, i) => (
          <div
            key={i}
            className={cn('px-[18px] py-[14px]', i < 4 && 'border-r border-border')}
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">{s.label}</div>
            <span className={cn('text-[24px] font-medium leading-none tracking-[-0.6px]', s.warn ? 'text-accent' : 'text-text')}>
              {s.value}
            </span>
          </div>
        ))}
      </div>
      </div>

        {/* Filter toolbar */}
        <div className="flex items-center gap-[6px] px-[22px] py-[10px] border-b border-border shrink-0 flex-wrap">
          <div className="flex p-0.5 border border-border rounded-[5px] bg-bg-elev font-mono text-[10.5px] tracking-[0.03em]">
            {([['all', 'All'], ['ok', 'OK'], ['error', 'Error'], ['running', 'Live']] as [StatusFilter, string][]).map(([v, l]) => (
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

          <div className="inline-flex items-center gap-2 px-[10px] py-[5px] border border-border rounded-[5px] bg-bg-elev font-mono text-[11px] text-text-muted">
            <span className="text-text-faint text-[12px]">⌕</span>
            <input
              value={nameSearch}
              onChange={(e) => setNameSearch(e.target.value)}
              // Escape clears the search inline — matches /requests' Model
              // input convention and the dashboard export Escape pattern.
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setNameSearch('')
                }
              }}
              // Placeholder is intentionally specific: name + OTel external
              // trace ID accept substring matches, but Spanlens UUIDs need
              // the full 36-char form (PostgreSQL refuses LIKE on uuid).
              placeholder="Search agent name or full trace ID…"
              className="w-60 bg-transparent outline-none placeholder:text-text-faint text-[11px]"
            />
            {nameSearch && (
              <button
                type="button"
                onClick={() => setNameSearch('')}
                aria-label="Clear search"
                className="text-text-faint hover:text-text transition-colors text-[12px] leading-none"
              >×</button>
            )}
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleClearFilters}
              className="font-mono text-[10.5px] px-[9px] py-[4px] border border-border rounded-[5px] text-text-muted hover:text-text hover:border-border-strong transition-colors"
            >
              Clear
            </button>
          )}

          <span className="flex-1" />
          {/* Refetch button — spins while a fetch is in flight, matching
              the pattern on /requests. */}
          <button
            type="button"
            onClick={() => { void refetch() }}
            disabled={isFetching}
            aria-label="Refetch traces"
            className="font-mono text-[10.5px] px-[9px] py-[4px] border border-border rounded-[5px] text-text-muted hover:text-text hover:border-border-strong disabled:opacity-40 transition-colors inline-flex items-center"
          >
            <span className={cn('inline-block', isFetching && 'animate-spin')}>↻</span>
          </button>
          <ExportDropdown
            filename="spanlens-traces"
            buildUrl={(fmt) => {
              const params = new URLSearchParams({ format: fmt })
              if (apiStatus !== 'all') params.set('status', apiStatus)
              if (fromIso) params.set('from', fromIso)
              if (debouncedSearch) params.set('q', debouncedSearch)
              return `/api/v1/exports/traces?${params.toString()}`
            }}
          />
          {/* Count chip moved to the pagination footer below, where it lives
              alongside the page indicator instead of duplicating the info. */}
        </div>

      {/* Rows, header lives inside same scroll container so horizontal scroll
          is in sync. Arrow keys highlight a row; Enter / Space opens the
          trace detail.  tabIndex makes the table focusable as a single
          grid; row buttons inside keep their own click target. */}
      <div
        className="overflow-auto focus:outline-none"
        tabIndex={0}
        role="grid"
        aria-label="Traces table"
        onKeyDown={handleTableKey}
      >
        {isLoading ? (
          <div className="p-6 space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-10 bg-bg-elev rounded animate-pulse" />
            ))}
          </div>
        ) : traces.length === 0 ? (
          <div className="flex flex-col items-center gap-3 text-text-muted py-20 px-6 text-center">
            {hasActiveFilters || debouncedSearch ? (
              <>
                <p className="text-[13px]">No traces match the current filters.</p>
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="font-mono text-[11.5px] px-2.5 py-1 border border-border rounded text-text-muted hover:text-text hover:border-border-strong transition-colors"
                >
                  Clear filters
                </button>
              </>
            ) : (
              <>
                <p className="text-[13px] text-text-muted">No traces yet — wire up agent tracing to start collecting them.</p>
                <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
                  <Link
                    href="/projects"
                    className="font-mono text-[11.5px] text-accent hover:opacity-80 transition-opacity"
                  >
                    Add provider key →
                  </Link>
                  <Link
                    href="/docs/quick-start#tracing"
                    className="font-mono text-[11.5px] text-text-muted hover:text-text transition-colors"
                  >
                    Tracing quick start →
                  </Link>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="min-w-[700px]">
          {/* Column header */}
          <div
            className="grid px-[22px] py-[9px] border-b border-border bg-bg-muted sticky top-0 z-10"
            style={{ gridTemplateColumns: GRID }}
          >
            <span />
            <span className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em]">Agent</span>
            <span className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em]">Trace id</span>
            <SortHeader label="Spans"    field="span_count"     sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
            <SortHeader label="Duration" field="duration_ms"    sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
            <SortHeader label="Cost"     field="total_cost_usd" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
            <span className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em]">Tokens</span>
            <span className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em]">Timeline</span>
            <span className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em]">Status</span>
            <SortHeader label="Age"      field="started_at"     sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
          </div>
          {traces.map((t, idx) => {
            const isErr = t.status === 'error'
            const isRunning = t.status === 'running'
            // Only highlight when the index is in range — guards against a
            // stale focusedIdx that's larger than the new (shrunk) list.
            const isFocused = idx === focusedIdx && focusedIdx >= 0 && focusedIdx < traces.length
            return (
              <div
                key={t.id}
                role="row"
                aria-selected={isFocused}
                onClick={() => { setFocusedIdx(idx); handleRowClick(t) }}
                title={isErr && t.error_message ? t.error_message : undefined}
                className={cn(
                  'grid items-center w-full text-left px-[22px] py-[11px] border-b border-border font-mono text-[12.5px] hover:bg-bg-elev transition-colors cursor-pointer border-l-2',
                  isErr ? 'bg-bad-bg' : '',
                  isFocused ? 'border-l-accent bg-bg-muted' : 'border-l-transparent',
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
                {/* Trace ID + inline copy. Click on copy stops propagation
                    so the row click doesn't navigate. */}
                <span className="flex items-center gap-1.5 text-text-muted truncate pr-4 min-w-0">
                  <span className="truncate">{t.id.slice(0, 14)}…</span>
                  <CopyButton getText={() => t.id} />
                </span>
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
                <span>
                  {isErr ? (
                    <span
                      title={t.error_message ?? undefined}
                      className="font-mono text-[9.5px] px-[5px] py-[2px] rounded-[3px] bg-bad-bg text-bad border border-bad/20 uppercase tracking-[0.04em]"
                    >error</span>
                  ) : isRunning ? (
                    <span className="font-mono text-[9.5px] px-[5px] py-[2px] rounded-[3px] bg-accent-bg text-accent border border-accent-border uppercase tracking-[0.04em] animate-pulse">live</span>
                  ) : (
                    <span className="font-mono text-[9.5px] px-[5px] py-[2px] rounded-[3px] bg-bg-muted text-text-faint border border-border uppercase tracking-[0.04em]">ok</span>
                  )}
                </span>
                {/* Age cell uses the mounted gate so SSR and client first
                    paint both render an em-dash, avoiding the previous
                    suppressHydrationWarning kludge. */}
                <span className="text-text-faint text-right" title={formatDateTime(t.started_at)}>
                  {mounted ? fmtAge(t.started_at, nowSnap) : '—'}
                </span>
              </div>
            )
          })}
          </div>
        )}
      </div>

      {/* Pagination — single source of truth for "where am I". Uses
          meta.total / meta.limit so the Next button gates on the actual
          remaining rows instead of "this page happens to be full".
          First/Last let users jump in big result sets. */}
      {!isLoading && rawTraces.length > 0 && (
        <div className="flex items-center justify-between px-[22px] py-3 border-t border-border shrink-0 gap-3 flex-wrap">
          <span className="font-mono text-[11.5px] text-text-muted">
            {isFetching
              ? 'Loading…'
              : `Page ${currentPage} of ${totalPages.toLocaleString()} · ${rawTraces.length} / ${meta.total.toLocaleString()} total`}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage(1)}
              disabled={currentPage <= 1 || isFetching}
              aria-label="First page"
              className="font-mono text-[11.5px] px-3 py-[5px] border border-border rounded-[5px] text-text-muted hover:text-text disabled:opacity-40 transition-colors"
            >
              « First
            </button>
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
              disabled={currentPage * meta.limit >= meta.total || isFetching}
              className="font-mono text-[11.5px] px-3 py-[5px] border border-border rounded-[5px] text-text-muted hover:text-text disabled:opacity-40 transition-colors"
            >
              Next
            </button>
            <button
              type="button"
              onClick={() => setPage(totalPages)}
              disabled={currentPage >= totalPages || isFetching}
              aria-label="Last page"
              className="font-mono text-[11.5px] px-3 py-[5px] border border-border rounded-[5px] text-text-muted hover:text-text disabled:opacity-40 transition-colors"
            >
              Last »
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
