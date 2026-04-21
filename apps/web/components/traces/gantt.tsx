'use client'
import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { SpanRow, SpanType, TraceStatus } from '@/lib/queries/types'

/**
 * Gantt/waterfall view for a trace's spans.
 *
 * Design:
 * - X axis: time from trace start (ms). Scale = trace duration.
 * - Y axis: one row per span, indented by nesting depth.
 * - Parallel spans (same parent, overlapping times) share the same indentation
 *   and their bars naturally overlap horizontally — this makes LangGraph-style
 *   fan-out visually obvious.
 * - Bar color: spanType category.
 * - Running spans (no ended_at) extend to "now" with a striped pattern.
 */

const TYPE_COLORS: Record<SpanType, string> = {
  llm: 'bg-blue-500',
  tool: 'bg-purple-500',
  retrieval: 'bg-green-500',
  embedding: 'bg-teal-500',
  custom: 'bg-gray-500',
}

const TYPE_BG: Record<SpanType, string> = {
  llm: 'bg-blue-50 hover:bg-blue-100',
  tool: 'bg-purple-50 hover:bg-purple-100',
  retrieval: 'bg-green-50 hover:bg-green-100',
  embedding: 'bg-teal-50 hover:bg-teal-100',
  custom: 'bg-gray-50 hover:bg-gray-100',
}

interface GanttProps {
  traceStartedAt: string
  traceEndedAt: string | null
  spans: SpanRow[]
  onSelectSpan?: (span: SpanRow) => void
  selectedSpanId?: string | null
}

interface PositionedSpan extends SpanRow {
  depth: number
  offsetPercent: number
  widthPercent: number
  isRunning: boolean
}

function buildSpanTree(spans: SpanRow[]): SpanRow[] {
  // Pre-order DFS: root spans first, then children in start order.
  const byParent = new Map<string | null, SpanRow[]>()
  for (const s of spans) {
    const k = s.parent_span_id
    const bucket = byParent.get(k) ?? []
    bucket.push(s)
    byParent.set(k, bucket)
  }
  for (const bucket of byParent.values()) {
    bucket.sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime())
  }

  const ordered: SpanRow[] = []
  const depths = new Map<string, number>()

  function walk(parent: string | null, depth: number) {
    const children = byParent.get(parent) ?? []
    for (const child of children) {
      depths.set(child.id, depth)
      ordered.push(child)
      walk(child.id, depth + 1)
    }
  }
  walk(null, 0)

  // Attach depth as extra field on span (mutated in place for simplicity)
  for (const s of ordered) {
    ;(s as SpanRow & { _depth: number })._depth = depths.get(s.id) ?? 0
  }
  return ordered
}

function computePositions(
  ordered: SpanRow[],
  traceStartMs: number,
  traceEndMs: number,
): PositionedSpan[] {
  const totalMs = Math.max(1, traceEndMs - traceStartMs)
  return ordered.map((s) => {
    const start = new Date(s.started_at).getTime()
    const end = s.ended_at ? new Date(s.ended_at).getTime() : traceEndMs
    const offsetMs = Math.max(0, start - traceStartMs)
    const durationMs = Math.max(1, end - start)
    return {
      ...s,
      depth: (s as SpanRow & { _depth: number })._depth ?? 0,
      offsetPercent: (offsetMs / totalMs) * 100,
      widthPercent: Math.min(100 - (offsetMs / totalMs) * 100, (durationMs / totalMs) * 100),
      isRunning: !s.ended_at,
    }
  })
}

function formatMs(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1) return '<1ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function TypeBadge({ spanType }: { spanType: SpanType }) {
  return (
    <span
      className={cn(
        'inline-block h-1.5 w-1.5 rounded-full',
        TYPE_COLORS[spanType],
      )}
    />
  )
}

function statusColor(status: TraceStatus): string {
  if (status === 'error') return 'bg-red-500'
  if (status === 'running') return ''  // striped animation below
  return ''
}

export function Gantt({ traceStartedAt, traceEndedAt, spans, onSelectSpan, selectedSpanId }: GanttProps) {
  const positioned = useMemo(() => {
    const traceStartMs = new Date(traceStartedAt).getTime()
    const traceEndMs = traceEndedAt
      ? new Date(traceEndedAt).getTime()
      : Math.max(
          ...spans
            .map((s) => (s.ended_at ? new Date(s.ended_at).getTime() : 0))
            .filter((t) => t > 0),
          traceStartMs + 1,
        )
    const ordered = buildSpanTree(spans)
    return computePositions(ordered, traceStartMs, traceEndMs)
  }, [traceStartedAt, traceEndedAt, spans])

  const totalDurationMs = useMemo(() => {
    const start = new Date(traceStartedAt).getTime()
    const end = traceEndedAt ? new Date(traceEndedAt).getTime() : Date.now()
    return end - start
  }, [traceStartedAt, traceEndedAt])

  if (positioned.length === 0) {
    return (
      <div className="rounded-lg border bg-white p-8 text-center text-sm text-muted-foreground">
        No spans recorded for this trace yet.
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-white overflow-hidden">
      {/* Time ruler */}
      <div className="flex items-center border-b bg-gray-50 px-4 py-2 text-xs text-muted-foreground">
        <div className="w-80 shrink-0 font-medium">Span</div>
        <div className="flex-1 relative">
          <div className="flex justify-between">
            <span>0ms</span>
            <span>{formatMs(totalDurationMs / 2)}</span>
            <span>{formatMs(totalDurationMs)}</span>
          </div>
        </div>
        <div className="w-24 text-right shrink-0">Duration</div>
      </div>

      {/* Bars */}
      <div className="divide-y">
        {positioned.map((s) => {
          const isSelected = selectedSpanId === s.id
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelectSpan?.(s)}
              className={cn(
                'flex items-center w-full px-4 py-2 text-left transition-colors',
                isSelected ? 'bg-blue-50' : TYPE_BG[s.span_type],
              )}
            >
              {/* Name + depth */}
              <div className="w-80 shrink-0 min-w-0">
                <div
                  className="flex items-center gap-2"
                  style={{ paddingLeft: `${s.depth * 16}px` }}
                >
                  <TypeBadge spanType={s.span_type} />
                  <span className="truncate text-sm font-medium">{s.name}</span>
                  {s.status === 'error' && (
                    <span className="text-xs text-red-600 font-medium">ERROR</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5" style={{ paddingLeft: `${s.depth * 16 + 14}px` }}>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {s.span_type}
                  </span>
                  {s.total_tokens > 0 && (
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {s.total_tokens} tok
                    </span>
                  )}
                  {s.cost_usd != null && s.cost_usd > 0 && (
                    <span className="text-[10px] font-mono text-muted-foreground">
                      ${s.cost_usd.toFixed(6)}
                    </span>
                  )}
                </div>
              </div>

              {/* Bar */}
              <div className="flex-1 relative h-6">
                <div
                  className={cn(
                    'absolute h-4 top-1 rounded',
                    s.status === 'error' ? 'bg-red-500' : TYPE_COLORS[s.span_type],
                    s.isRunning && 'animate-pulse',
                    statusColor(s.status),
                  )}
                  style={{
                    left: `${s.offsetPercent}%`,
                    width: `max(2px, ${s.widthPercent}%)`,
                    minWidth: '2px',
                  }}
                  title={`${s.name} — ${formatMs(s.duration_ms)}`}
                />
              </div>

              {/* Duration */}
              <div className="w-24 text-right shrink-0 font-mono text-xs text-muted-foreground">
                {formatMs(s.duration_ms)}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
