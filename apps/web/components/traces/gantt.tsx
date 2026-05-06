'use client'
import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { SpanRow, SpanType, TraceStatus } from '@/lib/queries/types'

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

// Column widths in px — must match between header and rows.
const SPAN_W = 200
const LAT_W  = 76
const COST_W = 68
const PAD_X  = 16   // px-4
const BAR_ML = 12   // ml-3

interface GanttProps {
  traceStartedAt: string
  traceEndedAt: string | null
  spans: SpanRow[]
  onSelectSpan?: (span: SpanRow) => void
  selectedSpanId?: string | null
  /** IDs of spans on the critical path (root→leaf). All are highlighted. */
  criticalSpanIds?: ReadonlyArray<string> | null
}

interface PositionedSpan extends SpanRow {
  depth: number
  offsetPercent: number
  widthPercent: number
  durationPercent: number
  isRunning: boolean
}

function buildSpanTree(spans: SpanRow[]): SpanRow[] {
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
    for (const child of byParent.get(parent) ?? []) {
      depths.set(child.id, depth)
      ordered.push(child)
      walk(child.id, depth + 1)
    }
  }
  walk(null, 0)

  // Collect orphan spans (parent_span_id references a span not in the list)
  const visitedIds = new Set(ordered.map((s) => s.id))
  const orphans = spans
    .filter((s) => !visitedIds.has(s.id))
    .sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime())
  for (const s of orphans) {
    depths.set(s.id, 0)
    ordered.push(s)
  }

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

