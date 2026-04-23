'use client'
import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { SpanRow, SpanType, TraceStatus } from '@/lib/queries/types'

/**
 * Flame-graph-style waterfall view for a trace's spans.
 *
 * Improvements over the original Gantt:
 *   - Time ruler with 5 tick marks (0/25/50/75/100%) and vertical gridlines
 *     that extend down through the bars — Chrome DevTools / Honeycomb style.
 *   - Inline duration + percent-of-total inside the bar when there's room
 *     (≥ 8% width). Reading "1.4s (77%)" right on the bar makes the
 *     bottleneck instantly obvious.
 *   - Stronger selection treatment with a left-edge indicator + ring.
 *   - Tooltip on hover with precise start offset, duration, and % share.
 *   - Color and saturation differentiate span_type at a glance.
 *
 * Tree shape:
 *   - X axis: time from trace start (ms). Scale = trace duration.
 *   - Y axis: one row per span, indented by nesting depth.
 *   - Parallel spans (same parent, overlapping times) sit at the same
 *     indentation; their bars overlap horizontally — fan-out is obvious.
 *   - Running spans (no ended_at) extend to "now" with a pulse animation.
 */

const TYPE_COLORS: Record<SpanType, string> = {
  llm: 'bg-accent',
  tool: 'bg-text-faint',
  retrieval: 'bg-good',
  embedding: 'bg-text-muted',
  custom: 'bg-border-strong',
}

const TYPE_BG: Record<SpanType, string> = {
  llm: 'bg-accent-bg hover:bg-accent-bg/80',
  tool: 'bg-bg-muted/60 hover:bg-bg-muted',
  retrieval: 'bg-good-bg/60 hover:bg-good-bg',
  embedding: 'bg-bg-muted/60 hover:bg-bg-muted',
  custom: 'hover:bg-bg-muted',
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
  durationPercent: number
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
    const offsetPercent = (offsetMs / totalMs) * 100
    const durationPercent = (durationMs / totalMs) * 100
    return {
      ...s,
      depth: (s as SpanRow & { _depth: number })._depth ?? 0,
      offsetPercent,
      widthPercent: Math.min(100 - offsetPercent, durationPercent),
      durationPercent,
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

function statusOverrideClass(status: TraceStatus): string {
  if (status === 'error') return 'bg-bad'
  return ''
}

// Vertical gridlines aligned with the time-ruler ticks.
const TICKS = [0, 25, 50, 75, 100] as const

export function Gantt({
  traceStartedAt,
  traceEndedAt,
  spans,
  onSelectSpan,
  selectedSpanId,
}: GanttProps) {
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
    return Math.max(1, end - start)
  }, [traceStartedAt, traceEndedAt])

  if (positioned.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-bg p-8 text-center font-mono text-[12.5px] text-text-faint">
        No spans recorded for this trace yet.
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-bg overflow-hidden">
      {/* Time ruler */}
      <div className="flex items-center border-b border-border bg-bg-muted px-4 py-2 text-xs text-text-faint">
        <div className="w-80 shrink-0 font-medium">Span</div>
        <div className="flex-1 relative">
          <div className="absolute inset-0 flex justify-between text-[10px]">
            {TICKS.map((pct) => (
              <span key={pct} className={pct === 0 ? 'text-left' : pct === 100 ? 'text-right' : ''}>
                {formatMs((totalDurationMs * pct) / 100)}
              </span>
            ))}
          </div>
        </div>
        <div className="w-24 text-right shrink-0">Duration</div>
      </div>

      {/* Gridlines + bars */}
      <div className="relative divide-y">
        {/* Vertical gridlines spanning the whole bar area. Positioned by
            sliding from the left edge of the bar column (after the 320px
            "Span" column + 16px padding) so they align perfectly with the
            tick labels above. */}
        <div
          className="pointer-events-none absolute inset-y-0 hidden md:block"
          style={{ left: 'calc(20rem + 1rem)', right: 'calc(6rem + 1rem)' }}
        >
          {TICKS.map((pct) => (
            <div
              key={pct}
              className={cn(
                'absolute inset-y-0 w-px',
                pct === 0 || pct === 100 ? 'bg-border-strong' : 'bg-border',
              )}
              style={{ left: `${pct}%` }}
            />
          ))}
        </div>

        {positioned.map((s) => {
          const isSelected = selectedSpanId === s.id
          const showInlineLabel = s.widthPercent >= 8
          const tooltip = `${s.name}\nstart +${formatMs(
            (s.offsetPercent / 100) * totalDurationMs,
          )}\nduration ${formatMs(s.duration_ms)} (${s.durationPercent.toFixed(1)}%)`
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelectSpan?.(s)}
              title={tooltip}
              className={cn(
                'relative flex items-center w-full px-4 py-2 text-left transition-colors',
                isSelected ? 'bg-bg-muted ring-1 ring-accent ring-inset' : TYPE_BG[s.span_type],
              )}
            >
              {/* Selected left-edge indicator */}
              {isSelected && (
                <span className="absolute left-0 inset-y-0 w-1 bg-accent" aria-hidden />
              )}

              {/* Name + depth */}
              <div className="w-80 shrink-0 min-w-0">
                <div
                  className="flex items-center gap-2"
                  style={{ paddingLeft: `${s.depth * 16}px` }}
                >
                  <TypeBadge spanType={s.span_type} />
                  <span className="truncate text-sm font-medium">{s.name}</span>
                  {s.status === 'error' && (
                    <span className="text-[10px] font-semibold text-red-600 uppercase">error</span>
                  )}
                </div>
                <div
                  className="flex items-center gap-2 mt-0.5"
                  style={{ paddingLeft: `${s.depth * 16 + 14}px` }}
                >
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
              <div className="flex-1 relative h-7">
                <div
                  className={cn(
                    'absolute h-5 top-1 rounded shadow-sm flex items-center px-1.5 text-[10px] font-mono text-white whitespace-nowrap overflow-hidden',
                    s.status === 'error' ? statusOverrideClass(s.status) : TYPE_COLORS[s.span_type],
                    s.isRunning && 'animate-pulse',
                  )}
                  style={{
                    left: `${s.offsetPercent}%`,
                    width: `max(3px, ${s.widthPercent}%)`,
                    minWidth: '3px',
                  }}
                >
                  {showInlineLabel && (
                    <span className="opacity-90 leading-none">
                      {formatMs(s.duration_ms)} · {s.durationPercent.toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>

              {/* Duration */}
              <div className="w-24 text-right shrink-0 font-mono text-xs text-muted-foreground">
                {formatMs(s.duration_ms)}
              </div>
            </button>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 border-t border-border bg-bg-muted px-4 py-2 text-[11px] text-text-faint">
        <span className="font-medium text-foreground">Span types:</span>
        {(['llm', 'tool', 'retrieval', 'embedding', 'custom'] as const).map((t) => (
          <span key={t} className="inline-flex items-center gap-1">
            <TypeBadge spanType={t} />
            {t}
          </span>
        ))}
        <span className="ml-auto font-mono text-[10px]">
          Click a bar for details · hover for precise timing
        </span>
      </div>
    </div>
  )
}
