'use client'

import Link from 'next/link'

interface ShareViewProps {
  share: {
    scope: 'trace' | 'request'
    indexable: boolean
    createdAt: string
    expiresAt: string | null
    viewCount: number
    /** PLG Loop ② — true only when the share's org is on team+ and opted out. */
    hidePoweredBy?: boolean
    payload: unknown
  }
}

interface SharedTracePayload {
  id: string
  name: string | null
  status: string
  started_at: string
  ended_at: string | null
  duration_ms: number | null
  span_count: number | null
  total_tokens: number | null
  total_cost_usd: number | string | null
  error_message: string | null
  spans: Array<SharedSpan>
  critical_span_ids: string[]
}

interface SharedSpan {
  id: string
  parent_span_id: string | null
  name: string | null
  span_type: string | null
  status: string | null
  started_at: string
  ended_at: string | null
  duration_ms: number | null
  input: unknown
  output: unknown
  error_message: string | null
  prompt_tokens: number | null
  completion_tokens: number | null
  total_tokens: number | null
  cost_usd: number | string | null
}

interface SharedRequestPayload {
  id: string
  provider: string
  model: string
  latency_ms: number
  status_code: number
  error_message: string | null
  truncated: boolean
  created_at: string
  cost_usd: number | null
  prompt_tokens: number | null
  completion_tokens: number | null
  total_tokens: number | null
  request_body: unknown
  response_body: unknown
}

export function ShareView({ share }: ShareViewProps) {
  return (
    <div className="min-h-screen bg-bg text-text [zoom:1.25]">
      <ShareHeader share={share} />
      <main className="max-w-5xl mx-auto px-6 py-8">
        {share.scope === 'trace' ? (
          <TraceView payload={share.payload as SharedTracePayload} />
        ) : (
          <RequestView payload={share.payload as SharedRequestPayload} />
        )}
      </main>
      {!share.hidePoweredBy && <ShareFooter />}
    </div>
  )
}

