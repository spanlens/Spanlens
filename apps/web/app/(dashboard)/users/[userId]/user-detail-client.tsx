'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Check, Copy } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn, formatDate } from '@/lib/utils'
import { useUserDetail } from '@/lib/queries/use-users'
import { Topbar } from '@/components/layout/topbar'

// TODO: re-add `usePostHog()` + `user_detail_viewed` capture once the
// PostHog provider lands on main (separate PR).

function fmtCost(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n === 0) return '$0.00'
  return n < 0.01 ? '< $0.01' : '$' + Number(n).toFixed(2)
}

function fmtCount(n: number): string {
  return n.toLocaleString()
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        })
      }}
      aria-label="Copy user ID"
      className="p-1 rounded hover:bg-bg-elev text-text-faint hover:text-text transition-colors"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-good" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

export function UserDetailClient({ userId }: { userId: string }) {
  const { data, isLoading, isError } = useUserDetail(userId)

  const crumbs = [
    { label: 'Users', href: '/users' },
    { label: userId },
  ]

  if (isLoading) {
    return (
      <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col min-h-screen">
        <div className="sticky top-0 z-20 bg-bg">
          <Topbar crumbs={crumbs} />
        </div>
        <div className="flex flex-col gap-6 px-[22px] py-[22px]">
          <Skeleton className="h-8 w-64" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
          <Skeleton className="h-96" />
        </div>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col min-h-screen">
        <div className="sticky top-0 z-20 bg-bg">
          <Topbar crumbs={crumbs} />
        </div>
        <div className="flex flex-col gap-6 px-[22px] py-[22px]">
          <div className="border border-border rounded-[6px] p-8 text-center bg-bg-elev">
            <p className="font-mono text-[13px] text-text mb-1.5">User not found</p>
            <p className="font-mono text-[11.5px] text-text-faint">
              This user has no logged requests in your organization.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const stats: ReadonlyArray<{ label: string; value: string; bad?: boolean }> = [
    { label: 'Requests', value: fmtCount(data.total_requests) },
    { label: 'Total tokens', value: fmtCount(data.total_tokens) },
    { label: 'Total cost', value: fmtCost(data.total_cost_usd != null ? Number(data.total_cost_usd) : null) },
    {
      label: 'Avg latency',
      value: data.avg_latency_ms != null ? `${Math.round(Number(data.avg_latency_ms))} ms` : '—',
    },
    // Error count now uses text-bad (red) when > 0, matching the row callouts
    // on the list page. text-accent (orange) collides visually with anomaly /
    // savings cards elsewhere in the dashboard.
    { label: 'Error count', value: fmtCount(data.error_requests), bad: data.error_requests > 0 },
    { label: 'Distinct models', value: fmtCount(data.distinct_models) },
    {
      label: 'First seen',
      // formatDate pins locale to en-US — see CLAUDE.md gotcha #22.
      value: data.first_seen ? formatDate(data.first_seen) : '—',
    },
    {
      label: 'Last seen',
      value: data.last_seen ? formatDate(data.last_seen) : '—',
    },
  ]

  const recentCount = data.recent_requests.length
  const hasMore = data.total_requests > recentCount

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col min-h-screen">
      <div className="sticky top-0 z-20 bg-bg">
        <Topbar crumbs={crumbs} />
        <h1 className="sr-only">{userId}</h1>
      </div>

      <div className="flex flex-col gap-6 px-[22px] py-[22px]">
        {/* Header — user ID + copy + jump-to-requests CTA */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-mono text-[18px] tracking-[-0.2px] text-text break-all">
              {data.user_id}
            </h2>
            <CopyButton value={data.user_id} />
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="font-mono text-[11px] text-text-faint">
              End-user analytics · all requests tagged with this <code className="bg-bg-elev px-1 py-px rounded">x-spanlens-user</code> value
            </p>
            {data.total_requests > 0 && (
              <Link
                href={`/requests?userId=${encodeURIComponent(data.user_id)}`}
                className="inline-flex items-center gap-1 font-mono text-[11px] text-text-muted hover:text-text border border-border hover:border-border-strong rounded px-2.5 py-1 transition-colors"
              >
                View all {data.total_requests.toLocaleString()} request{data.total_requests === 1 ? '' : 's'}
                <ArrowRight className="h-3 w-3" />
              </Link>
            )}
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {stats.map(({ label, value, bad }) => (
            <div key={label} className="border border-border rounded-[6px] px-4 py-3 bg-bg-elev">
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-1.5">
                {label}
              </div>
              <div className={cn('font-mono text-[13px] font-medium truncate', bad ? 'text-bad' : 'text-text')}>
                {value}
              </div>
            </div>
          ))}
        </div>

        {/* Recent requests */}
        <div>
          <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.05em] text-text-faint">
              Recent requests
            </h2>
            <span className="font-mono text-[10.5px] text-text-faint">
              Showing {recentCount} of {data.total_requests.toLocaleString()}
              {hasMore && ' · most recent first'}
            </span>
          </div>
          <div className="border border-border rounded-[6px] overflow-hidden">
            <div className="grid grid-cols-[1fr_1fr_1fr_1fr] sm:grid-cols-[1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-2.5 bg-bg-elev border-b border-border font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
              <span>Time</span>
              <span>Model</span>
              <span className="hidden sm:inline">Tokens</span>
              <span>Cost</span>
              <span className="text-right">Status</span>
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
                      className="grid grid-cols-[1fr_1fr_1fr_1fr] sm:grid-cols-[1fr_1fr_1fr_1fr_1fr] gap-3 items-center px-4 py-2.5 font-mono text-[12px] text-text hover:bg-bg-elev transition-colors"
                    >
                      <span className="text-text-muted" suppressHydrationWarning>
                        {new Date(r.created_at).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <span className="truncate">{r.model}</span>
                      <span className="text-text-muted hidden sm:inline">
                        {r.total_tokens.toLocaleString()}
                        {cacheRead > 0 && (
                          <span className="text-text-faint ml-1.5">· {cacheRead.toLocaleString()} cached</span>
                        )}
                      </span>
                      <span>{fmtCost(r.cost_usd)}</span>
                      <span className={cn('text-right', isErr ? 'text-bad' : 'text-good')}>{r.status_code}</span>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
