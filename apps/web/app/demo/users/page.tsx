'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ArrowDown, Search, Users as UsersIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DEMO_REQUESTS } from '@/lib/demo-data'

// ─────────────────────────────────────────────────────────────────────────────
// Demo /users page — static mirror of the real /users surface.
// Aggregates DEMO_REQUESTS in-memory (group by user_id) and renders the same
// 6-column table layout as apps/web/app/(dashboard)/users/users-client.tsx.
// Read-only: no sorting / search / pagination wired (would just be visual
// noise for a marketing demo). Sales talking point is the row click-through
// to /demo/users/[userId].
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
  return new Date(iso).toLocaleDateString()
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

  return Array.from(grouped.entries())
    .map(([user_id, g]) => ({
      user_id,
      total_requests: g.requests,
      total_tokens: g.tokens,
      total_cost_usd: g.cost,
      avg_latency_ms: g.latencies.reduce((s, n) => s + n, 0) / g.latencies.length,
      error_requests: g.errors,
      distinct_models: g.models.size,
      first_seen: g.firstSeen,
      last_seen: g.lastSeen,
    }))
    .sort((a, b) => b.total_cost_usd - a.total_cost_usd)
}

export default function DemoUsersPage() {
  const rows = useMemo(() => aggregate(), [])
  const [now] = useState(() => Date.now())
  const total = rows.length

  return (
    <div className="space-y-6 px-6 py-6 max-w-[1200px] mx-auto">
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
          {total} user{total === 1 ? '' : 's'}
        </div>
      </div>

      {/* Filter bar (read-only on demo) */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-faint" />
          <input
            disabled
            placeholder="Search user ID…"
            className="w-full pl-8 pr-3 py-1.5 font-mono text-[12px] bg-bg-elev border border-border rounded-[6px] text-text placeholder:text-text-faint focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      {/* Table */}
      <div className="border border-border rounded-[6px] overflow-hidden">
        {/* Header row */}
        <div className="grid grid-cols-[2fr,1fr,1fr,1fr,1fr,1fr] gap-3 px-4 py-2.5 bg-bg-elev border-b border-border font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
          <span>User ID</span>
          <span>Requests</span>
          <span>Tokens</span>
          <span className="inline-flex items-center gap-1 text-text">
            Cost <ArrowDown className="h-3 w-3" />
          </span>
          <span>Avg latency</span>
          <span className="justify-self-end">Last seen</span>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <UsersIcon className="mx-auto h-6 w-6 text-text-faint mb-3" />
            <p className="font-mono text-[12.5px] text-text mb-1.5">No users yet</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((u) => (
              <Link
                key={u.user_id}
                href={`/demo/users/${encodeURIComponent(u.user_id)}`}
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
                <span>{fmtCost(u.total_cost_usd)}</span>
                <span className="text-text-muted">{Math.round(u.avg_latency_ms)}ms</span>
                <span className="text-text-faint text-right">{fmtRelativeTime(u.last_seen, now)}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <p className={cn('font-mono text-[11px] text-text-faint')}>
        Demo data · in production this view comes from <code className="bg-bg-elev px-1 py-px rounded">GET /api/v1/users</code> (RPC-backed aggregate).
      </p>
    </div>
  )
}
