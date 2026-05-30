'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, ArrowUpDown, Check, Copy, Search, Users as UsersIcon } from 'lucide-react'

// TODO: re-add `usePostHog()` + `users_page_viewed` / `users_row_clicked`
// capture once PostHog provider lands on main. Event payloads designed
// in docs/launch/2026-05-14_cache-stream-users.md §3.
import { Skeleton } from '@/components/ui/skeleton'
import { cn, formatDate } from '@/lib/utils'
import { useUsers } from '@/lib/queries/use-users'
import { Topbar, TimeRangeSelector, type CustomRange } from '@/components/layout/topbar'

// Hydration-safe "is this the client?" gate. Same pattern as dashboard /
// requests / traces — avoids the setState-in-effect lint rule.
const subscribeNoop = () => () => {}
const getTrue = () => true
const getFalse = () => false
function useMounted(): boolean {
  return useSyncExternalStore(subscribeNoop, getTrue, getFalse)
}

type SortBy = 'cost' | 'requests' | 'tokens' | 'last_seen' | 'latency'
type SortDir = 'asc' | 'desc'
type TimeRange = '1h' | '24h' | '7d' | '30d' | 'custom'

const PAGE_SIZE = 50
const SLOW_LATENCY_MS = 2000
const DEFAULT_RANGE: TimeRange = '30d'

function fmtCost(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n === 0) return '$0.00'
  return n < 0.01 ? '< $0.01' : '$' + n.toFixed(2)
}

function fmtCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return String(n)
}

function fmtRelativeTime(iso: string): string {
  const d = new Date(iso).getTime()
  const diff = Date.now() - d
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  // Locale pinned via formatDate — see CLAUDE.md gotcha #22 (React #418).
  return formatDate(iso)
}

function fmtAbsolute(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function rangeToHours(range: TimeRange): number | null {
  switch (range) {
    case '1h':  return 1
    case '24h': return 24
    case '7d':  return 24 * 7
    case '30d': return 24 * 30
    default:    return null
  }
}

function sinceLabel(range: TimeRange, custom: CustomRange | null): string {
  if (range === 'custom' && custom) {
    const f = new Date(custom.from).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const t = new Date(custom.to).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    return `${f} – ${t}`
  }
  switch (range) {
    case '1h':  return 'Last hour'
    case '24h': return 'Last 24h'
    case '7d':  return 'Last 7 days'
    case '30d': return 'Last 30 days'
    default:    return 'Last 30 days'
  }
}

function shortRangeLabel(range: TimeRange, custom: CustomRange | null): string {
  if (range === 'custom' && custom) {
    const days = Math.max(1, Math.round((new Date(custom.to).getTime() - new Date(custom.from).getTime()) / 86_400_000))
    return `${days}d range`
  }
  return range
}

interface SearchFormProps {
  initialSearch: string
  hasActiveSearch: boolean
  onChange: (value: string) => void
  onClear: () => void
}

function SearchForm({ initialSearch, hasActiveSearch, onChange, onClear }: SearchFormProps) {
  const [value, setValue] = useState(initialSearch)

  // 300ms debounce on input → URL. Match traces UX.
  useEffect(() => {
    const id = setTimeout(() => {
      if (value !== initialSearch) onChange(value)
    }, 300)
    return () => clearTimeout(id)
    // initialSearch deliberately omitted: parent remounts via key= on URL
    // change which resets local state, so no second sync needed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-faint" />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setValue('')
              onClear()
            }
          }}
          placeholder="Search user ID…"
          className="w-full pl-8 pr-3 py-1.5 font-mono text-[12px] bg-bg-elev border border-border rounded-[6px] text-text placeholder:text-text-faint focus:outline-none focus:border-accent"
        />
      </div>
      {hasActiveSearch && (
        <button
          type="button"
          onClick={() => { setValue(''); onClear() }}
          className="font-mono text-[11px] text-text-faint hover:text-text transition-colors"
        >
          Clear
        </button>
      )}
    </div>
  )
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        })
      }}
      aria-label="Copy user ID"
      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-bg text-text-faint hover:text-text"
    >
      {copied ? <Check className="h-3 w-3 text-good" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}

