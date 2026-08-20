'use client'

import Image from 'next/image'
import Link from 'next/link'
import { IOPreview } from '@/components/share/io-preview'
import { CopyPermalink } from '@/components/share/copy-permalink'
import { formatDate, formatDateTime } from '@/lib/utils'

/*
 * Public share viewer, ported from the `S1 · Public share / trace` and
 * `S2 · Public share / dashboard` boards in Figma
 * (file XCx3NR1is1GA3H6mVfLz7J).
 *
 * Composition: a 68px public bar, a link-scope banner, a divided summary
 * strip, the span waterfall and an inverted footer call to action. The reader
 * is usually not a Spanlens customer, so nothing here is interactive beyond
 * expanding a span.
 */

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
    /** R-26 Sprint 5: canonical share URL passed from the SSR page so
     *  the CopyPermalink button doesn't read window.location at first
     *  render (would crash SSR). */
    permalink?: string
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
    <div className="min-h-screen bg-bg text-text">
      <ShareHeader share={share} />
      <main className="mx-auto flex max-w-[1440px] flex-col gap-4 px-6 pb-8 pt-6 lg:px-10">
        <ScopeBanner share={share} />
        {share.scope === 'trace' ? (
          <TraceView payload={share.payload as SharedTracePayload} />
        ) : (
          <RequestView payload={share.payload as SharedRequestPayload} />
        )}
        {!share.hidePoweredBy && <FooterCTA />}
      </main>
    </div>
  )
}

/* ── Chrome ───────────────────────────────────────────────────────────── */

function ShareHeader({ share }: ShareViewProps) {
  return (
    <header className="border-b border-border bg-bg-elev">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-6 py-4 lg:px-10">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-3 transition-opacity hover:opacity-80">
            <Image src="/icon.png" alt="" width={22} height={22} className="shrink-0 rounded-chip" />
            <span className="text-[13.5px] font-semibold leading-[1.45] text-text">
              Shared {share.scope}
            </span>
          </Link>
          <span className="inline-flex items-center gap-[7px] rounded-full bg-bg-chip px-2.5 py-1 font-mono text-[11px] leading-[1.45] text-text-faint">
            <span className="h-[7px] w-2 rounded-[1.5px] bg-text-faint" aria-hidden="true" />
            read only
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-[11.5px] leading-[1.45] text-text-faint">
            {share.viewCount} {share.viewCount === 1 ? 'view' : 'views'}
            {share.expiresAt ? ` · expires ${formatDate(share.expiresAt)}` : ' · no expiry'}
          </span>
          {share.permalink ? <CopyPermalink url={share.permalink} /> : null}
          {!share.hidePoweredBy && (
            <Link
              href="/signup"
              className="inline-flex h-9 items-center rounded-full bg-accent px-4 text-[12.5px] font-semibold text-accent-fg transition-colors hover:bg-accent-strong"
            >
              Start free
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}

/* States what the link is and how long it lasts, matching the board's banner. */
function ScopeBanner({ share }: ShareViewProps) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-bg-sunk px-4 py-3">
      <span className="size-[7px] shrink-0 rounded-full bg-text-faint" aria-hidden="true" />
      <p className="text-[12.5px] leading-[1.45] text-text-muted">
        This is a read-only snapshot. Anyone with the link can view it
        {share.expiresAt ? ` until ${formatDate(share.expiresAt)}.` : ', and it does not expire.'}
      </p>
    </div>
  )
}

function FooterCTA() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-card bg-text px-5 py-[18px]">
      <div>
        <p className="font-display text-[15px] leading-[1.45] tracking-[-0.015em] text-bg">
          This trace came out of Spanlens
        </p>
        <p className="text-[12.5px] leading-[1.45] text-bg/70">
          One line of config and your own runs look like this.
        </p>
      </div>
      <Link
        href="/signup"
        className="inline-flex h-9 shrink-0 items-center rounded-full bg-accent px-4 text-[12.5px] font-semibold text-accent-fg transition-colors hover:bg-accent-strong"
      >
        Start free
      </Link>
    </div>
  )
}

/* ── Summary strip ────────────────────────────────────────────────────── */

