'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { usePostHog } from 'posthog-js/react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useUserDetail } from '@/lib/queries/use-users'

function fmtCost(n: number | null | undefined): string {
  if (n == null) return '—'
  return '$' + Number(n).toFixed(6)
}

function fmtCount(n: number): string {
  return n.toLocaleString()
}

export function UserDetailClient({ userId }: { userId: string }) {
  const { data, isLoading, isError } = useUserDetail(userId)
  const ph = usePostHog()

  useEffect(() => {
    if (!ph) return
    ph.capture('user_detail_viewed', { user_id: userId })
  }, [ph, userId])

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="space-y-6">
        <Link
          href="/users"
          className="inline-flex items-center gap-1.5 font-mono text-[12px] text-text-muted hover:text-text transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to users
        </Link>
        <div className="border border-border rounded-[6px] p-8 text-center bg-bg-elev">
          <p className="font-mono text-[13px] text-text mb-1.5">User not found</p>
          <p className="font-mono text-[11.5px] text-text-faint">
            This user has no logged requests in your organization.
          </p>
        </div>
      </div>
    )
  }

  const stats = [
    { label: 'Requests', value: fmtCount(data.total_requests) },
    { label: 'Total tokens', value: fmtCount(data.total_tokens) },
    { label: 'Total cost', value: fmtCost(data.total_cost_usd ? Number(data.total_cost_usd) : null) },
    {
      label: 'Avg latency',
      value: data.avg_latency_ms != null ? `${Math.round(Number(data.avg_latency_ms))} ms` : '—',
    },
    { label: 'Error count', value: fmtCount(data.error_requests), warn: data.error_requests > 0 },
    { label: 'Distinct models', value: fmtCount(data.distinct_models) },
    {
      label: 'First seen',
      value: data.first_seen ? new Date(data.first_seen).toLocaleDateString() : '—',
    },
    {
      label: 'Last seen',
      value: data.last_seen ? new Date(data.last_seen).toLocaleDateString() : '—',
    },
  ]

  return (
    <div className="space-y-6">
      <Link
        href="/users"
        className="inline-flex items-center gap-1.5 font-mono text-[12px] text-text-muted hover:text-text transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to users
      </Link>

      <div>
        <h1 className="font-mono text-[18px] tracking-[-0.2px] text-text break-all">
          {data.user_id}
        </h1>
        <p className="font-mono text-[11px] text-text-faint mt-1.5">
          End-user analytics · all requests tagged with this <code className="bg-bg-elev px-1 py-px rounded">x-spanlens-user</code> value
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map(({ label, value, warn }) => (
          <div key={label} className="border border-border rounded-[6px] px-4 py-3 bg-bg-elev">
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-1.5">
              {label}
            </div>
            <div className={cn('font-mono text-[13px] font-medium truncate', warn ? 'text-accent' : 'text-text')}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Recent requests */}
      <div>
        <h2 className="font-mono text-[11px] uppercase tracking-[0.05em] text-text-faint mb-3">
          Recent requests
        </h2>
        <div className="border border-border rounded-[6px] overflow-hidden">
          <div className="grid grid-cols-[1fr,1fr,1fr,1fr,1fr] gap-3 px-4 py-2.5 bg-bg-elev border-b border-border font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
            <span>Time</span>
            <span>Model</span>
            <span>Tokens</span>
            <span>Cost</span>
            <span>Status</span>
          </div>
          {data.recent_requests.length === 0 ? (
            <div className="px-4 py-12 text-center font-mono text-[12px] text-text-muted">
              No requests in the selected period.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {data.recent_requests.map((r) => {
                const isErr = r.status_code >= 400
                const cacheRead = r.cache_read_tokens ?? 0
                return (
                  <Link
                    key={r.id}
                    href={`/requests/${r.id}`}
                    className="grid grid-cols-[1fr,1fr,1fr,1fr,1fr] gap-3 items-center px-4 py-2.5 font-mono text-[12px] text-text hover:bg-bg-elev transition-colors"
                  >
                    <span className="text-text-muted">
                      {new Date(r.created_at).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <span className="truncate">{r.model}</span>
                    <span className="text-text-muted">
                      {r.total_tokens.toLocaleString()}
                      {cacheRead > 0 && (
                        <span className="text-text-faint ml-1.5">· {cacheRead.toLocaleString()} cached</span>
                      )}
                    </span>
                    <span>{fmtCost(r.cost_usd)}</span>
                    <span className={isErr ? 'text-bad' : 'text-good'}>{r.status_code}</span>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
