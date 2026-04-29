'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { Topbar } from '@/components/layout/topbar'
import { Gantt } from '@/components/traces/gantt'
import { useTrace } from '@/lib/queries/use-traces'
import type { SpanRow, SpanType } from '@/lib/queries/types'

function fmtMs(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function fmtCost(n: number | null): string {
  if (n == null || n === 0) return '—'
  return n < 0.001 ? '$' + n.toFixed(5) : '$' + n.toFixed(4)
}

function TypeGlyph({ type }: { type: string }) {
  const MAP: Record<string, string> = { llm: 'LLM', tool: 'TOOL', retrieval: 'RTRV', embedding: 'EMBD', custom: 'SPAN', http: 'HTTP' }
  const isLlm = type === 'llm'
  return (
    <span className={cn(
      'font-mono text-[9px] tracking-[0.05em] font-medium px-[5px] py-[2px] rounded-[3px] border',
      isLlm ? 'bg-accent-bg border-accent-border text-accent' : 'bg-transparent border-border text-text-faint',
    )}>
      {MAP[type] ?? 'SPAN'}
    </span>
  )
}

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyButton({ getText, label = 'Copy' }: { getText: () => string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(getText())
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className="font-mono text-[10px] px-1.5 py-0.5 border border-border rounded text-text-faint hover:text-text hover:border-border-strong transition-colors shrink-0"
    >
      {copied ? 'Copied' : label}
    </button>
  )
}

// ── Cost attribution bar ───────────────────────────────────────────────────────
const COST_PALETTE = [
  'oklch(0.82 0.14 58)',
  'oklch(0.74 0.14 64)',
  'oklch(0.66 0.14 70)',
  'oklch(0.58 0.14 76)',
]

function CostAttribution({ spans, total }: { spans: SpanRow[]; total: number }) {
  const buckets = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of spans) {
      if ((s.cost_usd ?? 0) > 0) {
        map.set(s.name, (map.get(s.name) ?? 0) + (s.cost_usd ?? 0))
      }
    }
    const sorted = [...map.entries()].sort((a, b) => b[1] - a[1])
    const top = sorted.slice(0, 4)
    const otherCost = sorted.slice(4).reduce((s, [, c]) => s + c, 0)
    const result = top.map(([name, cost]) => ({ name, cost, pct: (cost / total) * 100 }))
    if (otherCost > 0) result.push({ name: 'other', cost: otherCost, pct: (otherCost / total) * 100 })
    return result
  }, [spans, total])

  if (buckets.length === 0) return null

  return (
    <div className="px-[22px] py-[14px] border-b border-border shrink-0">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
          Cost attribution · {fmtCost(total)}
        </span>
      </div>
      <div className="flex h-[14px] rounded-[3px] overflow-hidden border border-border">
        {buckets.map((b, i) => (
          <div
            key={b.name}
            style={{
              width: `${b.pct}%`,
              background: b.name === 'other' ? 'var(--bg-muted)' : COST_PALETTE[i] ?? COST_PALETTE[3],
              borderRight: i < buckets.length - 1 ? '1px solid var(--bg)' : 'none',
            }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {buckets.map((b, i) => (
          <span key={b.name} className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-text-muted">
            <span
              className="w-2 h-2 rounded-[2px] border border-border inline-block"
              style={{ background: b.name === 'other' ? 'var(--bg-muted)' : COST_PALETTE[i] ?? COST_PALETTE[3] }}
            />
            <span className="text-text">{b.name}</span>
            <span className="text-text-faint">{b.pct.toFixed(1)}%</span>
          </span>
        ))}
      </div>
    </div>
  )
}

// ── LLM message renderer (span input tab) ────────────────────────────────────
function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b !== 'object' || b === null) return ''
        const block = b as Record<string, unknown>
        if (typeof block.text === 'string') return block.text
        if (block.type === 'image') return '[image]'
        if (block.type === 'tool_use') return `[tool_use: ${String(block.name ?? '')}]`
        if (block.type === 'tool_result') return '[tool_result]'
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return JSON.stringify(content)
}

function LlmMessageView({ input }: { input: unknown }) {
  const body = (input && typeof input === 'object') ? input as Record<string, unknown> : null

  const systemText = useMemo(() => {
    if (!body) return null
    if (typeof body.system === 'string' && body.system.trim()) return body.system
    if (Array.isArray(body.system)) {
      return (body.system as unknown[])
        .map((s) => {
          if (typeof s === 'object' && s !== null && typeof (s as Record<string, unknown>).text === 'string')
            return (s as Record<string, unknown>).text as string
          return ''
        })
        .filter(Boolean)
        .join('\n')
    }
    return null
  }, [body])

  if (!body) return null

  let messages: Array<{ role: string; content: unknown }> | null = null

  if (Array.isArray(body.messages)) {
    messages = (body.messages as unknown[]).filter(
      (m): m is { role: string; content: unknown } =>
        typeof m === 'object' && m !== null && typeof (m as { role?: unknown }).role === 'string',
    )
  } else if (Array.isArray(body.contents)) {
    // Gemini
    messages = (body.contents as unknown[])
      .filter(
        (m): m is { role: string; parts: Array<{ text?: string }> } =>
          typeof m === 'object' && m !== null &&
          typeof (m as Record<string, unknown>).role === 'string' &&
          Array.isArray((m as Record<string, unknown>).parts),
      )
      .map((m) => ({
        role: m.role === 'model' ? 'assistant' : m.role,
        content: m.parts.filter((p) => typeof p.text === 'string').map((p) => p.text as string).join(''),
      }))
  }

  if (!systemText && (!messages || messages.length === 0)) return null

  return (
    <div className="space-y-2">
      {systemText && (
        <div className="rounded-[5px] border border-border bg-bg-muted p-3">
          <div className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-text-faint mb-1.5">System</div>
          <p className="font-mono text-[11.5px] text-text-muted leading-relaxed whitespace-pre-wrap">{systemText}</p>
        </div>
      )}
      {messages?.map((m, i) => {
        const isUser = m.role === 'user'
        const text = extractText(m.content)
        return (
          <div key={i} className={cn('rounded-[5px] p-3 border', isUser ? 'bg-bg-elev border-border' : 'bg-accent-bg border-accent-border')}>
            <div className={cn('font-mono text-[9.5px] uppercase tracking-[0.06em] mb-1.5', isUser ? 'text-text-faint' : 'text-accent')}>
              {m.role}
            </div>
            <p className="font-mono text-[11.5px] text-text-muted leading-relaxed whitespace-pre-wrap break-words">
              {text || <span className="italic text-text-faint">empty</span>}
            </p>
          </div>
        )
      })}
    </div>
  )
}

// ── Span drawer ────────────────────────────────────────────────────────────────
type SpanTab = 'input' | 'output' | 'attrs' | 'raw'

interface SpanDrawerProps {
  span: SpanRow
  onClose: () => void
  onPrev: () => void
  onNext: () => void
  hasPrev: boolean
  hasNext: boolean
  position: number
  total: number
}

function SpanDrawer({ span, onClose, onPrev, onNext, hasPrev, hasNext, position, total }: SpanDrawerProps) {
  const [tab, setTab] = useState<SpanTab>('input')
  useEffect(() => { setTab('input') }, [span.id])

  const isLlm = span.span_type === 'llm'

  return (
    <aside className="w-[440px] shrink-0 border-l border-border bg-bg-elev overflow-auto flex flex-col">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2 mb-2.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">Span</span>
          <TypeGlyph type={span.span_type} />
          {position > 0 && (
            <span className="font-mono text-[10px] text-text-faint">{position} / {total}</span>
          )}
          <span className="flex-1" />
          {span.request_id && (
            <Link
              href={`/requests/${span.request_id}`}
              className="font-mono text-[10px] px-1.5 py-0.5 border border-border rounded text-accent tracking-[0.04em] uppercase hover:border-accent-border transition-colors"
            >
              Open request →
            </Link>
          )}
          {[
            { label: 'Prev', onClick: onPrev, disabled: !hasPrev },
            { label: 'Next', onClick: onNext, disabled: !hasNext },
          ].map(({ label, onClick, disabled }) => (
            <button
              key={label}
              onClick={onClick}
              disabled={disabled}
              className="font-mono text-[10px] px-1.5 py-0.5 border border-border rounded text-text-muted tracking-[0.04em] uppercase disabled:opacity-30 hover:border-border-strong transition-colors"
            >
              {label}
            </button>
          ))}
          <button
            onClick={onClose}
            className="font-mono text-[10px] px-1.5 py-0.5 border border-border rounded text-text-muted tracking-[0.04em] uppercase hover:border-border-strong transition-colors"
          >
            Close
          </button>
        </div>
        <div className="font-mono text-[14px] text-text mb-1 truncate">{span.name}</div>
        <div className="flex items-center gap-2 font-mono text-[12px] text-text-muted">
          <span title={span.id}>{span.id.slice(0, 12)}…</span>
          <CopyButton getText={() => span.id} />
          <span className="text-text-faint">·</span>
          <span>{span.span_type}</span>
          {span.parent_span_id && (
            <>
              <span className="text-text-faint">·</span>
              <span>child</span>
            </>
          )}
          {span.status === 'error' && (
            <>
              <span className="flex-1" />
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-bad-bg text-bad border border-bad/20 uppercase tracking-[0.04em]">
                Error
              </span>
            </>
          )}
        </div>
      </div>

      {/* Metrics */}
      <div className="px-5 py-3.5 border-b border-border grid grid-cols-3">
        {[
          { label: 'Latency', value: fmtMs(span.duration_ms), warn: false },
          { label: 'Cost', value: fmtCost(span.cost_usd) },
          { label: 'Tokens', value: span.total_tokens > 0 ? span.total_tokens.toLocaleString() : '—', sub: span.total_tokens > 0 ? `${span.prompt_tokens} in / ${span.completion_tokens} out` : '' },
        ].map((s, i) => (
          <div key={s.label} className={cn('pr-3 pl-3', i === 0 && 'pl-0', i === 2 && 'pr-0', i < 2 && 'border-r border-border')}>
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-1.5">{s.label}</div>
            <div className={cn('text-[20px] font-medium tracking-[-0.3px] leading-none', s.warn ? 'text-accent' : 'text-text')}>
              {s.value}
            </div>
            {'sub' in s && s.sub && (
              <div className="font-mono text-[10px] text-text-faint mt-1 tracking-[0.03em]">{s.sub}</div>
            )}
          </div>
        ))}
      </div>

      {/* Error message */}
      {span.error_message && (
        <div className="mx-5 mt-3.5 px-3 py-2.5 rounded-[5px] border border-bad/20 bg-bad-bg">
          <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-bad mb-1">Error</div>
          <p className="font-mono text-[11.5px] text-bad leading-relaxed">{span.error_message}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex px-5 border-b border-border gap-5 shrink-0 mt-1">
        {(['input', 'output', 'attrs', 'raw'] as SpanTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'py-2.5 font-mono text-[11px] uppercase tracking-[0.04em] border-b-[1.5px] -mb-px transition-colors',
              tab === t ? 'text-text border-accent' : 'text-text-muted border-transparent hover:text-text',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="px-5 py-4 flex-1 overflow-auto">
        {tab === 'input' ? (
          span.input != null ? (
            <div className="space-y-3">
              <div className="flex justify-end">
                <CopyButton getText={() => JSON.stringify(span.input, null, 2)} />
              </div>
              {isLlm ? (
                <LlmMessageView input={span.input} />
              ) : (
                <pre className="font-mono text-[11.5px] text-text-muted leading-relaxed whitespace-pre-wrap break-all">
                  {JSON.stringify(span.input, null, 2)}
                </pre>
              )}
            </div>
          ) : (
            <p className="font-mono text-[11.5px] text-text-faint">No input recorded.</p>
          )
        ) : tab === 'output' ? (
          span.output != null ? (
            <div className="space-y-3">
              <div className="flex justify-end">
                <CopyButton getText={() => JSON.stringify(span.output, null, 2)} />
              </div>
              <pre className="font-mono text-[11.5px] text-text-muted leading-relaxed whitespace-pre-wrap break-all">
                {JSON.stringify(span.output, null, 2)}
              </pre>
            </div>
          ) : (
            <p className="font-mono text-[11.5px] text-text-faint">No output recorded.</p>
          )
        ) : tab === 'attrs' ? (
          span.metadata ? (
            <pre className="font-mono text-[11.5px] text-text-muted leading-relaxed whitespace-pre-wrap break-all">
              {JSON.stringify(span.metadata, null, 2)}
            </pre>
          ) : (
            <p className="font-mono text-[11.5px] text-text-faint">No metadata.</p>
          )
        ) : (
          <div className="space-y-2">
            <div className="flex justify-end">
              <CopyButton getText={() => JSON.stringify({ id: span.id, name: span.name, type: span.span_type, status: span.status, started_at: span.started_at, ended_at: span.ended_at, duration_ms: span.duration_ms, tokens: span.total_tokens, cost_usd: span.cost_usd, request_id: span.request_id }, null, 2)} />
            </div>
            <pre className="font-mono text-[11.5px] text-text-muted leading-relaxed whitespace-pre-wrap break-all">
              {JSON.stringify({ id: span.id, name: span.name, type: span.span_type, status: span.status, started_at: span.started_at, ended_at: span.ended_at, duration_ms: span.duration_ms, tokens: span.total_tokens, cost_usd: span.cost_usd, request_id: span.request_id }, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </aside>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────────
export default function TraceDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const [selectedSpan, setSelectedSpan] = useState<SpanRow | null>(null)
  const [spanSearch, setSpanSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<SpanType | 'all'>('all')
  const [errorsOnly, setErrorsOnly] = useState(false)
  const [errorJumpIdx, setErrorJumpIdx] = useState(0)
  const [shareCopied, setShareCopied] = useState(false)

  const { data: trace, isLoading, isError, refetch } = useTrace(params.id)

  // Read navigation list written by the traces list page
  const navIds = useMemo(() => {
    if (typeof window === 'undefined') return [] as string[]
    try {
      const raw = sessionStorage.getItem('traceNavList')
      const parsed = raw ? (JSON.parse(raw) as { ids: string[] }) : null
      return parsed?.ids ?? ([] as string[])
    } catch { return [] as string[] }
  }, [])
  const navIdx = navIds.indexOf(params.id)
  const prevId = navIdx > 0 ? navIds[navIdx - 1] : null
  const nextId = navIdx < navIds.length - 1 ? navIds[navIdx + 1] : null

  const filteredSpans = useMemo(() => {
    if (!trace) return []
    let spans = trace.spans
    if (spanSearch.trim()) {
      const q = spanSearch.toLowerCase()
      spans = spans.filter((s) => s.name.toLowerCase().includes(q))
    }
    if (typeFilter !== 'all') {
      spans = spans.filter((s) => s.span_type === typeFilter)
    }
    if (errorsOnly) {
      spans = spans.filter((s) => s.status === 'error')
    }
    return spans
  }, [trace, spanSearch, typeFilter, errorsOnly])

  // Spans shown in Gantt — use filteredSpans when any filter is active
  const hasFilter = spanSearch.trim() !== '' || typeFilter !== 'all' || errorsOnly
  const effectiveSpans = hasFilter ? filteredSpans : (trace?.spans ?? [])

  // Span drawer Prev/Next is based on the currently visible spans
  const effectiveIdx = selectedSpan ? effectiveSpans.findIndex((s) => s.id === selectedSpan.id) : -1

  const typeCounts = useMemo(() => {
    if (!trace) return {} as Record<string, number>
    const counts: Record<string, number> = { all: trace.spans.length }
    for (const s of trace.spans) {
      counts[s.span_type] = (counts[s.span_type] ?? 0) + 1
    }
    return counts
  }, [trace])

  const bottleneck = useMemo(() => {
    if (!trace?.spans.length) return null
    return [...trace.spans]
      .filter((s) => s.duration_ms != null)
      .sort((a, b) => (b.duration_ms ?? 0) - (a.duration_ms ?? 0))[0] ?? null
  }, [trace])

  const errorSpans = useMemo(() => trace?.spans.filter((s) => s.status === 'error') ?? [], [trace])

  function handleErrorJump() {
    if (errorSpans.length === 0) return
    const idx = errorJumpIdx % errorSpans.length
    setSelectedSpan(errorSpans[idx] ?? null)
    setErrorJumpIdx(idx + 1)
  }

  function handleShare() {
    void navigator.clipboard.writeText(window.location.href)
    setShareCopied(true)
    setTimeout(() => setShareCopied(false), 2000)
  }

  if (isLoading) {
    return (
      <div className="-m-7 flex flex-col h-screen overflow-hidden">
        <Topbar crumbs={[{ label: 'Workspace' }, { label: 'Traces', href: '/traces' }, { label: '…' }]} />
        <div className="p-[22px] space-y-4">
          <Skeleton className="h-6 w-64" />
          <div className="grid grid-cols-5 gap-6">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    )
  }

  if (isError || !trace) {
    return (
      <div className="-m-7 flex flex-col h-screen overflow-hidden">
        <Topbar crumbs={[{ label: 'Workspace' }, { label: 'Traces', href: '/traces' }, { label: 'Not found' }]} />
        <div className="m-[22px] p-8 rounded-md border border-border text-center">
          <p className="text-[13px] text-text-muted mb-3">Trace not found or no longer available.</p>
          <button onClick={() => void refetch()} className="font-mono text-[11.5px] text-accent hover:opacity-80 transition-opacity">
            Try again
          </button>
        </div>
      </div>
    )
  }

  const bottleneckPct = bottleneck && trace.duration_ms
    ? Math.round(((bottleneck.duration_ms ?? 0) / trace.duration_ms) * 100)
    : 0

  return (
    <div className="-m-7 flex flex-col h-screen overflow-hidden">
      <Topbar
        crumbs={[
          { label: 'Workspace' },
          { label: 'Traces', href: '/traces' },
          { label: trace.name.length > 28 ? trace.name.slice(0, 28) + '…' : trace.name },
        ]}
        right={
          <div className="flex items-center gap-2">
            {prevId && (
              <button
                onClick={() => router.push(`/traces/${prevId}`)}
                className="font-mono text-[11px] px-[9px] py-1 border border-border rounded-[5px] text-text-muted hover:border-border-strong transition-colors"
              >
                ← prev
              </button>
            )}
            {nextId && (
              <button
                onClick={() => router.push(`/traces/${nextId}`)}
                className="font-mono text-[11px] px-[9px] py-1 border border-border rounded-[5px] text-text-muted hover:border-border-strong transition-colors"
              >
                next →
              </button>
            )}
            <button
              onClick={handleShare}
              className="font-mono text-[11px] px-[10px] py-1 border border-border rounded-[5px] bg-bg-elev text-text hover:border-border-strong transition-colors"
            >
              {shareCopied ? 'Copied!' : 'Share'}
            </button>
          </div>
        }
      />

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Trace header */}
          <div className="px-[22px] pt-4 pb-[14px] border-b border-border shrink-0">
            <div className="flex items-baseline gap-3 mb-3.5">
              <span className="text-[22px] font-medium tracking-[-0.5px] text-text">{trace.name}</span>
              <span className="font-mono text-[11.5px] text-text-faint tracking-[0.03em]">
                {new Date(trace.started_at).toLocaleString()}
              </span>
              <span className="flex-1" />
              {errorSpans.length > 0 && (
                <button
                  onClick={handleErrorJump}
                  className="font-mono text-[10.5px] px-2 py-[3px] rounded-[3px] bg-accent-bg text-accent border border-accent-border tracking-[0.04em] uppercase hover:opacity-80 transition-opacity"
                >
                  {errorSpans.length} error{errorSpans.length !== 1 ? 's' : ''}
                  {errorSpans.length > 1 ? ` · ${(errorJumpIdx % errorSpans.length) + 1}/${errorSpans.length}` : ''} →
                </button>
              )}
            </div>
            <div className="grid grid-cols-5 gap-6">
              {[
                { label: 'Duration', value: fmtMs(trace.duration_ms) },
                { label: 'Spans', value: trace.span_count.toString() },
                { label: 'Tokens', value: trace.total_tokens.toLocaleString() },
                { label: 'Cost', value: fmtCost(trace.total_cost_usd) },
                {
                  label: 'Bottleneck',
                  value: bottleneck ? `${bottleneckPct}% · ${bottleneck.name}` : '—',
                  accent: !!bottleneck,
                },
              ].map((s) => (
                <div key={s.label}>
                  <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-1.5">{s.label}</div>
                  <div className={cn('text-[18px] font-medium tracking-[-0.3px]', 'accent' in s && s.accent ? 'text-accent' : 'text-text')}>
                    {s.value}
                  </div>
                </div>
              ))}
            </div>

            {/* Trace metadata */}
            {trace.metadata && Object.keys(trace.metadata).length > 0 && (
              <div className="mt-3.5 pt-3.5 border-t border-border">
                <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">Metadata</div>
                <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                  {Object.entries(trace.metadata).map(([k, v]) => (
                    <span key={k} className="font-mono text-[11px] text-text-muted">
                      <span className="text-text-faint">{k}:</span>{' '}
                      <span className="text-text">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <CostAttribution spans={trace.spans} total={trace.total_cost_usd} />

          {/* Span filter toolbar */}
          <div className="flex items-center gap-2 px-[22px] py-[10px] border-b border-border shrink-0">
            <div className="inline-flex items-center gap-2 px-[10px] py-[5px] border border-border rounded-[5px] bg-bg-elev font-mono text-[11.5px] text-text-muted w-64">
              <span className="text-text-faint">⌕</span>
              <input
                value={spanSearch}
                onChange={(e) => setSpanSearch(e.target.value)}
                placeholder="Search span name…"
                className="flex-1 bg-transparent outline-none placeholder:text-text-faint"
              />
              {spanSearch && (
                <button type="button" onClick={() => setSpanSearch('')} className="text-text-faint hover:text-text text-[13px] leading-none">×</button>
              )}
            </div>

            <div className="flex border border-border rounded-[5px] overflow-hidden bg-bg-elev font-mono text-[10.5px] tracking-[0.03em]">
              {([['all', 'All'], ['llm', 'LLM'], ['tool', 'Tool'], ['retrieval', 'Retrieval']] as [SpanType | 'all', string][]).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setTypeFilter(v)}
                  className={cn(
                    'px-[10px] py-[5px] inline-flex items-center gap-1.5',
                    typeFilter === v ? 'bg-text text-bg' : 'text-text-muted hover:text-text transition-colors',
                  )}
                >
                  {label}
                  <span className={typeFilter === v ? 'opacity-60 text-bg' : 'text-text-faint'}>
                    {typeCounts[v] ?? 0}
                  </span>
                </button>
              ))}
            </div>

            <button
              onClick={() => setErrorsOnly((v) => !v)}
              className={cn(
                'inline-flex items-center gap-1.5 px-[10px] py-[5px] rounded-[5px] font-mono text-[11px] border transition-colors',
                errorsOnly
                  ? 'bg-bad-bg border-bad/20 text-bad'
                  : 'border-border text-text-muted hover:border-border-strong hover:text-text',
              )}
            >
              <span className={cn('w-2 h-2 rounded-[2px] border inline-block', errorsOnly ? 'border-bad bg-bad/20' : 'border-border')} />
              errors only
            </button>

            <span className="flex-1" />
            <span className="font-mono text-[11px] text-text-faint">
              {effectiveSpans.length} of {trace.span_count} spans
            </span>
          </div>

          {/* Gantt */}
          <div className="overflow-auto flex-1 min-h-0">
            <div className="p-[22px]">
              <Gantt
                traceStartedAt={trace.started_at}
                traceEndedAt={trace.ended_at}
                spans={effectiveSpans}
                onSelectSpan={setSelectedSpan}
                selectedSpanId={selectedSpan?.id ?? null}
              />

              {/* Critical path summary footer */}
              {bottleneck && trace.duration_ms && (
                <div className="mt-4 px-4 py-3.5 rounded-md border border-accent-border bg-accent-bg flex items-center gap-3.5">
                  <div className="w-8 h-8 rounded-full border-[1.5px] border-accent flex items-center justify-center font-mono text-[11px] text-accent font-medium shrink-0">
                    CP
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-accent mb-1">Critical path</div>
                    <div className="text-[13px] text-text leading-relaxed">
                      <strong>{bottleneckPct}%</strong> of this trace&apos;s {fmtMs(trace.duration_ms)} is spent in{' '}
                      <strong>{bottleneck.name}</strong> ({fmtMs(bottleneck.duration_ms)}) —{' '}
                      {bottleneck.span_type === 'llm' ? 'an LLM call' : 'a ' + bottleneck.span_type + ' span'}.
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedSpan(bottleneck)}
                    className="font-mono text-[10.5px] px-3 py-[5px] rounded-[4px] bg-text text-bg uppercase tracking-[0.04em] shrink-0 hover:opacity-90 transition-opacity"
                  >
                    Open span →
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {selectedSpan && (
          <SpanDrawer
            span={selectedSpan}
            onClose={() => setSelectedSpan(null)}
            onPrev={() => {
              if (effectiveIdx > 0) setSelectedSpan(effectiveSpans[effectiveIdx - 1] ?? null)
            }}
            onNext={() => {
              if (effectiveIdx < effectiveSpans.length - 1) setSelectedSpan(effectiveSpans[effectiveIdx + 1] ?? null)
            }}
            hasPrev={effectiveIdx > 0}
            hasNext={effectiveIdx < effectiveSpans.length - 1}
            position={effectiveIdx + 1}
            total={effectiveSpans.length}
          />
        )}
      </div>
    </div>
  )
}
