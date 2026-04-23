'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useTraces } from '@/lib/queries/use-traces'
import type { TraceStatus } from '@/lib/queries/types'
import { Topbar } from '@/components/layout/topbar'
import { MicroLabel, GhostBtn } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'

function fmtDuration(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function fmtCost(n: number): string {
  if (n <= 0) return '—'
  return n < 0.001 ? `$${n.toFixed(5)}` : `$${n.toFixed(4)}`
}

function StatusDot({ status }: { status: TraceStatus }) {
  return (
    <span
      className={cn(
        'w-1.5 h-1.5 rounded-full shrink-0',
        status === 'completed'
          ? 'bg-good'
          : status === 'running'
            ? 'bg-accent animate-pulse'
            : 'bg-bad',
      )}
    />
  )
}

function KpiTile({
  label,
  value,
  sub,
  bad,
  accent,
}: {
  label: string
  value: string
  sub?: string
  bad?: boolean
  accent?: boolean
}) {
  return (
    <div className="flex flex-col gap-1 px-6 py-4 border-r border-border last:border-r-0">
      <MicroLabel>{label}</MicroLabel>
      <span
        className={cn(
          'text-[22px] font-semibold leading-none',
          bad ? 'text-bad' : accent ? 'text-accent' : 'text-text',
        )}
      >
        {value}
      </span>
      {sub && <span className="text-[11px] text-text-muted font-mono">{sub}</span>}
    </div>
  )
}

export default function TracesPage() {
  const [filterStatus, setFilterStatus] = useState<TraceStatus | 'all'>('all')
  const [page, setPage] = useState(1)

  const filters = useMemo(
    () => ({ page, limit: 50, status: filterStatus }),
    [page, filterStatus],
  )

  const { data, isLoading, isFetching, refetch } = useTraces(filters)
  const traces = data?.data ?? []
  const meta = data?.meta ?? { total: 0, page: 1, limit: 50 }

  const running = traces.filter((t) => t.status === 'running').length
  const errors = traces.filter((t) => t.status === 'error').length
  const completedWithDuration = traces.filter((t) => t.duration_ms != null)
  const avgDuration =
    completedWithDuration.length > 0
      ? completedWithDuration.reduce((s, t) => s + (t.duration_ms ?? 0), 0) /
        completedWithDuration.length
      : null

  return (
    <div className="-m-7 flex flex-col h-screen overflow-hidden bg-bg">
      <Topbar
        crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Traces' }]}
        right={
          <GhostBtn
            onClick={() => void refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 text-[12.5px] px-3 py-[5px]"
          >
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </GhostBtn>
        }
      />

      {/* Stat strip */}
      <div className="grid grid-cols-4 border-b border-border shrink-0">
        <KpiTile label="Total traces" value={meta.total.toLocaleString()} />
        <KpiTile label="Running" value={String(running)} accent={running > 0} />
        <KpiTile label="Errors" value={String(errors)} bad={errors > 0} />
        <KpiTile
          label="Avg duration"
          value={fmtDuration(avgDuration !== null ? Math.round(avgDuration) : null)}
          sub="current page"
        />
      </div>

      {/* Filter toolbar */}
      <div className="flex items-center gap-2 px-6 py-2.5 border-b border-border shrink-0">
        {(['all', 'running', 'completed', 'error'] as (TraceStatus | 'all')[]).map((f) => (
          <button
            type="button"
            key={f}
            onClick={() => {
              setFilterStatus(f)
              setPage(1)
            }}
            className={cn(
              'px-3 py-1 rounded text-[12.5px] capitalize transition-colors',
              filterStatus === f
                ? 'bg-bg-elev text-text font-medium border border-border-strong'
                : 'text-text-muted hover:text-text',
            )}
          >
            {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-6 space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-10 bg-bg-elev rounded animate-pulse" />
            ))}
          </div>
        ) : traces.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
            <p className="text-[13px]">No traces yet.</p>
            <p className="text-[12px]">Use the Spanlens SDK to start recording agent traces.</p>
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-bg-elev sticky top-0 z-10">
                <th className="px-6 py-2.5 text-left w-[190px]">
                  <MicroLabel>Started</MicroLabel>
                </th>
                <th className="px-4 py-2.5 text-left">
                  <MicroLabel>Name</MicroLabel>
                </th>
                <th className="px-4 py-2.5 text-right">
                  <MicroLabel>Spans</MicroLabel>
                </th>
                <th className="px-4 py-2.5 text-right">
                  <MicroLabel>Tokens</MicroLabel>
                </th>
                <th className="px-4 py-2.5 text-right">
                  <MicroLabel>Cost</MicroLabel>
                </th>
                <th className="px-4 py-2.5 text-right">
                  <MicroLabel>Duration</MicroLabel>
                </th>
                <th className="px-4 py-2.5 text-left w-[110px]">
                  <MicroLabel>Status</MicroLabel>
                </th>
              </tr>
            </thead>
            <tbody>
              {traces.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-border hover:bg-bg-elev transition-colors group"
                >
                  <td className="px-6 py-3">
                    <Link
                      href={`/traces/${t.id}`}
                      className="font-mono text-[11px] text-text-faint group-hover:text-text-muted transition-colors"
                    >
                      {new Date(t.started_at).toLocaleString()}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/traces/${t.id}`}
                      className="font-medium text-text hover:text-accent transition-colors"
                    >
                      {t.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-text-muted text-[12px]">
                    {t.span_count}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-text-muted text-[12px]">
                    {t.total_tokens.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-text-muted text-[12px]">
                    {fmtCost(t.total_cost_usd)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-text-muted text-[12px]">
                    {fmtDuration(t.duration_ms)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <StatusDot status={t.status} />
                      <span className="text-[12px] text-text-muted capitalize">{t.status}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {!isLoading && traces.length > 0 && (
        <div className="flex items-center justify-between px-6 py-3 border-t border-border shrink-0">
          <span className="text-[12.5px] text-text-muted font-mono">
            {traces.length.toLocaleString()} of {meta.total.toLocaleString()} traces
          </span>
          <div className="flex items-center gap-2">
            <GhostBtn
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isFetching}
              className="text-[12.5px] px-3 py-[5px]"
            >
              Previous
            </GhostBtn>
            <GhostBtn
              onClick={() => setPage((p) => p + 1)}
              disabled={traces.length < meta.limit || isFetching}
              className="text-[12.5px] px-3 py-[5px]"
            >
              Next
            </GhostBtn>
          </div>
        </div>
      )}
    </div>
  )
}