function ShareHeader({ share }: ShareViewProps) {
  const expiresLabel = share.expiresAt
    ? new Date(share.expiresAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : 'never'
  return (
    <header className="border-b border-border bg-bg-elevated">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/" className="font-mono text-[13px] font-semibold tracking-tight">
            Spanlens
          </Link>
          <span className="font-mono text-[11px] text-text-muted uppercase tracking-wider">
            Shared {share.scope}
          </span>
        </div>
        <div className="font-mono text-[11px] text-text-muted">
          {share.viewCount} {share.viewCount === 1 ? 'view' : 'views'} · expires {expiresLabel}
        </div>
      </div>
    </header>
  )
}

function ShareFooter() {
  return (
    <footer className="border-t border-border mt-12 py-6">
      <div className="max-w-5xl mx-auto px-6 flex items-center justify-between text-[11.5px] font-mono text-text-muted">
        <div>
          Observed by{' '}
          <Link href="/" className="text-accent hover:opacity-80">
            Spanlens
          </Link>{' '}
          — open-source LLM observability
        </div>
        <Link
          href="/signup"
          className="text-accent hover:opacity-80"
        >
          Try free →
        </Link>
      </div>
    </footer>
  )
}

// ── Trace view ──────────────────────────────────────────────────────────────

function TraceView({ payload }: { payload: SharedTracePayload }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[18px] font-semibold tracking-tight mb-1">
          {payload.name ?? 'Untitled trace'}
        </h1>
        <div className="font-mono text-[11px] text-text-muted">
          {payload.status} · started{' '}
          {new Date(payload.started_at).toLocaleString('en-US')}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Duration" value={payload.duration_ms != null ? `${payload.duration_ms} ms` : '—'} />
        <Stat label="Spans" value={payload.span_count != null ? String(payload.span_count) : String(payload.spans.length)} />
        <Stat
          label="Tokens"
          value={
            payload.total_tokens == null
              ? '•••'
              : Number(payload.total_tokens).toLocaleString('en-US')
          }
        />
        <Stat
          label="Cost"
          value={
            payload.total_cost_usd == null
              ? '$•••'
              : `$${Number(payload.total_cost_usd).toFixed(4)}`
          }
        />
      </div>

      {payload.error_message ? (
        <div className="border border-status-error/40 bg-status-error/5 rounded-md p-4 font-mono text-[12px] text-status-error">
          {payload.error_message}
        </div>
      ) : null}

      <section>
        <h2 className="text-[13px] font-semibold mb-3 uppercase tracking-wider text-text-muted">
          Spans ({payload.spans.length})
        </h2>
        <div className="space-y-2">
          {payload.spans.map((span) => (
            <SpanRow
              key={span.id}
              span={span}
              isCritical={payload.critical_span_ids.includes(span.id)}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

function SpanRow({ span, isCritical }: { span: SharedSpan; isCritical: boolean }) {
  return (
    <details className="border border-border rounded-md bg-bg-elevated">
      <summary className="cursor-pointer px-4 py-3 flex items-center justify-between gap-4 font-mono text-[12px]">
        <div className="flex items-center gap-3 min-w-0">
          {isCritical && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-accent/15 text-accent">
              critical
            </span>
          )}
          <span className="truncate">{span.name ?? '(unnamed)'}</span>
          {span.span_type && (
            <span className="text-[10px] text-text-muted uppercase tracking-wider">
              {span.span_type}
            </span>
          )}
        </div>
        <div className="text-[11px] text-text-muted flex items-center gap-3 shrink-0">
          <span>{span.duration_ms != null ? `${span.duration_ms} ms` : '—'}</span>
          {span.total_tokens != null && <span>{span.total_tokens} tok</span>}
        </div>
      </summary>
      <div className="px-4 pb-4 border-t border-border space-y-3">
        {span.error_message && (
          <div className="font-mono text-[11.5px] text-status-error whitespace-pre-wrap">
            {span.error_message}
          </div>
        )}
        {span.input != null && (
          <JsonBlock label="Input" value={span.input} />
        )}
        {span.output != null && (
          <JsonBlock label="Output" value={span.output} />
        )}
      </div>
    </details>
  )
}

// ── Request view ────────────────────────────────────────────────────────────

function RequestView({ payload }: { payload: SharedRequestPayload }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[18px] font-semibold tracking-tight mb-1">
          {payload.provider} · {payload.model}
        </h1>
        <div className="font-mono text-[11px] text-text-muted">
          {payload.status_code} · {new Date(payload.created_at).toLocaleString('en-US')}
          {payload.truncated && ' · truncated'}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Latency" value={`${payload.latency_ms} ms`} />
        <Stat
          label="Tokens"
          value={
            payload.total_tokens == null
              ? '•••'
              : Number(payload.total_tokens).toLocaleString('en-US')
          }
        />
        <Stat
          label="Prompt"
          value={payload.prompt_tokens == null ? '•••' : String(payload.prompt_tokens)}
        />
        <Stat
          label="Cost"
          value={
            payload.cost_usd == null
              ? '$•••'
              : `$${payload.cost_usd.toFixed(4)}`
          }
        />
      </div>

      {payload.error_message && (
        <div className="border border-status-error/40 bg-status-error/5 rounded-md p-4 font-mono text-[12px] text-status-error">
          {payload.error_message}
        </div>
      )}

      {payload.request_body != null && (
        <JsonBlock label="Request" value={payload.request_body} />
      )}
      {payload.response_body != null && (
        <JsonBlock label="Response" value={payload.response_body} />
      )}
    </div>
  )
}

// ── Primitives ──────────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded-md bg-bg-elevated p-3">
      <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">{label}</div>
      <div className="font-mono text-[14px] font-semibold">{value}</div>
    </div>
  )
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const text =
    typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-text-muted mb-2">
        {label}
      </div>
      <pre className="bg-bg-elevated border border-border rounded-md p-3 font-mono text-[11.5px] overflow-x-auto whitespace-pre-wrap break-words">
        {text}
      </pre>
    </div>
  )
}
