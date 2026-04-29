'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Gantt } from '@/components/traces/gantt'
import { useTrace } from '@/lib/queries/use-traces'
import { Skeleton } from '@/components/ui/skeleton'
import type { SpanRow, SpanType } from '@/lib/queries/types'

// ── Helpers ───────────────────────────────────────────────────────────────────
export function fmtMs(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1) return '<1ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

export function fmtTimestamp(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function fmtCost(n: number | null): string {
  if (n == null || n === 0) return '—'
  return n < 0.001 ? '$' + n.toFixed(5) : '$' + n.toFixed(4)
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function TypeGlyph({ type }: { type: string }) {
  const MAP: Record<string, string> = {
    llm: 'LLM', tool: 'TOOL', retrieval: 'RTRV',
    embedding: 'EMBD', custom: 'SPAN', http: 'HTTP',
  }
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

const COST_PALETTE = [
  'oklch(0.82 0.14 58)', 'oklch(0.74 0.14 64)',
  'oklch(0.66 0.14 70)', 'oklch(0.58 0.14 76)',
]

function CostAttribution({ spans, total }: { spans: SpanRow[]; total: number }) {
  const buckets = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of spans) {
      if ((s.cost_usd ?? 0) > 0) map.set(s.name, (map.get(s.name) ?? 0) + (s.cost_usd ?? 0))
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
      <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
        Cost attribution · {fmtCost(total)}
      </span>
      <div className="flex h-[14px] rounded-[3px] overflow-hidden border border-border mt-2">
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
            <span className="w-2 h-2 rounded-[2px] border border-border inline-block"
              style={{ background: b.name === 'other' ? 'var(--bg-muted)' : COST_PALETTE[i] ?? COST_PALETTE[3] }} />
            <span className="text-text">{b.name}</span>
            <span className="text-text-faint">{b.pct.toFixed(1)}%</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((b) => {
      if (typeof b !== 'object' || b === null) return ''
      const block = b as Record<string, unknown>
      if (typeof block.text === 'string') return block.text
      if (block.type === 'image') return '[image]'
      if (block.type === 'tool_use') return `[tool_use: ${String(block.name ?? '')}]`
      if (block.type === 'tool_result') return '[tool_result]'
      return ''
    }).filter(Boolean).join('\n')
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
        .filter(Boolean).join('\n')
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
            <div className={cn('font-mono text-[9.5px] uppercase tracking-[0.06em] mb-1.5', isUser ? 'text-text-faint' : 'text-accent')}>{m.role}</div>
            <p className="font-mono text-[11.5px] text-text-muted leading-relaxed whitespace-pre-wrap break-words">
              {text || <span className="italic text-text-faint">empty</span>}
            </p>
          </div>
        )
      })}
    </div>
  )
}

