'use client'
import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Gantt } from '@/components/traces/gantt'
import { useTrace } from '@/lib/queries/use-traces'
import type { SpanRow } from '@/lib/queries/types'

function formatDuration(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function SpanDetailPanel({ span }: { span: SpanRow }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm">{span.name}</h3>
        <Badge variant="outline" className="uppercase text-[10px]">
          {span.span_type}
        </Badge>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs mb-3">
        <dt className="text-muted-foreground">Status</dt>
        <dd className="font-mono">{span.status}</dd>
        <dt className="text-muted-foreground">Duration</dt>
        <dd className="font-mono">{formatDuration(span.duration_ms)}</dd>
        <dt className="text-muted-foreground">Tokens</dt>
        <dd className="font-mono">
          {span.total_tokens > 0
            ? `${span.prompt_tokens} + ${span.completion_tokens} = ${span.total_tokens}`
            : '—'}
        </dd>
        <dt className="text-muted-foreground">Cost</dt>
        <dd className="font-mono">
          {span.cost_usd != null ? `$${span.cost_usd.toFixed(6)}` : '—'}
        </dd>
        {span.request_id && (
          <>
            <dt className="text-muted-foreground">Request</dt>
            <dd className="font-mono truncate">
              <Link href={`/requests/${span.request_id}`} className="text-blue-600 hover:underline">
                {span.request_id.slice(0, 8)}…
              </Link>
            </dd>
          </>
        )}
      </dl>

      {span.error_message && (
        <div className="rounded border border-destructive bg-red-50 p-2 mb-3">
          <p className="text-xs font-mono text-red-800">{span.error_message}</p>
        </div>
      )}

      {span.input != null && (
        <details className="mb-2">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Input</summary>
          <pre className="mt-1 rounded bg-gray-950 p-2 overflow-auto max-h-60 text-[11px] font-mono text-gray-200">
            {JSON.stringify(span.input, null, 2)}
          </pre>
        </details>
      )}
      {span.output != null && (
        <details className="mb-2">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Output</summary>
          <pre className="mt-1 rounded bg-gray-950 p-2 overflow-auto max-h-60 text-[11px] font-mono text-gray-200">
            {JSON.stringify(span.output, null, 2)}
          </pre>
        </details>
      )}
      {span.metadata && (
        <details>
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Metadata</summary>
          <pre className="mt-1 rounded bg-gray-50 border p-2 overflow-auto max-h-40 text-[11px] font-mono">
            {JSON.stringify(span.metadata, null, 2)}
          </pre>
        </details>
      )}
    </div>
  )
}

export default function TraceDetailPage({ params }: { params: { id: string } }) {
  const { data: trace, isLoading, isError, refetch } = useTrace(params.id)
  const [selectedSpan, setSelectedSpan] = useState<SpanRow | null>(null)

  if (isLoading) {
    return (
      <div>
        <Link
          href="/traces"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="h-4 w-4" /> Back to traces
        </Link>
        <Skeleton className="h-8 w-64 mb-4" />
        <div className="grid grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  if (isError || !trace) {
    return (
      <div>
        <Link
          href="/traces"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="h-4 w-4" /> Back to traces
        </Link>
        <div className="rounded-lg border bg-white p-8 text-center">
          <h2 className="text-lg font-semibold mb-2">Trace not found</h2>
          <p className="text-sm text-muted-foreground mb-4">
            This trace may have been deleted, or you may not have access to it.
          </p>
          <button
            onClick={() => void refetch()}
            className="text-sm text-blue-600 hover:text-blue-700"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <Link
        href="/traces"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6"
      >
        <ArrowLeft className="h-4 w-4" /> Back to traces
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{trace.name}</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">
            {trace.id.slice(0, 8)}… · {new Date(trace.started_at).toLocaleString()}
          </p>
        </div>
        <Badge
          variant={
            trace.status === 'error'
              ? 'destructive'
              : trace.status === 'running'
                ? 'secondary'
                : 'success'
          }
          className="text-sm capitalize"
        >
          {trace.status}
        </Badge>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Duration', value: formatDuration(trace.duration_ms) },
          { label: 'Spans', value: trace.span_count.toString() },
          { label: 'Total tokens', value: trace.total_tokens.toLocaleString() },
          {
            label: 'Total cost',
            value: trace.total_cost_usd > 0 ? `$${trace.total_cost_usd.toFixed(6)}` : '—',
          },
        ].map(({ label, value }) => (
          <Card key={label}>
            <CardHeader className="pb-1 pt-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <p className="text-sm font-mono font-semibold truncate">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {trace.error_message && (
        <div className="rounded-lg border border-destructive bg-red-50 p-4 mb-6">
          <p className="text-sm font-mono text-red-800">{trace.error_message}</p>
        </div>
      )}

      {/* Gantt */}
      <div className="mb-6">
        <h2 className="text-base font-semibold mb-3">Timeline</h2>
        <Gantt
          traceStartedAt={trace.started_at}
          traceEndedAt={trace.ended_at}
          spans={trace.spans}
          onSelectSpan={setSelectedSpan}
          selectedSpanId={selectedSpan?.id ?? null}
        />
      </div>

      {/* Span detail */}
      {selectedSpan && (
        <div className="mb-6">
          <h2 className="text-base font-semibold mb-3">Span details</h2>
          <SpanDetailPanel span={selectedSpan} />
        </div>
      )}

      {/* Metadata */}
      {trace.metadata && (
        <div>
          <h2 className="text-base font-semibold mb-3">Trace metadata</h2>
          <pre className="rounded-lg border bg-gray-50 p-4 overflow-auto max-h-60 text-xs font-mono">
            {JSON.stringify(trace.metadata, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