interface SummaryItem {
  label: string
  value: string
  /** Renders the value in the faint ink the board uses for withheld fields. */
  muted?: boolean
}

/*
 * One card holding the metrics side by side, split by hairlines rather than
 * by gaps. Wraps to a grid on narrow viewports so the dividers never collapse
 * into a single crowded row.
 */
function SummaryStrip({ items }: { items: SummaryItem[] }) {
  return (
    <dl className="grid grid-cols-2 rounded-card border border-border bg-bg-elev px-5 py-4 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((item, i) => (
        <div
          key={item.label}
          className={`flex flex-col gap-[5px] px-6 py-2 ${
            i === 0 ? 'pl-0' : 'border-l border-track'
          }`}
        >
          <dt className="font-mono text-[10px] uppercase leading-[1.45] tracking-[0.1em] text-text-faint">
            {item.label}
          </dt>
          <dd
            className={`truncate font-mono text-[15px] leading-[1.45] ${
              item.muted ? 'text-text-faint' : 'text-text'
            }`}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-bad/40 bg-bad-bg px-4 py-3 font-mono text-[12px] leading-[1.5] text-bad">
      {message}
    </div>
  )
}

/* ── Trace view ───────────────────────────────────────────────────────── */

function TraceView({ payload }: { payload: SharedTracePayload }) {
  const traceStart = new Date(payload.started_at).getTime()
  // The waterfall is drawn against the trace's own duration; fall back to the
  // longest span when the trace has no recorded duration so the bars still
  // carry proportion instead of collapsing to full width.
  const span = payload.duration_ms ?? Math.max(1, ...payload.spans.map((s) => s.duration_ms ?? 0))

  const items: SummaryItem[] = [
    { label: 'Name', value: payload.name ?? 'untitled' },
    { label: 'Duration', value: payload.duration_ms != null ? `${payload.duration_ms} ms` : '—' },
    { label: 'Spans', value: String(payload.span_count ?? payload.spans.length) },
    {
      label: 'Tokens',
      value: payload.total_tokens == null ? 'hidden' : Number(payload.total_tokens).toLocaleString('en-US'),
      ...(payload.total_tokens == null ? { muted: true } : {}),
    },
    {
      label: 'Cost',
      value: payload.total_cost_usd == null ? 'hidden' : `$${Number(payload.total_cost_usd).toFixed(4)}`,
      ...(payload.total_cost_usd == null ? { muted: true } : {}),
    },
    { label: 'Status', value: payload.status },
  ]

  return (
    <>
      <SummaryStrip items={items} />
      {payload.error_message ? <ErrorPanel message={payload.error_message} /> : null}

      <section className="overflow-hidden rounded-card border border-border bg-bg-elev">
        <h2 className="flex items-center gap-3 border-b border-track bg-bg-muted px-[18px] py-2.5 font-mono text-[10px] uppercase leading-[1.45] tracking-[0.1em] text-text-faint">
          <span>Span</span>
          <span className="ml-auto normal-case tracking-normal">
            {payload.spans.length} total · started {formatDateTime(payload.started_at)}
          </span>
        </h2>
        {payload.spans.map((s) => (
          <SpanRow
            key={s.id}
            span={s}
            isCritical={payload.critical_span_ids.includes(s.id)}
            traceStart={traceStart}
            traceDuration={span}
          />
        ))}
      </section>
    </>
  )
}

interface SpanRowProps {
  span: SharedSpan
  isCritical: boolean
  traceStart: number
  traceDuration: number
}

