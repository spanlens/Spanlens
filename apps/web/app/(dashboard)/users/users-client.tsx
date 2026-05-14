'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Search, Users as UsersIcon } from 'lucide-react'

// TODO: re-add `usePostHog()` + `users_page_viewed` / `users_row_clicked`
// capture once PostHog provider lands on main. Event payloads designed
// in docs/launch/2026-05-14_cache-stream-users.md §3.
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useUsers } from '@/lib/queries/use-users'

type SortBy = 'cost' | 'requests' | 'tokens' | 'last_seen'
type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 50

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
  return new Date(iso).toLocaleDateString()
}

export function UsersClient() {
  const router = useRouter()
  const sp = useSearchParams()

  // URL-backed filter state. Mirrors /requests pattern so users can share a
  // pre-filtered view.
  const search  = sp.get('search') ?? ''
  const sortBy  = (sp.get('sortBy') ?? 'cost') as SortBy
  const sortDir = (sp.get('sortDir') ?? 'desc') as SortDir
  const page    = Math.max(1, parseInt(sp.get('page') ?? '1', 10))

  const [searchInput, setSearchInput] = useState(search)
  // Sync URL → input when the user navigates back/forward.
  useEffect(() => setSearchInput(search), [search])

  const filters = useMemo(() => {
    const base: { page: number; limit: number; sortBy: SortBy; sortDir: SortDir; search?: string } = {
      page,
      limit: PAGE_SIZE,
      sortBy,
      sortDir,
    }
    if (search) base.search = search
    return base
  }, [page, search, sortBy, sortDir])
  const { data, isLoading, isError } = useUsers(filters)

  function updateQuery(updates: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(updates)) {
      if (v == null || v === '') next.delete(k)
      else next.set(k, v)
    }
    router.replace(`/users?${next.toString()}`)
  }

  function onSort(col: SortBy) {
    const nextDir: SortDir = sortBy === col && sortDir === 'desc' ? 'asc' : 'desc'
    updateQuery({ sortBy: col, sortDir: nextDir, page: null })
  }

  function onSubmitSearch(e: React.FormEvent) {
    e.preventDefault()
    updateQuery({ search: searchInput.trim() || null, page: null })
  }

  const rows = data?.data ?? []
  const total = data?.meta.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-medium text-[20px] tracking-[-0.3px] text-text">Users</h1>
          <p className="font-mono text-[11.5px] text-text-faint mt-1.5">
            End-user attribution from{' '}
            <code className="bg-bg-elev px-1 py-px rounded text-text">x-spanlens-user</code> header.
            Sorted by total cost.
          </p>
        </div>
        <div className="font-mono text-[11px] text-text-faint">
          {data ? `${total.toLocaleString()} user${total === 1 ? '' : 's'}` : ''}
        </div>
      </div>

      {/* Filter bar */}
      <form onSubmit={onSubmitSearch} className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-faint" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search user ID…"
            className="w-full pl-8 pr-3 py-1.5 font-mono text-[12px] bg-bg-elev border border-border rounded-[6px] text-text placeholder:text-text-faint focus:outline-none focus:border-accent"
          />
        </div>
        {search && (
          <button
            type="button"
            onClick={() => updateQuery({ search: null, page: null })}
            className="font-mono text-[11px] text-text-faint hover:text-text transition-colors"
          >
            Clear
          </button>
        )}
      </form>

      {/* Table */}
      <div className="border border-border rounded-[6px] overflow-hidden">
        {/* Header row */}
        <div className="grid grid-cols-[2fr,1fr,1fr,1fr,1fr,1fr] gap-3 px-4 py-2.5 bg-bg-elev border-b border-border font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
          <span>User ID</span>
          <SortBtn label="Requests" col="requests" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
          <SortBtn label="Tokens" col="tokens" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
          <SortBtn label="Cost" col="cost" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
          <span>Avg latency</span>
          <SortBtn label="Last seen" col="last_seen" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="justify-end" />
        </div>

        {/* Rows */}
        {isLoading && (
          <div className="divide-y divide-border">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="grid grid-cols-[2fr,1fr,1fr,1fr,1fr,1fr] gap-3 px-4 py-3">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-3 w-20 justify-self-end" />
              </div>
            ))}
          </div>
        )}

        {!isLoading && isError && (
          <div className="px-4 py-12 text-center">
            <p className="font-mono text-[12px] text-text-muted">Failed to load users.</p>
          </div>
        )}

        {!isLoading && !isError && rows.length === 0 && (
          <div className="px-4 py-16 text-center">
            <UsersIcon className="mx-auto h-6 w-6 text-text-faint mb-3" />
            <p className="font-mono text-[12.5px] text-text mb-1.5">No users yet</p>
            <p className="font-mono text-[11px] text-text-faint max-w-md mx-auto">
              Tag your LLM calls with{' '}
              <code className="bg-bg-elev px-1 py-px rounded">x-spanlens-user</code> header (SDK:{' '}
              <code className="bg-bg-elev px-1 py-px rounded">withUser()</code> /{' '}
              <code className="bg-bg-elev px-1 py-px rounded">with_user()</code>) and they&apos;ll
              appear here.
            </p>
          </div>
        )}

        {!isLoading && !isError && rows.length > 0 && (
          <div className="divide-y divide-border">
            {rows.map((u) => (
              <Link
                key={u.user_id}
                href={`/users/${encodeURIComponent(u.user_id)}`}
                className="grid grid-cols-[2fr,1fr,1fr,1fr,1fr,1fr] gap-3 items-center px-4 py-3 font-mono text-[12px] text-text hover:bg-bg-elev transition-colors"
              >
                <span className="truncate">{u.user_id}</span>
                <span className="text-text-muted">
                  {fmtCount(u.total_requests)}
                  {u.error_requests > 0 && (
                    <span className="text-bad ml-1.5">· {u.error_requests} err</span>
                  )}
                </span>
                <span className="text-text-muted">{fmtCount(u.total_tokens)}</span>
                <span>{fmtCost(u.total_cost_usd ? Number(u.total_cost_usd) : null)}</span>
                <span className="text-text-muted">
                  {u.avg_latency_ms != null ? `${Math.round(Number(u.avg_latency_ms))}ms` : '—'}
                </span>
                <span className="text-text-faint text-right">{fmtRelativeTime(u.last_seen)}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {!isLoading && total > PAGE_SIZE && (
        <div className="flex items-center justify-between font-mono text-[11px]">
          <div className="text-text-faint">
            Page {page} of {lastPage}
          </div>
          <div className="flex gap-2">
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
          </div>
        </div>
      )}
    </div>
  )
}

function SortBtn({
  label, col, sortBy, sortDir, onSort, className,
}: {
  label: string
  col: SortBy
  sortBy: SortBy
  sortDir: SortDir
  onSort: (c: SortBy) => void
  className?: string
}) {
  const active = sortBy === col
  return (
    <button
      onClick={() => onSort(col)}
      className={cn(
        'inline-flex items-center gap-1 text-left hover:text-text transition-colors',
        active ? 'text-text' : 'text-text-faint',
        className,
      )}
    >
      <span>{label}</span>
      {active && (sortDir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
    </button>
  )
}
