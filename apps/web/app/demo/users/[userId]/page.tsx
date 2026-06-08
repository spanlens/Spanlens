import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DEMO_REQUESTS } from '@/lib/demo-data'

// ─────────────────────────────────────────────────────────────────────────────
// Demo /users/[userId] detail page — same shape as the real
// apps/web/app/(dashboard)/users/[userId]/user-detail-client.tsx, but static
// and sourced from DEMO_REQUESTS.
// ─────────────────────────────────────────────────────────────────────────────

function fmtCost(n: number | null | undefined): string {
  if (n == null) return '—'
  return '$' + Number(n).toFixed(6)
}

function fmtCount(n: number): string {
  return n.toLocaleString('en-US')
}

export default async function DemoUserDetailPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  const decoded = decodeURIComponent(userId)

  const userRequests = DEMO_REQUESTS.filter((r) => r.user_id === decoded)
  if (userRequests.length === 0) {
    notFound()
  }

  const totalRequests = userRequests.length
  const totalTokens = userRequests.reduce((s, r) => s + r.total_tokens, 0)
  const totalCost = userRequests.reduce((s, r) => s + (r.cost_usd ?? 0), 0)
  const avgLatency = userRequests.reduce((s, r) => s + r.latency_ms, 0) / totalRequests
  const errorCount = userRequests.filter((r) => r.status_code >= 400).length
  const distinctModels = new Set(userRequests.map((r) => r.model)).size
  const sortedByTime = [...userRequests].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  const firstSeen = sortedByTime[sortedByTime.length - 1]?.created_at ?? null
  const lastSeen = sortedByTime[0]?.created_at ?? null

  const stats = [
    { label: 'Requests', value: fmtCount(totalRequests) },
    { label: 'Total tokens', value: fmtCount(totalTokens) },
    { label: 'Total cost', value: fmtCost(totalCost) },
    { label: 'Avg latency', value: `${Math.round(avgLatency)} ms` },
    { label: 'Error count', value: fmtCount(errorCount), warn: errorCount > 0 },
    { label: 'Distinct models', value: fmtCount(distinctModels) },
    { label: 'First seen', value: firstSeen ? new Date(firstSeen).toLocaleDateString('en-US') : '—' },
    { label: 'Last seen', value: lastSeen ? new Date(lastSeen).toLocaleDateString('en-US') : '—' },
  ]

  return (
    <div className="space-y-6 px-6 py-6 max-w-[1200px] mx-auto">
      <Link
        href="/demo/users"
        className="inline-flex items-center gap-1.5 font-mono text-[12px] text-text-muted hover:text-text transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to users
      </Link>

      <div>
        <h1 className="font-mono text-[18px] tracking-[-0.2px] text-text break-all">{decoded}</h1>
        <p className="font-mono text-[11px] text-text-faint mt-1.5">
          End-user analytics · all requests tagged with this{' '}
          <code className="bg-bg-elev px-1 py-px rounded">x-spanlens-user</code> value
        </p>
      </div>

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
          <div className="divide-y divide-border">
            {sortedByTime.map((r) => {
              const isErr = r.status_code >= 400
              return (
                <Link
                  key={r.id}
                  href={`/demo/requests/${r.id}`}
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
                  <span className="text-text-muted">{r.total_tokens.toLocaleString('en-US')}</span>
                  <span>{fmtCost(r.cost_usd)}</span>
                  <span className={isErr ? 'text-bad' : 'text-good'}>{r.status_code}</span>
                </Link>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