function SpanRow({ span, isCritical, traceStart, traceDuration }: SpanRowProps) {
  const offsetMs = Math.max(0, new Date(span.started_at).getTime() - traceStart)
  const left = traceDuration > 0 ? Math.min(100, (offsetMs / traceDuration) * 100) : 0
  // Floor the width so a sub-millisecond span is still a visible tick.
  const width =
    traceDuration > 0 ? Math.max(1.5, Math.min(100 - left, ((span.duration_ms ?? 0) / traceDuration) * 100)) : 0

  return (
    <details className="group border-b border-track last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center gap-3.5 px-[18px] py-[11px] transition-colors hover:bg-bg-muted">
        <span className="flex min-w-0 flex-[0_0_260px] items-center gap-2">
          {isCritical && (
            <span className="rounded-chip bg-accent-bg px-1.5 py-0.5 font-mono text-[10px] leading-[1.45] text-accent">
              critical
            </span>
          )}
          <span className="truncate font-mono text-[12px] leading-[1.45] text-text">
            {span.name ?? '(unnamed)'}
          </span>
          {span.span_type && (
            <span className="shrink-0 font-mono text-[12px] leading-[1.45] text-text-muted">
              · {span.span_type}
            </span>
          )}
        </span>

        {/* Waterfall track. Decorative: the duration to its right is the
            accessible reading of the same number. */}
        <span className="relative hidden h-2.5 flex-1 rounded-full bg-track md:block" aria-hidden="true">
          <span
            className={`absolute inset-y-0 rounded-full ${span.error_message ? 'bg-bad' : isCritical ? 'bg-accent' : 'bg-text-faint'}`}
            style={{ left: `${left}%`, width: `${width}%` }}
          />
        </span>

        <span className="ml-auto shrink-0 text-right font-mono text-[11.5px] leading-[1.45] text-text-faint md:ml-0 md:w-16">
          {span.duration_ms != null ? `${span.duration_ms} ms` : '—'}
        </span>
      </summary>

      <div className="flex flex-col gap-3 border-t border-track px-[18px] py-3.5">
        {span.error_message && (
          <p className="whitespace-pre-wrap font-mono text-[11.5px] leading-[1.5] text-bad">
            {span.error_message}
          </p>
        )}
        {span.input != null || span.output != null ? (
          <IOPreview input={span.input} output={span.output} />
        ) : (
          <HiddenBody />
        )}
      </div>
    </details>
  )
}

/* Placeholder the board shows when the link was created without bodies. */
function HiddenBody() {
  return (
    <div className="flex flex-col gap-3.5">
      <div>
        <p className="text-[13.5px] font-semibold leading-[1.45] text-text">
          Prompt and response are hidden
        </p>
        <p className="mt-1 max-w-[700px] text-[12.5px] leading-[1.6] text-text-faint">
          The person who created this link chose to share timings and structure only. Ask them for a link
          with bodies included if you need the text.
        </p>
      </div>
      <div className="flex flex-col gap-2 rounded-lg border border-track bg-bg-sunk p-3.5" aria-hidden="true">
        <span className="h-[9px] w-[280px] max-w-full rounded-[4px] bg-border" />
        <span className="h-[9px] w-[420px] max-w-full rounded-[4px] bg-border" />
        <span className="h-[9px] w-[200px] max-w-full rounded-[4px] bg-border" />
      </div>
    </div>
  )
}

/* ── Request view ─────────────────────────────────────────────────────── */

function RequestView({ payload }: { payload: SharedRequestPayload }) {
  const items: SummaryItem[] = [
    { label: 'Provider', value: payload.provider },
    { label: 'Model', value: payload.model },
    { label: 'Latency', value: `${payload.latency_ms} ms` },
    {
      label: 'Tokens',
      value: payload.total_tokens == null ? 'hidden' : Number(payload.total_tokens).toLocaleString('en-US'),
      ...(payload.total_tokens == null ? { muted: true } : {}),
    },
    {
      label: 'Cost',
      value: payload.cost_usd == null ? 'hidden' : `$${payload.cost_usd.toFixed(4)}`,
      ...(payload.cost_usd == null ? { muted: true } : {}),
    },
    { label: 'Status', value: `${payload.status_code}${payload.truncated ? ' · truncated' : ''}` },
  ]

  return (
    <>
      <SummaryStrip items={items} />
      <p className="font-mono text-[11.5px] leading-[1.45] text-text-faint">
        Recorded {formatDateTime(payload.created_at)}
      </p>
      {payload.error_message && <ErrorPanel message={payload.error_message} />}

      <div className="rounded-card border border-border bg-bg-elev p-5">
        {payload.request_body != null || payload.response_body != null ? (
          <IOPreview
            input={payload.request_body}
            output={payload.response_body}
            inputLabel="Request"
            outputLabel="Response"
          />
        ) : (
          <HiddenBody />
        )}
      </div>
    </>
  )
}
