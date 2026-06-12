'use client'

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, ArrowUpDown, Check, Copy, Search, MessagesSquare } from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import { cn, formatDate } from '@/lib/utils'
import { useSessions } from '@/lib/queries/use-sessions'
import { Topbar, TimeRangeSelector, type CustomRange } from '@/components/layout/topbar'

// Hydration-safe "is this the client?" gate. Same pattern as users/requests.
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

import { fmtCostSummary as fmtCost } from '@/lib/format'

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

interface SearchFormProps {
  initialSearch: string
  hasActiveSearch: boolean
  onChange: (value: string) => void
  onClear: () => void
}

function SearchForm({ initialSearch, hasActiveSearch, onChange, onClear }: SearchFormProps) {
  const [value, setValue] = useState(initialSearch)

  // 300ms debounce on input → URL. Matches /users + /traces UX and avoids the
  // focus loss that a per-keystroke router.replace + key= remount would cause.
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
          placeholder="Search session ID…"
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
      aria-label="Copy session ID"
      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-bg text-text-faint hover:text-text"
    >
      {copied ? <Check className="h-3 w-3 text-good" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}

export function SessionsClient() {
  const router = useRouter()
  const sp = useSearchParams()
  const mounted = useMounted()

  // URL-backed filter state. Mirrors /users so a filtered view is shareable.
  const search  = sp.get('search') ?? ''
  const userId  = sp.get('userId') ?? ''
  const sortBy  = (sp.get('sortBy') ?? 'last_seen') as SortBy
  const sortDir = (sp.get('sortDir') ?? 'desc') as SortDir
  const page    = Math.max(1, parseInt(sp.get('page') ?? '1', 10))
  const rangeParam = (sp.get('range') ?? DEFAULT_RANGE) as TimeRange
  const customFrom = sp.get('from')
  const customTo   = sp.get('to')
  const customRange: CustomRange | null =
    rangeParam === 'custom' && customFrom && customTo ? { from: customFrom, to: customTo } : null

  const [mountNow] = useState(() => Date.now())

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
    const base: {
      page: number; limit: number; sortBy: SortBy; sortDir: SortDir
      search?: string; userId?: string; from?: string; to?: string
    } = { page, limit: PAGE_SIZE, sortBy, sortDir, from: fromIso }
    if (search) base.search = search
    if (userId) base.userId = userId
    if (toIso) base.to = toIso
    return base
  }, [page, search, userId, sortBy, sortDir, fromIso, toIso])
  const { data, isLoading, isError } = useSessions(filters)

  const updateQuery = useCallback(function updateQuery(updates: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(updates)) {
      if (v == null || v === '') next.delete(k)
      else next.set(k, v)
    }
    router.replace(`/sessions?${next.toString()}`)
  }, [router, sp])

  function onSort(col: SortBy) {
    const nextDir: SortDir = sortBy === col && sortDir === 'desc' ? 'asc' : 'desc'
    updateQuery({ sortBy: col, sortDir: nextDir, page: null })
  }

  function onRangeChange(r: TimeRange) {
    if (r === 'custom') return
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

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col min-h-screen">
      <div className="sticky top-0 z-20 bg-bg">
        <Topbar crumbs={[{ label: 'Sessions' }]} />
        <h1 className="sr-only">Sessions</h1>
      </div>

      <div className="flex flex-col gap-6 px-[22px] py-[22px]">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-medium text-[20px] tracking-[-0.3px] text-text">Sessions</h2>
            <p className="font-mono text-[11.5px] text-text-faint mt-1.5">
              {sinceLabel(rangeParam, customRange)} · conversation threads from{' '}
              <code className="bg-bg-elev px-1 py-px rounded text-text">x-spanlens-session</code> header.
            </p>
          </div>
          <div className="font-mono text-[11px] text-text-faint shrink-0">
            {mounted && data ? `${total.toLocaleString()} session${total === 1 ? '' : 's'}` : ' '}
          </div>
        </div>

        {/* Active userId filter banner */}
        {userId && (
          <div className="flex items-center gap-2 font-mono text-[11px]">
            <span className="text-text-faint uppercase tracking-[0.05em] text-[10px]">Filter:</span>
            <span className="px-2 py-[2px] bg-bg-elev border border-border rounded-[3px] text-text">
              user: {userId}
            </span>
            <button
              type="button"
              onClick={() => updateQuery({ userId: null, page: null })}
              className="text-text-faint hover:text-text"
            >
              Clear ×
            </button>
          </div>
        )}

        {/* Filter bar */}
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

        {/* Table */}
        <div
          role="grid"
          aria-label="Sessions table"
          className="border border-border rounded-[6px] overflow-hidden"
        >
          {/* Header row */}
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr] sm:grid-cols-[2fr_1.2fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-2.5 bg-bg-elev border-b border-border font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
            <span>Session ID</span>
            <span className="hidden sm:inline">User</span>
            <SortBtn label="Turns" col="requests" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
            <SortBtn label="Cost" col="cost" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
            <SortBtn label="Avg latency" col="latency" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="hidden sm:inline-flex" />
            <SortBtn label="Last seen" col="last_seen" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="justify-end" />
          </div>

          {(!mounted || isLoading) && (
            <div className="divide-y divide-border">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr] sm:grid-cols-[2fr_1.2fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3">
                  <Skeleton className="h-3 w-40" />
                  <Skeleton className="h-3 w-24 hidden sm:block" />
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-12 hidden sm:block" />
                  <Skeleton className="h-3 w-20 justify-self-end" />
                </div>
              ))}
            </div>
          )}

          {mounted && !isLoading && isError && (
            <div className="px-4 py-12 text-center">
              <p className="font-mono text-[12px] text-text-muted">Failed to load sessions.</p>
            </div>
          )}

          {mounted && !isLoading && !isError && rows.length === 0 && (
            <div className="px-4 py-16 text-center">
              <MessagesSquare className="mx-auto h-6 w-6 text-text-faint mb-3" />
              <p className="font-mono text-[12.5px] text-text mb-1.5">No sessions yet</p>
              <p className="font-mono text-[11px] text-text-faint max-w-md mx-auto mb-4">
                Tag your LLM calls with the{' '}
                <code className="bg-bg-elev px-1 py-px rounded">x-spanlens-session</code> header (SDK:{' '}
                <code className="bg-bg-elev px-1 py-px rounded">withSession()</code>) and conversation
                threads will appear here.
              </p>
              <div className="flex items-center justify-center gap-3 flex-wrap">
                <Link
                  href="/docs/sdk"
                  className="font-mono text-[11px] px-2.5 py-1 rounded border border-border text-text-muted hover:text-text hover:border-border-strong transition-colors"
                >
                  SDK docs →
                </Link>
              </div>
            </div>
          )}

          {mounted && !isLoading && !isError && rows.length > 0 && (
            <div className="divide-y divide-border">
              {rows.map((s) => {
                const lat = s.avg_latency_ms != null ? Math.round(Number(s.avg_latency_ms)) : null
                const isSlow = lat != null && lat >= SLOW_LATENCY_MS
                return (
                  <div
                    key={s.session_id}
                    role="row"
                    className="group relative grid grid-cols-[2fr_1fr_1fr_1fr] sm:grid-cols-[2fr_1.2fr_1fr_1fr_1fr_1fr] gap-3 items-center px-4 py-3 font-mono text-[12px] text-text hover:bg-bg-elev transition-colors"
                  >
                    {/* Stretched overlay link: the whole row navigates to the
                        session without wrapping the row in an <a>. Wrapping
                        would nest the user link and copy button inside an
                        anchor — invalid HTML that triggers a hydration error.
                        Interactive children sit above this overlay via z-index. */}
                    <Link
                      href={`/sessions/${encodeURIComponent(s.session_id)}`}
                      aria-label={`Open session ${s.session_id}`}
                      className="absolute inset-0 z-[1]"
                    />
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="truncate">{s.session_id}</span>
                      <span className="relative z-[2]">
                        <CopyButton value={s.session_id} />
                      </span>
                    </span>
                    <span className="text-text-muted truncate hidden sm:block">
                      {s.user_id ? (
                        <Link
                          href={`/users/${encodeURIComponent(s.user_id)}`}
                          className="relative z-[2] hover:underline"
                        >
                          {s.user_id}
                        </Link>
                      ) : '—'}
                    </span>
                    <span className="text-text-muted">
                      {fmtCount(s.total_requests)}
                      {s.error_requests > 0 && (
                        <span className="text-bad ml-1.5">· {s.error_requests} err</span>
                      )}
                    </span>
                    <span>{fmtCost(s.total_cost_usd)}</span>
                    <span className={cn('hidden sm:inline', isSlow ? 'text-accent' : 'text-text-muted')}>
                      {lat != null ? `${lat}ms` : '—'}
                    </span>
                    <span className="text-text-faint text-right" title={fmtAbsolute(s.last_seen)}>
                      {fmtRelativeTime(s.last_seen)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Pagination */}
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