function LlmOutputView({ output }: { output: unknown }) {
  const body = (output && typeof output === 'object') ? output as Record<string, unknown> : null

  // OpenAI Chat Completions: choices[].message
  if (body && Array.isArray(body.choices) && body.choices.length > 0) {
    const messages = (body.choices as unknown[]).flatMap((c) => {
      if (typeof c !== 'object' || c === null) return []
      const choice = c as Record<string, unknown>
      const msg = choice.message
      if (typeof msg !== 'object' || msg === null) return []
      const m = msg as Record<string, unknown>
      const role = typeof m.role === 'string' ? m.role : 'assistant'
      if (Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
        const toolText = (m.tool_calls as unknown[]).map((tc) => {
          if (typeof tc !== 'object' || tc === null) return ''
          const fn = (tc as Record<string, unknown>).function as Record<string, unknown> | undefined
          return `[tool_call: ${String(fn?.name ?? '')}(${String(fn?.arguments ?? '')})]`
        }).join('\n')
        return [{ role, content: toolText, isAssistant: true }]
      }
      return [{ role, content: m.content, isAssistant: role !== 'user' }]
    })
    if (messages.length > 0) {
      return (
        <div className="space-y-2">
          {messages.map((m, i) => (
            <div key={i} className={cn('rounded-[5px] p-3 border', m.isAssistant ? 'bg-accent-bg border-accent-border' : 'bg-bg-elev border-border')}>
              <div className={cn('font-mono text-[9.5px] uppercase tracking-[0.06em] mb-1.5', m.isAssistant ? 'text-accent' : 'text-text-faint')}>{m.role}</div>
              <p className="font-mono text-[11.5px] text-text-muted leading-relaxed whitespace-pre-wrap break-words">
                {extractText(m.content) || <span className="italic text-text-faint">empty</span>}
              </p>
            </div>
          ))}
        </div>
      )
    }
  }

  // Anthropic Messages: content[] + role at top level
  if (body && Array.isArray(body.content) && body.content.length > 0) {
    const role = typeof body.role === 'string' ? body.role : 'assistant'
    const text = (body.content as unknown[]).map((block) => {
      if (typeof block !== 'object' || block === null) return ''
      const b = block as Record<string, unknown>
      if (b.type === 'text' && typeof b.text === 'string') return b.text
      if (b.type === 'tool_use') return `[tool_use: ${String(b.name ?? '')}]`
      return ''
    }).filter(Boolean).join('\n')
    if (text) {
      return (
        <div className="rounded-[5px] p-3 border bg-accent-bg border-accent-border">
          <div className="font-mono text-[9.5px] uppercase tracking-[0.06em] mb-1.5 text-accent">{role}</div>
          <p className="font-mono text-[11.5px] text-text-muted leading-relaxed whitespace-pre-wrap break-words">{text}</p>
        </div>
      )
    }
  }

  // Gemini: generateContent() returns { response: { candidates, usageMetadata } }
  // Unwrap .response if present, then check candidates[].content.parts
  const geminiBody = (body?.response && typeof body.response === 'object')
    ? body.response as Record<string, unknown>
    : body
  if (geminiBody && Array.isArray(geminiBody.candidates) && geminiBody.candidates.length > 0) {
    const messages = (geminiBody.candidates as unknown[]).flatMap((c) => {
      if (typeof c !== 'object' || c === null) return []
      const candidate = c as Record<string, unknown>
      const content = candidate.content as Record<string, unknown> | undefined
      if (!content) return []
      const role = typeof content.role === 'string' ? content.role : 'model'
      const parts = Array.isArray(content.parts) ? content.parts as unknown[] : []
      const text = parts.map((p) => {
        if (typeof p !== 'object' || p === null) return ''
        return typeof (p as Record<string, unknown>).text === 'string'
          ? (p as Record<string, unknown>).text as string
          : ''
      }).filter(Boolean).join('')
      return text ? [{ role, text }] : []
    })
    if (messages.length > 0) {
      return (
        <div className="space-y-2">
          {messages.map((m, i) => (
            <div key={i} className="rounded-[5px] p-3 border bg-accent-bg border-accent-border">
              <div className="font-mono text-[9.5px] uppercase tracking-[0.06em] mb-1.5 text-accent">{m.role}</div>
              <p className="font-mono text-[11.5px] text-text-muted leading-relaxed whitespace-pre-wrap break-words">{m.text}</p>
            </div>
          ))}
        </div>
      )
    }
  }

  // Fallback: raw JSON
  return (
    <pre className="font-mono text-[11.5px] text-text-muted leading-relaxed whitespace-pre-wrap break-all">
      {JSON.stringify(output, null, 2)}
    </pre>
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
  traceDurationMs: number | null
  traceTotalCost: number
  isCritical: boolean
}

function SpanDrawer({ span, onClose, onPrev, onNext, hasPrev, hasNext, position, total, traceDurationMs, traceTotalCost, isCritical }: SpanDrawerProps) {
  const [tab, setTab] = useState<SpanTab>('input')
  useEffect(() => { setTab('input') }, [span.id])
  const isLlm = span.span_type === 'llm'

  const durationPct = traceDurationMs && span.duration_ms
    ? Math.round((span.duration_ms / traceDurationMs) * 100)
    : 0
  const costPct = traceTotalCost > 0 && (span.cost_usd ?? 0) > 0
    ? Math.round(((span.cost_usd ?? 0) / traceTotalCost) * 100)
    : 0

  const rawObj = {
    id: span.id, name: span.name, type: span.span_type, status: span.status,
    started_at: span.started_at, ended_at: span.ended_at, duration_ms: span.duration_ms,
    tokens: span.total_tokens, cost_usd: span.cost_usd, request_id: span.request_id,
    metadata: span.metadata,
  }

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
              type="button"
              onClick={onClick}
              disabled={disabled}
              className="font-mono text-[10px] px-1.5 py-0.5 border border-border rounded text-text-muted tracking-[0.04em] uppercase disabled:opacity-30 hover:border-border-strong transition-colors"
            >
              {label}
            </button>
          ))}
          <button
            type="button"
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
          {span.parent_span_id && <><span className="text-text-faint">·</span><span>child</span></>}
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
          { label: 'Latency', value: fmtMs(span.duration_ms) },
          { label: 'Cost', value: fmtCost(span.cost_usd) },
          {
            label: 'Tokens',
            value: span.total_tokens > 0 ? span.total_tokens.toLocaleString() : '—',
            sub: span.total_tokens > 0 ? `${span.prompt_tokens} in / ${span.completion_tokens} out` : '',
          },
        ].map((s, i) => (
          <div key={s.label} className={cn('pr-3 pl-3', i === 0 && 'pl-0', i === 2 && 'pr-0', i < 2 && 'border-r border-border')}>
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-1.5">{s.label}</div>
            <div className="text-[20px] font-medium tracking-[-0.3px] leading-none text-text">{s.value}</div>
            {'sub' in s && s.sub && <div className="font-mono text-[10px] text-text-faint mt-1 tracking-[0.03em]">{s.sub}</div>}
          </div>
        ))}
      </div>

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
            type="button"
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

      {/* BOTTLENECK section — sticky at bottom when this span is the critical path */}
      {isCritical && (
        <div className="px-5 py-4 border-t border-accent-border bg-accent-bg shrink-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-accent mb-2">
            Longest Span · Recommendation
          </div>
          <p className="text-[12px] text-text-muted leading-relaxed">
            This span accounts for{' '}
            <strong className="text-text">{durationPct}%</strong> of the trace&apos;s latency
            {costPct > 5 && (
              <> and <strong className="text-text">{costPct}%</strong> of cost</>
            )}.{' '}
            {isLlm
              ? 'For recall-heavy LLM calls, a lighter model often matches output quality at significantly lower latency and cost.'
              : 'Optimizing this span will have the highest impact on overall trace duration.'}
          </p>
        </div>
      )}

      {/* Tab content */}
      <div className="px-5 py-4 flex-1 overflow-auto">
        {tab === 'input' ? (
          span.input != null ? (
            <div className="space-y-3">
              <div className="flex justify-end">
                <CopyButton getText={() => JSON.stringify(span.input, null, 2)} />
              </div>
              {isLlm ? <LlmMessageView input={span.input} /> : (
                <pre className="font-mono text-[11.5px] text-text-muted leading-relaxed whitespace-pre-wrap break-all">
                  {JSON.stringify(span.input, null, 2)}
                </pre>
              )}
            </div>
          ) : <p className="font-mono text-[11.5px] text-text-faint">No input recorded.</p>
        ) : tab === 'output' ? (
          span.output != null ? (
            <div className="space-y-3">
              <div className="flex justify-end">
                <CopyButton getText={() => JSON.stringify(span.output, null, 2)} />
              </div>
              {isLlm ? <LlmOutputView output={span.output} /> : (
                <pre className="font-mono text-[11.5px] text-text-muted leading-relaxed whitespace-pre-wrap break-all">
                  {JSON.stringify(span.output, null, 2)}
                </pre>
              )}
            </div>
          ) : <p className="font-mono text-[11.5px] text-text-faint">No output recorded.</p>
        ) : tab === 'attrs' ? (
          span.metadata ? (
            <pre className="font-mono text-[11.5px] text-text-muted leading-relaxed whitespace-pre-wrap break-all">
              {JSON.stringify(span.metadata, null, 2)}
            </pre>
          ) : <p className="font-mono text-[11.5px] text-text-faint">No metadata.</p>
        ) : (
          <div className="space-y-2">
            <div className="flex justify-end">
              <CopyButton getText={() => JSON.stringify(rawObj, null, 2)} />
            </div>
            <pre className="font-mono text-[11.5px] text-text-muted leading-relaxed whitespace-pre-wrap break-all">
              {JSON.stringify(rawObj, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </aside>
  )
}

// ── TracePanel ──────────────────────────────────────────────────────────────────
export interface TracePanelProps {
  traceId: string
}

export function TracePanel({ traceId }: TracePanelProps) {
  const [selectedSpan, setSelectedSpan] = useState<SpanRow | null>(null)
  const [spanSearch, setSpanSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<SpanType | 'all'>('all')
  const [errorsOnly, setErrorsOnly] = useState(false)
  const [errorJumpIdx, setErrorJumpIdx] = useState(0)

  const { data: trace, isLoading, isError } = useTrace(traceId)

  // Reset span state when trace changes
  useEffect(() => {
    setSelectedSpan(null)
    setSpanSearch('')
    setTypeFilter('all')
    setErrorsOnly(false)
    setErrorJumpIdx(0)
  }, [traceId])

  const filteredSpans = useMemo(() => {
    if (!trace) return []
    let spans = trace.spans
    if (spanSearch.trim()) {
      const q = spanSearch.toLowerCase()
      spans = spans.filter((s) => s.name.toLowerCase().includes(q))
    }
    if (typeFilter !== 'all') spans = spans.filter((s) => s.span_type === typeFilter)
    if (errorsOnly) spans = spans.filter((s) => s.status === 'error')
    return spans
  }, [trace, spanSearch, typeFilter, errorsOnly])

  const hasFilter = spanSearch.trim() !== '' || typeFilter !== 'all' || errorsOnly
  const allIdx = (trace && selectedSpan) ? trace.spans.findIndex((s) => s.id === selectedSpan.id) : -1

  const typeCounts = useMemo(() => {
    if (!trace) return {} as Record<string, number>
    const counts: Record<string, number> = { all: trace.spans.length }
    for (const s of trace.spans) counts[s.span_type] = (counts[s.span_type] ?? 0) + 1
    return counts
  }, [trace])

  const bottleneck = useMemo(() => {
    if (!trace?.spans.length) return null
    return [...trace.spans].filter((s) => s.duration_ms != null)
      .sort((a, b) => (b.duration_ms ?? 0) - (a.duration_ms ?? 0))[0] ?? null
  }, [trace])

  const errorSpans = useMemo(() => trace?.spans.filter((s) => s.status === 'error') ?? [], [trace])

  function handleErrorJump() {
    if (errorSpans.length === 0) return
    const idx = errorJumpIdx % errorSpans.length
    setSelectedSpan(errorSpans[idx] ?? null)
    setErrorJumpIdx(idx + 1)
  }

  if (isLoading) {
    return (
      <div className="flex flex-col h-full border-l border-border bg-bg p-[22px] space-y-4">
        <Skeleton className="h-6 w-48" />
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (isError || !trace) {
    return (
      <div className="flex flex-col h-full border-l border-border bg-bg items-center justify-center gap-3">
        <p className="text-[13px] text-text-muted">Trace not found.</p>
      </div>
    )
  }

  const bottleneckPct = bottleneck && trace.duration_ms
    ? Math.round(((bottleneck.duration_ms ?? 0) / trace.duration_ms) * 100)
    : 0

  const statusBadge = trace.status === 'error'
    ? <span className="font-mono text-[9.5px] px-[6px] py-[2px] rounded-[3px] bg-bad-bg text-bad border border-bad/20 uppercase tracking-[0.04em]">error</span>
    : trace.status === 'running'
    ? <span className="font-mono text-[9.5px] px-[6px] py-[2px] rounded-[3px] bg-accent-bg text-accent border border-accent-border uppercase tracking-[0.04em] animate-pulse">running</span>
    : null

  return (
    <div className="flex h-full overflow-hidden border-l border-border bg-bg">
      <div className="flex flex-col flex-1 overflow-hidden">

        {/* Live indicator — only when trace is still running */}
        {trace.status === 'running' && (
          <div className="flex items-center gap-2 px-[22px] py-[5px] border-b border-accent-border/50 bg-accent-bg shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse inline-block shrink-0" />
            <span className="font-mono text-[10px] text-accent tracking-[0.03em]">Live · refreshing every 3s</span>
          </div>
        )}

        {/* Trace header */}
        <div className="px-[22px] pt-4 pb-[14px] border-b border-border shrink-0">
          <div className="flex items-baseline gap-3 mb-3.5">
            <span className="text-[20px] font-medium tracking-[-0.5px] text-text truncate">{trace.name}</span>
            {statusBadge}
            <span className="font-mono text-[11px] text-text-faint tracking-[0.03em] shrink-0">
              {fmtTimestamp(trace.started_at)}
            </span>
            <span className="flex-1" />
            {errorSpans.length > 0 && (
              <button
                type="button"
                onClick={handleErrorJump}
                className="font-mono text-[10.5px] px-2 py-[3px] rounded-[3px] bg-bad-bg text-bad border border-bad/20 tracking-[0.04em] uppercase hover:opacity-80 transition-opacity shrink-0"
              >
                {errorSpans.length} error{errorSpans.length !== 1 ? 's' : ''}
                {errorSpans.length > 1 ? ` · ${(errorJumpIdx % errorSpans.length) + 1}/${errorSpans.length}` : ''} →
              </button>
            )}
          </div>

          <div className="grid grid-cols-5 gap-4">
            {[
              { label: 'Duration', value: fmtMs(trace.duration_ms) },
              { label: 'Spans', value: trace.span_count.toString() },
              { label: 'Tokens', value: trace.total_tokens.toLocaleString() },
              { label: 'Cost', value: fmtCost(trace.total_cost_usd) },
              {
                label: 'Longest Span',
                value: bottleneck ? `${bottleneckPct}% · ${bottleneck.name}` : '—',
                accent: !!bottleneck,
              },
            ].map((s) => (
              <div key={s.label}>
                <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-1.5">{s.label}</div>
                <div className={cn('text-[16px] font-medium tracking-[-0.3px] truncate', 'accent' in s && s.accent ? 'text-accent' : 'text-text')}>
                  {s.value}
                </div>
              </div>
            ))}
          </div>

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
        <div className="flex items-center gap-2 px-[22px] py-[10px] border-b border-border shrink-0 flex-wrap">
          <div className="inline-flex items-center gap-2 px-[10px] py-[5px] border border-border rounded-[5px] bg-bg-elev font-mono text-[11.5px] text-text-muted w-56">
            <span className="text-text-faint">⌕</span>
            <input
              value={spanSearch}
              onChange={(e) => setSpanSearch(e.target.value)}
              placeholder="Search span…"
              className="flex-1 bg-transparent outline-none placeholder:text-text-faint text-[11px]"
            />
            {spanSearch && (
              <button type="button" onClick={() => setSpanSearch('')}
                className="text-text-faint hover:text-text text-[13px] leading-none">×</button>
            )}
          </div>

          <div className="flex border border-border rounded-[5px] overflow-hidden bg-bg-elev font-mono text-[10px] tracking-[0.03em]">
            {([
              ['all', 'All'], ['llm', 'LLM'], ['tool', 'Tool'],
              ['retrieval', 'Ret'], ['embedding', 'Embd'], ['custom', 'Custom'],
            ] as [SpanType | 'all', string][]).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setTypeFilter(v)}
                className={cn(
                  'px-[8px] py-[4px] inline-flex items-center gap-1',
                  typeFilter === v ? 'bg-text text-bg' : 'text-text-muted hover:text-text transition-colors',
                  !(typeCounts[v] ?? 0) && v !== 'all' && 'opacity-40',
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
            type="button"
            onClick={() => setErrorsOnly((v) => !v)}
            className={cn(
              'inline-flex items-center gap-1.5 px-[10px] py-[4px] rounded-[5px] font-mono text-[10px] border transition-colors',
              errorsOnly ? 'bg-bad-bg border-bad/20 text-bad' : 'border-border text-text-muted hover:border-border-strong hover:text-text',
            )}
          >
            <span className={cn('w-2 h-2 rounded-[2px] border inline-block', errorsOnly ? 'border-bad bg-bad/20' : 'border-border')} />
            errors only
          </button>

          <span className="flex-1" />
          <span className="font-mono text-[10.5px] text-text-faint">
            {hasFilter
              ? <>{filteredSpans.length} matching / {trace.span_count} total</>
              : <>{trace.span_count} total</>
            }
          </span>
        </div>

        {/* Gantt */}
        <div className="overflow-auto flex-1 min-h-0">
          <div className="p-[22px]">
            <Gantt
              traceStartedAt={trace.started_at}
              traceEndedAt={trace.ended_at}
              spans={trace.spans}
              onSelectSpan={setSelectedSpan}
              selectedSpanId={selectedSpan?.id ?? null}
              criticalSpanId={bottleneck?.id ?? null}
            />
            {bottleneck && trace.duration_ms && (
              <div className="mt-4 px-4 py-3.5 rounded-md border border-accent-border bg-accent-bg flex items-center gap-3.5">
                <div className="w-8 h-8 rounded-full border-[1.5px] border-accent flex items-center justify-center font-mono text-[11px] text-accent font-medium shrink-0">
                  LS
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-accent mb-1">Longest span</div>
                  <div className="text-[12.5px] text-text leading-relaxed">
                    <strong>{bottleneckPct}%</strong> of {fmtMs(trace.duration_ms)} in{' '}
                    <strong>{bottleneck.name}</strong> ({fmtMs(bottleneck.duration_ms)})
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedSpan(bottleneck)}
                  className="font-mono text-[10.5px] px-3 py-[5px] rounded-[4px] bg-text text-bg uppercase tracking-[0.04em] shrink-0 hover:opacity-90 transition-opacity"
                >
                  Open →
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
          onPrev={() => { if (allIdx > 0) setSelectedSpan(trace.spans[allIdx - 1] ?? null) }}
          onNext={() => { if (allIdx < trace.spans.length - 1) setSelectedSpan(trace.spans[allIdx + 1] ?? null) }}
          hasPrev={allIdx > 0}
          hasNext={allIdx < trace.spans.length - 1}
          position={allIdx + 1}
          total={trace.spans.length}
          traceDurationMs={trace.duration_ms}
          traceTotalCost={trace.total_cost_usd}
          isCritical={selectedSpan.id === bottleneck?.id}
        />
      )}
    </div>
  )
}