export function UsersClient() {
  const router = useRouter()
  const sp = useSearchParams()
  const mounted = useMounted()

  // URL-backed filter state. Mirrors /requests pattern so users can share a
  // pre-filtered view.
  const search  = sp.get('search') ?? ''
  const sortBy  = (sp.get('sortBy') ?? 'cost') as SortBy
  const sortDir = (sp.get('sortDir') ?? 'desc') as SortDir
  const page    = Math.max(1, parseInt(sp.get('page') ?? '1', 10))
  const rangeParam = (sp.get('range') ?? DEFAULT_RANGE) as TimeRange
  const customFrom = sp.get('from')
  const customTo   = sp.get('to')
  const customRange: CustomRange | null =
    rangeParam === 'custom' && customFrom && customTo ? { from: customFrom, to: customTo } : null

  // Snapshot "now" at mount so the from-window is stable across re-renders.
  // Dashboard / requests use the same `mountNow` pattern — react-hooks/purity
  // forbids calling `Date.now()` inline in render.
  const [mountNow] = useState(() => Date.now())

  // Resolve range → from/to ISO bounds. Custom uses URL directly.
  const { fromIso, toIso } = useMemo(() => {
    if (rangeParam === 'custom' && customRange) {
      return { fromIso: customRange.from, toIso: customRange.to as string | undefined }
    }
    const hours = rangeToHours(rangeParam) ?? 24 * 30
    return {
      fromIso: new Date(mountNow - hours * 3_600_000).toISOString(),
      toIso: undefined as string | undefined,
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeParam, customRange?.from, customRange?.to, mountNow])

  const filters = useMemo(() => {
    const base: { page: number; limit: number; sortBy: SortBy; sortDir: SortDir; search?: string; from?: string; to?: string } = {
      page,
      limit: PAGE_SIZE,
      sortBy,
      sortDir,
      from: fromIso,
    }
    if (search) base.search = search
    if (toIso) base.to = toIso
    return base
  }, [page, search, sortBy, sortDir, fromIso, toIso])
  const { data, isLoading, isError } = useUsers(filters)

  const updateQuery = useCallback(function updateQuery(updates: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(updates)) {
      if (v == null || v === '') next.delete(k)
      else next.set(k, v)
    }
    router.replace(`/users?${next.toString()}`)
  }, [router, sp])

  function onSort(col: SortBy) {
    const nextDir: SortDir = sortBy === col && sortDir === 'desc' ? 'asc' : 'desc'
    updateQuery({ sortBy: col, sortDir: nextDir, page: null })
  }

  function onRangeChange(r: TimeRange) {
    if (r === 'custom') return  // handled by onCustomRange
    updateQuery({ range: r, from: null, to: null, page: null })
  }
  function onCustomRange(r: CustomRange) {
    updateQuery({ range: 'custom', from: r.from, to: r.to, page: null })
  }

  function onSearch(value: string) {
    updateQuery({ search: value.trim() || null, page: null })
  }

  const rows = data?.data ?? []
  const total = data?.meta.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // Keyboard nav on table — ↑/↓ focus rows, Enter navigates. Match traces.
  const [focusedIdx, setFocusedIdx] = useState(-1)
  const tableRef = useRef<HTMLDivElement>(null)
  function onTableKey(e: React.KeyboardEvent) {
    if (rows.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIdx((i) => Math.min(rows.length - 1, Math.max(0, i + 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIdx((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter' && focusedIdx >= 0 && focusedIdx < rows.length) {
      const row = rows[focusedIdx]
      if (row) router.push(`/users/${encodeURIComponent(row.user_id)}`)
    }
  }

  // CSV export — client-side, RFC 4180 escaping. Same shape as dashboard.
  function csvField(v: string | number): string {
    const s = String(v)
    return /["\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  function csvRow(cells: (string | number)[]): string {
    return cells.map(csvField).join(',')
  }
  function downloadFile(content: string, mime: string, ext: string) {
    const blob = new Blob([content], { type: `${mime};charset=utf-8;` })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const rangeSlug = shortRangeLabel(rangeParam, customRange).replace(/\s+/g, '-').toLowerCase()
    a.download = `spanlens-users-${rangeSlug}-${new Date().toISOString().slice(0, 10)}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }
  function exportCsv() {
    const lines: string[] = []
    lines.push(csvRow([`Users (${shortRangeLabel(rangeParam, customRange)})`]))
    lines.push(csvRow(['User ID', 'Requests', 'Errors', 'Tokens', 'Cost (USD)', 'Avg Latency (ms)', 'First Seen', 'Last Seen', 'Distinct Models']))
    for (const u of rows) {
      const cost = u.total_cost_usd != null ? Number(u.total_cost_usd) : 0
      const lat  = u.avg_latency_ms != null ? Math.round(Number(u.avg_latency_ms)) : ''
      lines.push(csvRow([
        u.user_id,
        u.total_requests,
        u.error_requests,
        u.total_tokens,
        cost.toFixed(5),
        lat,
        u.first_seen,
        u.last_seen,
        u.distinct_models,
      ]))
    }
    downloadFile(lines.join('\n'), 'text/csv', 'csv')
  }
  function exportJson() {
    downloadFile(JSON.stringify({ range: shortRangeLabel(rangeParam, customRange), users: rows }, null, 2), 'application/json', 'json')
  }
  const [exportOpen, setExportOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!exportOpen) return
    function onDown(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setExportOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [exportOpen])

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col min-h-screen">
      {/* Sticky topbar — same pattern as dashboard/requests/traces. */}
      <div className="sticky top-0 z-20 bg-bg">
        <Topbar crumbs={[{ label: 'Users' }]} />
        <h1 className="sr-only">Users</h1>
      </div>

      <div className="flex flex-col gap-6 px-[22px] py-[22px]">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-medium text-[20px] tracking-[-0.3px] text-text">Users</h2>
            <p className="font-mono text-[11.5px] text-text-faint mt-1.5">
              {sinceLabel(rangeParam, customRange)} · end-user attribution from{' '}
              <code className="bg-bg-elev px-1 py-px rounded text-text">x-spanlens-user</code> header.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="font-mono text-[11px] text-text-faint">
              {mounted && data ? `${total.toLocaleString()} user${total === 1 ? '' : 's'}` : ' '}
            </div>
            <div ref={exportRef} className="relative">
              <button
                type="button"
                onClick={() => setExportOpen((v) => !v)}
                disabled={rows.length === 0}
                className="font-mono text-[11px] text-text-muted hover:text-text border border-border rounded px-2.5 py-1 transition-colors disabled:opacity-40"
              >
                Export ▾
              </button>
              {exportOpen && (
                <div className="absolute right-0 top-full mt-1 z-30 bg-bg-elev border border-border rounded-md shadow-lg py-1 min-w-[110px]">
                  <button
                    type="button"
                    onClick={() => { setExportOpen(false); exportCsv() }}
                    className="block w-full px-3 py-1.5 text-left font-mono text-[11px] uppercase tracking-[0.04em] text-text-muted hover:text-text hover:bg-bg transition-colors"
                  >
                    CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => { setExportOpen(false); exportJson() }}
                    className="block w-full px-3 py-1.5 text-left font-mono text-[11px] uppercase tracking-[0.04em] text-text-muted hover:text-text hover:bg-bg transition-colors"
                  >
                    JSON
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Filter bar — key={search} remounts the form so the local input
            resets when URL search changes (e.g. back/forward navigation).
            Time range selector sits at the far right of this row. */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <SearchForm
              key={search}
              initialSearch={search}
              hasActiveSearch={!!search}
              onChange={onSearch}
              onClear={() => updateQuery({ search: null, page: null })}
            />
          </div>
          <TimeRangeSelector
            value={rangeParam}
            onChange={(v) => onRangeChange(v as TimeRange)}
            customRange={customRange}
            onCustomRange={onCustomRange}
          />
        </div>

        {/* Table — mobile hides Tokens & Avg latency cols; user ID expands. */}
        <div
          ref={tableRef}
          role="grid"
          tabIndex={0}
          onKeyDown={onTableKey}
          aria-label="Users table"
          className="border border-border rounded-[6px] overflow-hidden focus:outline-none focus:ring-1 focus:ring-accent-border"
        >
          {/* Header row */}
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr] sm:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-2.5 bg-bg-elev border-b border-border font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
            <span>User ID</span>
            <SortBtn label="Requests" col="requests" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
            <SortBtn label="Tokens" col="tokens" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="hidden sm:inline-flex" />
            <SortBtn label="Cost" col="cost" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
            <SortBtn label="Avg latency" col="latency" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="hidden sm:inline-flex" />
            <SortBtn label="Last seen" col="last_seen" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="justify-end" />
          </div>

          {/* Rows */}
          {(!mounted || isLoading) && (
            <div className="divide-y divide-border">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr] sm:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3">
                  <Skeleton className="h-3 w-40" />
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="h-3 w-14 hidden sm:block" />
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-12 hidden sm:block" />
                  <Skeleton className="h-3 w-20 justify-self-end" />
                </div>
              ))}
            </div>
          )}

          {mounted && !isLoading && isError && (
            <div className="px-4 py-12 text-center">
              <p className="font-mono text-[12px] text-text-muted">Failed to load users.</p>
            </div>
          )}

          {mounted && !isLoading && !isError && rows.length === 0 && (
            <div className="px-4 py-16 text-center">
              <UsersIcon className="mx-auto h-6 w-6 text-text-faint mb-3" />
              <p className="font-mono text-[12.5px] text-text mb-1.5">No users yet</p>
              <p className="font-mono text-[11px] text-text-faint max-w-md mx-auto mb-4">
                Tag your LLM calls with{' '}
                <code className="bg-bg-elev px-1 py-px rounded">x-spanlens-user</code> header (SDK:{' '}
                <code className="bg-bg-elev px-1 py-px rounded">withUser()</code> /{' '}
                <code className="bg-bg-elev px-1 py-px rounded">with_user()</code>) and they&apos;ll
                appear here.
              </p>
              <div className="flex items-center justify-center gap-3 flex-wrap">
                <Link
                  href="/docs/sdk"
                  className="font-mono text-[11px] px-2.5 py-1 rounded border border-border text-text-muted hover:text-text hover:border-border-strong transition-colors"
                >
                  SDK docs →
                </Link>
                <Link
                  href="/docs/features/users"
                  className="font-mono text-[11px] px-2.5 py-1 rounded border border-border text-text-muted hover:text-text hover:border-border-strong transition-colors"
                >
                  Users feature guide →
                </Link>
              </div>
            </div>
          )}

          {mounted && !isLoading && !isError && rows.length > 0 && (
            <div className="divide-y divide-border">
              {rows.map((u, idx) => {
                const isFocused = idx === focusedIdx
                const lat = u.avg_latency_ms != null ? Math.round(Number(u.avg_latency_ms)) : null
                const isSlow = lat != null && lat >= SLOW_LATENCY_MS
                return (
                  <div
                    key={u.user_id}
                    onMouseEnter={() => setFocusedIdx(idx)}
                    role="row"
                    aria-selected={isFocused}
                    className={cn(
                      'group relative grid grid-cols-[2fr_1fr_1fr_1fr] sm:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-3 items-center px-4 py-3 font-mono text-[12px] text-text transition-colors',
                      isFocused ? 'bg-bg-elev' : 'hover:bg-bg-elev',
                    )}
                  >
                    {/* Stretched overlay link: the row navigates to the user
                        without wrapping the row in an <a>. Wrapping would put
                        the copy button (a <button>) inside an anchor — invalid
                        HTML that triggers a hydration error. */}
                    <Link
                      href={`/users/${encodeURIComponent(u.user_id)}`}
                      aria-label={`Open user ${u.user_id}`}
                      className="absolute inset-0 z-[1]"
                    />
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="truncate">{u.user_id}</span>
                      <span className="relative z-[2]">
                        <CopyButton value={u.user_id} />
                      </span>
                    </span>
                    <span className="text-text-muted">
                      {fmtCount(u.total_requests)}
                      {u.error_requests > 0 && (
                        <span className="text-bad ml-1.5">· {u.error_requests} err</span>
                      )}
                    </span>
                    <span className="text-text-muted hidden sm:inline">{fmtCount(u.total_tokens)}</span>
                    <span>{fmtCost(u.total_cost_usd != null ? Number(u.total_cost_usd) : null)}</span>
                    <span className={cn('hidden sm:inline', isSlow ? 'text-accent' : 'text-text-muted')}>
                      {lat != null ? `${lat}ms` : '—'}
                    </span>
                    <span
                      className="text-text-faint text-right"
                      title={fmtAbsolute(u.last_seen)}
                    >
                      {fmtRelativeTime(u.last_seen)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Pagination — Page X of N · 50 / total, with First/Last buttons. */}
        {mounted && !isLoading && total > 0 && (
          <div className="flex items-center justify-between font-mono text-[11px] flex-wrap gap-3">
            <div className="text-text-faint">
              Page {page} of {lastPage} · {Math.min(PAGE_SIZE, rows.length)} / {total.toLocaleString()}
            </div>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => updateQuery({ page: null })}
                className="px-2.5 py-1.5 border border-border rounded-[6px] text-text hover:bg-bg-elev disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                First
              </button>
              <button
                disabled={page <= 1}
                onClick={() => updateQuery({ page: String(page - 1) })}
                className="px-3 py-1.5 border border-border rounded-[6px] text-text hover:bg-bg-elev disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Prev
              </button>
              <button
                disabled={page >= lastPage}
                onClick={() => updateQuery({ page: String(page + 1) })}
                className="px-3 py-1.5 border border-border rounded-[6px] text-text hover:bg-bg-elev disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
              <button
                disabled={page >= lastPage}
                onClick={() => updateQuery({ page: String(lastPage) })}
                className="px-2.5 py-1.5 border border-border rounded-[6px] text-text hover:bg-bg-elev disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Last
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

interface SortBtnProps {
  label: string
  col: SortBy
  sortBy: SortBy
  sortDir: SortDir
  onSort: (c: SortBy) => void
  className?: string
}

function SortBtn({ label, col, sortBy, sortDir, onSort, className }: SortBtnProps) {
  const active = sortBy === col
  return (
    <button
      type="button"
      onClick={() => onSort(col)}
      className={cn(
        'inline-flex items-center gap-1 text-left hover:text-text transition-colors',
        active ? 'text-text' : 'text-text-faint',
        className,
      )}
    >
      <span>{label}</span>
      {active ? (
        sortDir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-30" />
      )}
    </button>
  )
}
