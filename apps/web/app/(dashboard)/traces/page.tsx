'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useTraces } from '@/lib/queries/use-traces'
import type { TraceStatus } from '@/lib/queries/types'
import { DocsLink } from '@/components/layout/docs-link'

function formatDuration(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function StatusBadge({ status }: { status: TraceStatus }) {
  if (status === 'running')
    return <Badge variant="secondary" className="bg-blue-100 text-blue-700 hover:bg-blue-100">Running</Badge>
  if (status === 'error') return <Badge variant="destructive">Error</Badge>
  return <Badge variant="success">Completed</Badge>
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

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Traces</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {meta.total.toLocaleString()} total traces
          </p>
        </div>
        <DocsLink href="/docs/features/traces" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <Select
          value={filterStatus}
          onValueChange={(v) => { setFilterStatus(v as TraceStatus | 'all'); setPage(1) }}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
          Refresh
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Started</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Spans</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Tokens</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Cost</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Duration</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="px-4 py-3"><Skeleton className="h-4 w-32" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-4 w-40" /></td>
                  <td className="px-4 py-3 text-right"><Skeleton className="h-4 w-8 ml-auto" /></td>
                  <td className="px-4 py-3 text-right"><Skeleton className="h-4 w-12 ml-auto" /></td>
                  <td className="px-4 py-3 text-right"><Skeleton className="h-4 w-14 ml-auto" /></td>
                  <td className="px-4 py-3 text-right"><Skeleton className="h-4 w-10 ml-auto" /></td>
                  <td className="px-4 py-3"><Skeleton className="h-5 w-20" /></td>
                </tr>
              ))
            ) : traces.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-muted-foreground">
                  No traces yet. Use the Spanlens SDK to start recording agent traces.
                </td>
              </tr>
            ) : (
              traces.map((t) => (
                <tr key={t.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    <Link href={`/traces/${t.id}`} className="hover:text-foreground">
                      {new Date(t.started_at).toLocaleString()}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/traces/${t.id}`} className="font-medium hover:underline">
                      {t.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{t.span_count}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">
                    {t.total_tokens.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">
                    {t.total_cost_usd > 0 ? `$${t.total_cost_usd.toFixed(6)}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">
                    {formatDuration(t.duration_ms)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={t.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4">
        <p className="text-sm text-muted-foreground">
          Showing {traces.length} of {meta.total}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline" size="sm"
            disabled={page <= 1 || isFetching}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <Button
            variant="outline" size="sm"
            disabled={traces.length < meta.limit || isFetching}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}
