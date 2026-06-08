'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useHydrationSafeNow } from '@/lib/hydration-safe-now'
import { ArrowDown, ArrowUp, ArrowUpDown, Check, Copy, Search, Users as UsersIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Topbar } from '@/components/layout/topbar'
import { DemoExportButton } from '@/components/ui/demo-export-button'
import { DEMO_REQUESTS } from '@/lib/demo-data'

// ─────────────────────────────────────────────────────────────────────────────
// Demo /users page — interactive mirror of the real /users surface.
// Aggregates DEMO_REQUESTS in-memory (group by user_id) and renders the same
// 6-column table as apps/web/app/(dashboard)/users/users-client.tsx, with the
// same read-side interactivity: search, clickable column sort, copy-id, mobile
// column collapse, and client-side CSV/JSON export.
// ─────────────────────────────────────────────────────────────────────────────

function fmtCost(n: number): string {
  if (n === 0) return '$0.00'
  return n < 0.01 ? '< $0.01' : '$' + n.toFixed(2)
}

function fmtCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return String(n)
}

function fmtRelativeTime(iso: string, now: number): string {
  const d = new Date(iso).getTime()
  const diff = now - d
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

interface UserAggregate {
  user_id: string
  total_requests: number
  total_tokens: number
  total_cost_usd: number
  avg_latency_ms: number
  error_requests: number
  distinct_models: number
  first_seen: string
  last_seen: string
}

function aggregate(): UserAggregate[] {
  const grouped = new Map<string, {
    requests: number
    tokens: number
    cost: number
    latencies: number[]
    errors: number
    models: Set<string>
    firstSeen: string
    lastSeen: string
  }>()

  for (const r of DEMO_REQUESTS) {
    if (!r.user_id) continue
    const existing = grouped.get(r.user_id) ?? {
      requests: 0,
      tokens: 0,
      cost: 0,
      latencies: [] as number[],
      errors: 0,
      models: new Set<string>(),
      firstSeen: r.created_at,
      lastSeen: r.created_at,
    }
    existing.requests += 1
    existing.tokens += r.total_tokens
    existing.cost += r.cost_usd ?? 0
    existing.latencies.push(r.latency_ms)
    if (r.status_code >= 400) existing.errors += 1
    existing.models.add(r.model)
    if (r.created_at < existing.firstSeen) existing.firstSeen = r.created_at
    if (r.created_at > existing.lastSeen) existing.lastSeen = r.created_at
    grouped.set(r.user_id, existing)
  }

  const out: UserAggregate[] = []
  for (const [user_id, g] of grouped) {
    out.push({
      user_id,
      total_requests: g.requests,
      total_tokens: g.tokens,
      total_cost_usd: g.cost,
      avg_latency_ms: g.latencies.reduce((a, b) => a + b, 0) / g.latencies.length,
      error_requests: g.errors,
      distinct_models: g.models.size,
      first_seen: g.firstSeen,
      last_seen: g.lastSeen,
    })
  }
  return out
}

type SortKey = 'total_requests' | 'total_tokens' | 'total_cost_usd' | 'avg_latency_ms' | 'last_seen'
type SortDir = 'asc' | 'desc'

function CopyIdButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          },
          () => {},
        )
      }}
      aria-label="Copy user ID"
      className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-text-faint hover:text-text transition-opacity shrink-0"
    >
      {copied ? <Check className="h-3 w-3 text-good" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}

