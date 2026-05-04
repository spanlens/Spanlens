'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Topbar } from '@/components/layout/topbar'
import { cn } from '@/lib/utils'
import { DEMO_TRACES, DEMO_TRACE_DETAILS } from '@/lib/demo-data'
import type { SpanRow } from '@/lib/queries/types'

// ── Helpers ────────────────────────────────────────────────────

function fmtDuration(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1) return '<1ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function fmtCost(n: number | null): string {
  if (n == null || n <= 0) return '—'
  return n < 0.001 ? `$${n.toFixed(5)}` : `$${n.toFixed(4)}`
}

const SPAN_TYPE_COLORS: Record<string, string> = {
  llm:       'bg-accent/10 text-accent border-accent/20',
  tool:      'bg-good/10 text-good border-good/20',
  retrieval: 'bg-text/10 text-text-muted border-border',
  embedding: 'bg-text/10 text-text-muted border-border',
  custom:    'bg-bg-muted text-text-faint border-border',
}

function SpanTypeBadge({ type }: { type: string }) {
  const cls = SPAN_TYPE_COLORS[type] ?? SPAN_TYPE_COLORS['custom']!
  return (
    <span className={cn('font-mono text-[9px] uppercase tracking-[0.04em] px-[5px] py-[1px] rounded-[3px] border', cls)}>
      {type}
    </span>
  )
}

// ── Span detail panel ──────────────────────────────────────────

interface SpanDetailPanelProps {
  span: SpanRow
  onClose: () => void
}