function formatCost(n: number | null): string {
  if (n == null || n <= 0) return '—'
  if (n < 0.001) return `$${n.toFixed(5)}`
  if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(3)}`
}

function TypeBadge({ spanType }: { spanType: SpanType }) {
  return (
    <span className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', TYPE_COLORS[spanType])} />
  )
}

function statusBarClass(status: TraceStatus): string {
  return status === 'error' ? 'bg-bad' : ''
}

const TICKS = [0, 25, 50, 75, 100] as const

// Gridline left offset: padding + span col + latency col + cost col + bar margin
const GRID_LEFT = PAD_X + SPAN_W + LAT_W + COST_W + BAR_ML

export function Gantt({
  traceStartedAt,
  traceEndedAt,
  spans,
  onSelectSpan,
  selectedSpanId,
  criticalSpanIds,
}: GanttProps) {
  const criticalSet = new Set(criticalSpanIds ?? [])
  const positioned = useMemo(() => {
    const traceStartMs = new Date(traceStartedAt).getTime()
    const traceEndMs = traceEndedAt ? new Date(traceEndedAt).getTime() : Date.now()
    const ordered = buildSpanTree(spans)
    return computePositions(ordered, traceStartMs, traceEndMs)
  }, [traceStartedAt, traceEndedAt, spans])

  const totalDurationMs = useMemo(() => {
    const start = new Date(traceStartedAt).getTime()
    const end = traceEndedAt ? new Date(traceEndedAt).getTime() : Date.now()
    return Math.max(1, end - start)
  }, [traceStartedAt, traceEndedAt])

  // σ annotation: compute mean + std per span_type across this trace.
  // Requires ≥ 3 same-type spans to be meaningful.
  const typeStats = useMemo(() => {
    const groups: Record<string, number[]> = {}
    for (const s of spans) {
      if (s.duration_ms != null) {
        groups[s.span_type] ??= []
        groups[s.span_type]!.push(s.duration_ms)
      }
    }
    const stats: Record<string, { mean: number; std: number }> = {}
    for (const [type, vals] of Object.entries(groups)) {
      if (vals.length < 3) continue
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length
      const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length
      const std = Math.sqrt(variance)
      if (std > 0) stats[type] = { mean, std }
    }
    return stats
  }, [spans])

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
      <div className="flex items-center border-b border-border bg-bg-muted px-4 py-2 text-text-faint">
        <div className="shrink-0 font-mono text-[10px] uppercase tracking-[0.05em]" style={{ width: SPAN_W }}>
          Span
        </div>
        <div className="shrink-0 text-right font-mono text-[10px] uppercase tracking-[0.05em]" style={{ width: LAT_W }}>
          Latency
        </div>
        <div className="shrink-0 text-right font-mono text-[10px] uppercase tracking-[0.05em]" style={{ width: COST_W }}>
          Cost
        </div>
        <div className="flex-1 relative ml-3">
          {/* Invisible spacer so the row height is set by the absolute tick labels */}
          <div className="invisible text-[10px]">0</div>
          <div className="absolute inset-0 flex justify-between text-[10px]">
            {TICKS.map((pct) => (
              <span key={pct} className={pct === 100 ? 'text-right' : ''}>
                {formatMs((totalDurationMs * pct) / 100)}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Gridlines + rows */}
      <div className="relative divide-y divide-border">
        {/* Vertical gridlines aligned with tick labels */}
        <div
          className="pointer-events-none absolute inset-y-0 hidden md:block"
          style={{ left: `${GRID_LEFT}px`, right: `${PAD_X}px` }}
        >
          {TICKS.map((pct) => (
            <div
              key={pct}
              className={cn('absolute inset-y-0 w-px', pct === 0 || pct === 100 ? 'bg-border-strong' : 'bg-border')}
              style={{ left: `${pct}%` }}
            />
          ))}
        </div>

        {positioned.map((s) => {
          const isSelected = selectedSpanId === s.id
          const isCritical = criticalSet.has(s.id)

          // σ annotation
          const stat = typeStats[s.span_type]
          const sigma = stat && s.duration_ms != null
            ? (s.duration_ms - stat.mean) / stat.std
            : 0
          const sigmaLabel = sigma >= 2.0 ? `${sigma.toFixed(1)}σ latency` : null

          // Error hint (first meaningful fragment of error_message)
          const errorHint = s.status === 'error' && s.error_message
            ? s.error_message.slice(0, 28)
            : null

          const hasAnnotation = isCritical || sigmaLabel != null || errorHint != null

          const showInlineLabel = s.widthPercent >= 10
          const tooltip = `${s.name}\nstart +${formatMs((s.offsetPercent / 100) * totalDurationMs)}\nduration ${formatMs(s.duration_ms)} (${s.durationPercent.toFixed(1)}%)`

          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelectSpan?.(s)}
              title={tooltip}
              className={cn(
                'relative flex items-center w-full px-4 py-[7px] text-left transition-colors',
                isSelected ? 'bg-bg-muted ring-1 ring-accent ring-inset' : TYPE_BG[s.span_type],
              )}
            >
              {isSelected && <span className="absolute left-0 inset-y-0 w-1 bg-accent" aria-hidden />}

              {/* ── Span name col ─────────────────────────── */}
              <div className="shrink-0 min-w-0" style={{ width: SPAN_W }}>
                <div className="flex items-center gap-1.5" style={{ paddingLeft: `${s.depth * 12}px` }}>
                  <TypeBadge spanType={s.span_type} />
                  <span className="truncate text-[12.5px] font-medium text-text leading-tight">{s.name}</span>
                </div>
                {hasAnnotation && (
                  <div
                    className="flex items-center gap-1.5 mt-[3px] flex-wrap"
                    style={{ paddingLeft: `${s.depth * 12 + 14}px` }}
                  >
                    {isCritical && (
                      <span className="font-mono text-[8.5px] px-[4px] py-[1px] rounded-[2px] bg-accent-bg text-accent border border-accent-border uppercase tracking-[0.04em]">
                        critical
                      </span>
                    )}
                    {sigmaLabel && !isCritical && (
                      <span className="font-mono text-[9px] text-text-faint">{sigmaLabel}</span>
                    )}
                    {errorHint && (
                      <span className="font-mono text-[9px] text-bad truncate">{errorHint}</span>
                    )}
                  </div>
                )}
              </div>

              {/* ── Latency col ───────────────────────────── */}
              <div className="shrink-0 text-right font-mono text-[11.5px]" style={{ width: LAT_W }}>
                <span className={cn(
                  s.status === 'error' ? 'text-bad'
                    : isCritical ? 'text-accent font-medium'
                    : 'text-text',
                )}>
                  {formatMs(s.duration_ms)}
                </span>
              </div>

              {/* ── Cost col ──────────────────────────────── */}
              <div className="shrink-0 text-right font-mono text-[11px] text-text-muted" style={{ width: COST_W }}>
                {formatCost(s.cost_usd)}
              </div>

              {/* ── Bar ───────────────────────────────────── */}
              <div className="flex-1 relative ml-3" style={{ height: hasAnnotation ? 36 : 28 }}>
                <div
                  className={cn(
                    'absolute h-5 top-1 rounded shadow-sm flex items-center px-1.5 text-[10px] font-mono text-white whitespace-nowrap overflow-hidden',
                    s.status === 'error' ? statusBarClass(s.status) : TYPE_COLORS[s.span_type],
                    s.isRunning && 'animate-pulse',
                  )}
                  style={{
                    left: `${s.offsetPercent}%`,
                    width: `max(3px, ${s.widthPercent}%)`,
                    minWidth: '3px',
                  }}
                >
                  {showInlineLabel && (
                    <span className="opacity-90 leading-none">{s.durationPercent.toFixed(0)}%</span>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 border-t border-border bg-bg-muted px-4 py-2 text-[11px] text-text-faint">
        <span className="font-medium text-foreground">Types:</span>
        {(['llm', 'tool', 'retrieval', 'embedding', 'custom'] as const).map((t) => (
          <span key={t} className="inline-flex items-center gap-1">
            <TypeBadge spanType={t} />
            {t}
          </span>
        ))}
        <span className="ml-auto font-mono text-[10px]">Click a bar to inspect · hover for timing</span>
      </div>
    </div>
  )
}