function SortBtn({
  label,
  col,
  sortKey,
  sortDir,
  onSort,
  align = 'left',
}: {
  label: string
  col: SortKey
  sortKey: SortKey
  sortDir: SortDir
  onSort: (k: SortKey) => void
  align?: 'left' | 'right'
}) {
  const active = sortKey === col
  return (
    <button
      type="button"
      onClick={() => onSort(col)}
      className={cn(
        'inline-flex items-center gap-1 hover:text-text transition-colors',
        active ? 'text-text' : 'text-text-faint',
        align === 'right' && 'justify-self-end',
      )}
    >
      {label}
      {active ? (
        sortDir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  )
}

export default function DemoUsersPage() {
  const all = useMemo(() => aggregate(), [])
  const now = useHydrationSafeNow()
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('total_cost_usd')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  function onSort(k: SortKey) {
    if (k === sortKey) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(k)
      setSortDir('desc')
    }
  }

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q ? all.filter((u) => u.user_id.toLowerCase().includes(q)) : all
    const sorted = [...filtered].sort((a, b) => {
      let av: number
      let bv: number
      if (sortKey === 'last_seen') {
        av = new Date(a.last_seen).getTime()
        bv = new Date(b.last_seen).getTime()
      } else {
        av = a[sortKey]
        bv = b[sortKey]
      }
      return sortDir === 'desc' ? bv - av : av - bv
    })
    return sorted
  }, [all, query, sortKey, sortDir])

  const total = all.length
  const isFiltered = query.trim().length > 0

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col min-h-screen">
      <div className="sticky top-0 z-20 bg-bg">
        <Topbar
          crumbs={[{ label: 'Demo', href: '/demo/dashboard' }, { label: 'Users' }]}
        />
      </div>

      {/* Header */}
      <div className="px-[22px] py-[18px] border-b border-border">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="font-medium text-[20px] tracking-[-0.3px] text-text">Users</h1>
          <span className="font-mono text-[11px] text-text-faint">
            {isFiltered ? `${rows.length} of ${total}` : `${total} user${total === 1 ? '' : 's'}`}
          </span>
        </div>
        <p className="font-mono text-[11.5px] text-text-faint mt-1.5">
          End-user attribution from{' '}
          <code className="bg-bg-elev px-1 py-px rounded text-text">x-spanlens-user</code> header.
        </p>
      </div>

      {/* Filter bar */}
      <div className="px-[22px] py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('')
              }}
              placeholder="Search user ID…"
              className="w-full pl-8 pr-8 py-1.5 font-mono text-[12px] bg-bg-elev border border-border rounded-[6px] text-text placeholder:text-text-faint focus:outline-none focus:border-accent"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-faint hover:text-text transition-colors"
              >
                ✕
              </button>
            )}
          </div>
          <DemoExportButton
            base="users"
            rows={rows}
            columns={[
              { header: 'User ID', value: (u: UserAggregate) => u.user_id },
              { header: 'Requests', value: (u: UserAggregate) => u.total_requests },
              { header: 'Tokens', value: (u: UserAggregate) => u.total_tokens },
              { header: 'Cost USD', value: (u: UserAggregate) => u.total_cost_usd.toFixed(6) },
              { header: 'Avg latency ms', value: (u: UserAggregate) => Math.round(u.avg_latency_ms) },
              { header: 'Errors', value: (u: UserAggregate) => u.error_requests },
              { header: 'Last seen', value: (u: UserAggregate) => u.last_seen },
            ]}
          />
        </div>
      </div>

      {/* Table */}
      <div className="px-[22px] py-4">
        <div className="border border-border rounded-[6px] overflow-hidden">
          {/* Header row */}
          <div className="grid grid-cols-[2fr,1fr,1fr,1fr] sm:grid-cols-[2fr,1fr,1fr,1fr,1fr,1fr] gap-3 px-4 py-2.5 bg-bg-elev border-b border-border font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
            <span>User ID</span>
            <SortBtn label="Requests" col="total_requests" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <span className="hidden sm:block">
              <SortBtn label="Tokens" col="total_tokens" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            </span>
            <SortBtn label="Cost" col="total_cost_usd" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <span className="hidden sm:block">
              <SortBtn label="Avg latency" col="avg_latency_ms" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            </span>
            <SortBtn label="Last seen" col="last_seen" sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
          </div>

          {rows.length === 0 ? (
            <div className="px-4 py-16 text-center">
              <UsersIcon className="mx-auto h-6 w-6 text-text-faint mb-3" />
              <p className="font-mono text-[12.5px] text-text mb-1.5">
                {isFiltered ? 'No users match your search' : 'No users yet'}
              </p>
              {isFiltered && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="font-mono text-[11px] text-accent hover:opacity-80 transition-opacity"
                >
                  Clear search
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {rows.map((u) => (
                <Link
                  key={u.user_id}
                  href={`/demo/users/${encodeURIComponent(u.user_id)}`}
                  className="group grid grid-cols-[2fr,1fr,1fr,1fr] sm:grid-cols-[2fr,1fr,1fr,1fr,1fr,1fr] gap-3 items-center px-4 py-3 font-mono text-[12px] text-text hover:bg-bg-elev transition-colors"
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="truncate text-text">{u.user_id}</span>
                    <CopyIdButton value={u.user_id} />
                    {u.error_requests > 0 && (
                      <span className="text-bad shrink-0">· {u.error_requests} err</span>
                    )}
                  </span>
                  <span className="text-text-muted">{fmtCount(u.total_requests)}</span>
                  <span className="hidden sm:block text-text-muted">{fmtCount(u.total_tokens)}</span>
                  <span>{fmtCost(u.total_cost_usd)}</span>
                  <span className="hidden sm:block text-text-muted">{Math.round(u.avg_latency_ms)}ms</span>
                  <span className="text-text-faint text-right">{fmtRelativeTime(u.last_seen, now)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <p className={cn('font-mono text-[11px] text-text-faint mt-4')}>
          Demo data · in production this view comes from <code className="bg-bg-elev px-1 py-px rounded">GET /api/v1/users</code> (RPC-backed aggregate).
        </p>
      </div>
    </div>
  )
}