function SpanDetailPanel({ span, onClose }: SpanDetailPanelProps) {
  return (
    <div className="w-full md:w-[380px] shrink-0 border-l border-border bg-bg flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <span className="text-[13px] font-medium text-text truncate flex-1">{span.name}</span>
        <SpanTypeBadge type={span.span_type} />
        <button
          type="button"
          onClick={onClose}
          className="ml-1 text-text-faint hover:text-text transition-colors text-[16px] leading-none"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'Duration', value: fmtDuration(span.duration_ms) },
            { label: 'Status',   value: span.status },
            { label: 'Tokens',   value: span.total_tokens > 0 ? span.total_tokens.toLocaleString() : '—' },
            { label: 'Cost',     value: fmtCost(span.cost_usd) },
          ].map((s) => (
            <div key={s.label} className="rounded-[5px] border border-border bg-bg-elev px-3 py-2">
              <div className="font-mono text-[9.5px] uppercase tracking-[0.05em] text-text-faint mb-1">{s.label}</div>
              <div className={cn('text-[14px] font-medium', s.label === 'Status' && span.status === 'error' ? 'text-bad' : 'text-text')}>
                {s.value}
              </div>
            </div>
          ))}
        </div>

        {/* Tokens breakdown */}
        {span.total_tokens > 0 && (
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-1.5">Tokens</div>
            <div className="flex gap-3 font-mono text-[12px] text-text-muted">
              <span>{span.prompt_tokens.toLocaleString()} prompt</span>
              <span className="text-text-faint">·</span>
              <span>{span.completion_tokens.toLocaleString()} completion</span>
            </div>
          </div>
        )}

        {/* Error */}
        {span.error_message && (
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-bad mb-1.5">Error</div>
            <div className="rounded-[5px] border border-bad/20 bg-bad-bg px-3 py-2 font-mono text-[11px] text-bad break-words">
              {span.error_message}
            </div>
          </div>
        )}

        {/* Input */}
        {span.input != null && (
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-1.5">Input</div>
            <pre className="rounded-[5px] border border-border bg-bg-muted px-3 py-2 font-mono text-[11px] text-text-muted overflow-auto max-h-48 whitespace-pre-wrap break-words">
              {JSON.stringify(span.input, null, 2)}
            </pre>
          </div>
        )}

        {/* Output */}
        {span.output != null && (
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-1.5">Output</div>
            <pre className="rounded-[5px] border border-border bg-bg-muted px-3 py-2 font-mono text-[11px] text-text-muted overflow-auto max-h-48 whitespace-pre-wrap break-words">
              {JSON.stringify(span.output, null, 2)}
            </pre>
          </div>
        )}

        {/* Metadata */}
        {span.metadata != null && Object.keys(span.metadata).length > 0 && (
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-1.5">Metadata</div>
            <pre className="rounded-[5px] border border-border bg-bg-muted px-3 py-2 font-mono text-[11px] text-text-muted overflow-auto max-h-32 whitespace-pre-wrap break-words">
              {JSON.stringify(span.metadata, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Waterfall ──────────────────────────────────────────────────

interface SpanWaterfallRowProps {
  span: SpanRow
  depth: number
  totalDurationMs: number
  traceStartMs: number
  isSelected: boolean
  onClick: () => void
}

function SpanWaterfallRow({
  span, depth, totalDurationMs, traceStartMs, isSelected, onClick,
}: SpanWaterfallRowProps) {
  const isErr = span.status === 'error'
  const isRunning = span.status === 'running'

  const offsetMs = new Date(span.started_at).getTime() - traceStartMs
  const durMs = span.duration_ms ?? 0
  const total = Math.max(totalDurationMs, 1)

  const leftPct = Math.max(0, Math.min(100, (offsetMs / total) * 100))
  const widthPct = Math.max(1, Math.min(100 - leftPct, (durMs / total) * 100))

  const barColor = isErr ? 'bg-bad' : isRunning ? 'bg-accent animate-pulse' : 'bg-text opacity-60'

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left flex items-center gap-2 px-4 py-2 border-b border-border transition-colors',
        isSelected ? 'bg-bg-elev' : 'hover:bg-bg-muted',
        isErr && !isSelected && 'bg-bad-bg',
      )}
    >
      {/* Indent + name */}
      <div className="shrink-0 w-[220px] flex items-center gap-1.5 overflow-hidden" style={{ paddingLeft: depth * 16 }}>
        {depth > 0 && <span className="text-text-faint text-[10px] shrink-0">└</span>}
        <SpanTypeBadge type={span.span_type} />
        <span className="text-[12px] text-text truncate ml-1">{span.name}</span>
      </div>

      {/* Timeline bar */}
      <div className="flex-1 relative h-[10px] bg-bg-muted rounded-[2px] border border-border overflow-hidden">
        <div
          className={cn('absolute h-full rounded-[1px]', barColor)}
          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
        />
      </div>

      {/* Duration */}
      <span className={cn('shrink-0 font-mono text-[11px] w-16 text-right', isErr ? 'text-bad' : 'text-text-muted')}>
        {fmtDuration(span.duration_ms)}
      </span>
    </button>
  )
}

// ── Build tree helper ──────────────────────────────────────────

interface SpanNode {
  span: SpanRow
  depth: number
}

function flattenSpanTree(spans: SpanRow[]): SpanNode[] {
  const byId = new Map<string, SpanRow>(spans.map((s) => [s.id, s]))
  const childrenOf = new Map<string | null, SpanRow[]>()

  for (const s of spans) {
    const parentKey = s.parent_span_id ?? null
    if (!childrenOf.has(parentKey)) childrenOf.set(parentKey, [])
    childrenOf.get(parentKey)!.push(s)
  }

  const result: SpanNode[] = []

  function walk(parentId: string | null, depth: number) {
    const children = childrenOf.get(parentId) ?? []
    const sorted = [...children].sort(
      (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
    )
    for (const s of sorted) {
      result.push({ span: s, depth })
      walk(s.id, depth + 1)
    }
  }

  walk(null, 0)

  // If nothing found via tree walk, just show flat list
  if (result.length === 0) {
    spans.forEach((s, i) => result.push({ span: s, depth: 0 }))
  }

  return result
}

// ── Page ───────────────────────────────────────────────────────

export default function DemoTraceDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null)

  const traceDetail = DEMO_TRACE_DETAILS[params.id]
  const traceIdx = DEMO_TRACES.findIndex((t) => t.id === params.id)
  const prevTrace = traceIdx > 0 ? DEMO_TRACES[traceIdx - 1] : null
  const nextTrace = traceIdx < DEMO_TRACES.length - 1 ? DEMO_TRACES[traceIdx + 1] : null

  if (!traceDetail) {
    return (
      <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col h-screen overflow-hidden bg-bg">
        <Topbar
          crumbs={[
            { label: 'Traces', href: '/demo/traces' },
            { label: 'Not found' },
          ]}
        />
        <div className="m-[22px] p-8 rounded-md border border-border text-center">
          <p className="text-[13px] text-text-muted mb-3">Trace not found.</p>
          <button
            type="button"
            onClick={() => router.push('/demo/traces')}
            className="font-mono text-[11.5px] text-accent hover:opacity-80 transition-opacity"
          >
            ← Back to traces
          </button>
        </div>
      </div>
    )
  }

  const traceName = traceDetail.name
  const crumbLabel = traceName.length > 28 ? traceName.slice(0, 28) + '…' : traceName

  const spans = traceDetail.spans
  const flatSpans = flattenSpanTree(spans)

  const traceStartMs = new Date(traceDetail.started_at).getTime()
  const totalDurationMs = traceDetail.duration_ms ?? 4000

  const selectedSpan = selectedSpanId ? spans.find((s) => s.id === selectedSpanId) ?? null : null

  // Stat strip values
  const isErr = traceDetail.status === 'error'
  const isRunning = traceDetail.status === 'running'

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col h-screen overflow-hidden bg-bg">
      <Topbar
        crumbs={[
          { label: 'Traces', href: '/demo/traces' },
          { label: crumbLabel },
        ]}
        right={
          (prevTrace || nextTrace) ? (
            <div className="flex items-center gap-2">
              {prevTrace && (
                <button
                  type="button"
                  onClick={() => router.push(`/demo/traces/${prevTrace.id}`)}
                  className="font-mono text-[11px] px-[9px] py-1 border border-border rounded-[5px] text-text-muted hover:border-border-strong transition-colors"
                >
                  ← prev
                </button>
              )}
              {nextTrace && (
                <button
                  type="button"
                  onClick={() => router.push(`/demo/traces/${nextTrace.id}`)}
                  className="font-mono text-[11px] px-[9px] py-1 border border-border rounded-[5px] text-text-muted hover:border-border-strong transition-colors"
                >
                  next →
                </button>
              )}
            </div>
          ) : undefined
        }
      />

      {/* Stat strip */}
      <div className="overflow-x-auto shrink-0 border-b border-border">
        <div className="grid grid-cols-5 min-w-[480px]">
          {[
            {
              label: 'Duration',
              value: fmtDuration(traceDetail.duration_ms),
              warn: false,
            },
            {
              label: 'Spans',
              value: String(spans.length),
              warn: false,
            },
            {
              label: 'Cost',
              value: fmtCost(traceDetail.total_cost_usd),
              warn: false,
            },
            {
              label: 'Tokens',
              value: traceDetail.total_tokens.toLocaleString(),
              warn: false,
            },
            {
              label: 'Status',
              value: isErr ? 'error' : isRunning ? 'live' : 'ok',
              warn: isErr,
            },
          ].map((s, i) => (
            <div
              key={i}
              className={cn('px-[18px] py-[14px]', i < 4 && 'border-r border-border')}
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">{s.label}</div>
              <span className={cn('text-[24px] font-medium leading-none tracking-[-0.6px]', s.warn ? 'text-bad' : 'text-text')}>
                {s.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Error banner */}
      {isErr && traceDetail.error_message && (
        <div className="shrink-0 mx-[22px] mt-3 px-3 py-2.5 rounded-[5px] border border-bad/20 bg-bad-bg">
          <span className="font-mono text-[11px] text-bad">{traceDetail.error_message}</span>
        </div>
      )}

      {/* Main area: waterfall + optional detail panel */}
      <div className="flex-1 flex overflow-hidden">
        {/* Waterfall */}
        <div className="flex-1 overflow-auto">
          {/* Waterfall header */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg-muted sticky top-0 z-10">
            <span className="shrink-0 w-[220px] font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">Span</span>
            <span className="flex-1 font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">Timeline</span>
            <span className="shrink-0 w-16 text-right font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">Dur</span>
          </div>

          {flatSpans.map(({ span, depth }) => (
            <SpanWaterfallRow
              key={span.id}
              span={span}
              depth={depth}
              totalDurationMs={totalDurationMs}
              traceStartMs={traceStartMs}
              isSelected={selectedSpanId === span.id}
              onClick={() => setSelectedSpanId(selectedSpanId === span.id ? null : span.id)}
            />
          ))}

          {flatSpans.length === 0 && (
            <div className="flex items-center justify-center h-32 text-[13px] text-text-muted">
              No spans recorded for this trace.
            </div>
          )}

          {/* Trace metadata footer */}
          <div className="px-4 py-4 border-t border-border mt-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">Trace metadata</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 font-mono text-[11px] text-text-muted">
              <span><span className="text-text-faint">ID:</span> {traceDetail.id}</span>
              <span><span className="text-text-faint">Started:</span> {new Date(traceDetail.started_at).toLocaleString()}</span>
              {Boolean(traceDetail.metadata?.environment) && (
                <span><span className="text-text-faint">Env:</span> {String(traceDetail.metadata?.environment ?? '')}</span>
              )}
              {Boolean(traceDetail.metadata?.agent_version) && (
                <span><span className="text-text-faint">Version:</span> {String(traceDetail.metadata?.agent_version ?? '')}</span>
              )}
            </div>
          </div>
        </div>

        {/* Span detail panel */}
        {selectedSpan && (
          <SpanDetailPanel span={selectedSpan} onClose={() => setSelectedSpanId(null)} />
        )}
      </div>
    </div>
  )
}
