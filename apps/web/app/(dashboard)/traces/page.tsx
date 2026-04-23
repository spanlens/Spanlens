'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useTraces } from '@/lib/queries/use-traces'
import type { TraceStatus } from '@/lib/queries/types'
import { Topbar } from '@/components/layout/topbar'
import { cn } from '@/lib/utils'

function fmtDuration(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function fmtCost(n: number): string {
  if (n <= 0) return '—'
  return n < 0.001 ? `$${n.toFixed(5)}` : `$${n.toFixed(4)}`
}

function fmtAge(dateStr: string): string {
  const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function TraceMini({ idx, hasError }: { idx: number; hasError: boolean }) {
  const segs = [
    { type: 'tool', pct: 8 + (idx % 5) },
    { type: 'llm',  pct: 28 + (idx % 3) * 4 },
    { type: 'tool', pct: 10 },
    { type: 'llm',  pct: 24 },
    { type: 'tool', pct: 10 + (idx % 4) },
    { type: hasError ? 'err' : 'llm', pct: 14 },
  ]
  const total = segs.reduce((a, s) => a + s.pct, 0)
  return (
    <div className="flex h-[10px] rounded-[2px] overflow-hidden border border-border bg-bg-muted w-full">
      {segs.map((s, i) => (
        <div
          key={i}
          style={{ width: `${(s.pct / total) * 100}%` }}
          className={cn(
            'h-full',
            s.type === 'llm' ? 'bg-accent opacity-80' : s.type === 'err' ? 'bg-bad' : 'bg-border-strong',
            i < segs.length - 1 ? 'border-r border-bg' : '',
          )}
        />
      ))}
    </div>
  )
}

type StatusFilter = 'all' | 'ok' | 'error'

const FILTER_COLS = 'px-[22px] py-[11px] font-mono text-[12.5px] items-center border-b border-border'
const GRID = '20px 1.4fr 1.2fr 0.6fr 0.8fr 0.8fr 0.9fr 1.2fr 1.2fr 0.5fr'

export default function TracesPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const apiStatus: TraceStatus | 'all' =
    statusFilter === 'ok' ? 'completed' : statusFilter === 'error' ? 'error' : 'all'

  const { data, isLoading, isFetching } = useTraces({ page, limit: 50, status: apiStatus })
  const traces = data?.data ?? []
  const meta = data?.meta ?? { total: 0, page: 1, limit: 50 }

  const filtered = useMemo(
    () => (search ? traces.filter((t) => t.name.toLowerCase().includes(search.toLowerCase())) : traces),
    [traces, search],
  )

  const withDuration = traces.filter((t) => t.duration_ms != null).map((t) => t.duration_ms!)
  const sorted = [...withDuration].sort((a, b) => a - b)
  const p50 = sorted.length ? sorted[Math.floor(sorted.length * 0.5)] ?? null : null
  const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] ?? null : null
  const avgSpans = traces.length ? traces.reduce((s, t) => s + t.span_count, 0) / traces.length : null
  const errors = traces.filter((t) => t.status === 'error').length

  return (
    <div className="-m-7 flex flex-col h-screen overflow-hidden bg-bg">
      <Topbar
        crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Traces' }]}
        right={
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-[10px] py-[5px] border border-border rounded-[6px] bg-bg-elev w-[320px]">
              <span className="text-text-faint text-[14px] leading-none">⌕</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by trace id, agent, user…"
                className="flex-1 bg-transparent font-mono text-[12px] text-text-muted placeholder:text-text-faint focus:outline-none"
              />
              <span className="font-mono text-[10px] text-text-faint border border-border rounded-[3px] px-[5px] py-[1px]">
                ⌘K
              </span>
            </div>
            <span className="text-[12.5px] text-text-muted flex items-center gap-1.5">
              <span className="w-[7px] h-[7px] rounded-full bg-good shrink-0" /> Live
            </span>
          </div>
        }
      />

      {/* Stat strip */}
      <div className="grid grid-cols-5 border-b border-border shrink-0">
        {[
          { label: 'Traces · 24h',       value: meta.total.toLocaleString(), warn: false },
          { label: 'p50 duration',        value: fmtDuration(p50),            warn: false },
          { label: 'p95 duration',        value: fmtDuration(p95),            warn: p95 != null && p95 > 8000 },
          { label: 'Avg spans / trace',   value: avgSpans != null ? avgSpans.toFixed(1) : '—', warn: false },
          { label: 'Errors',              value: String(errors),              warn: errors > 0 },
        ].map((s, i) => (
          <div key={i} className={cn('px-[18px] py-[14px]', i < 4 && 'border-r border-border')}>
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">{s.label}</div>
            <span className={cn('text-[24px] font-medium leading-none tracking-[-0.6px]', s.warn ? 'text-accent' : 'text-text')}>
              {s.value}
            </span>
          </div>
        ))}
      </div>

      {/* Filter toolbar */}
      <div className="flex items-center gap-[6px] px-[22px] py-[10px] border-b border-border shrink-0 flex-wrap">
        <div className="flex p-0.5 border border-border rounded-[5px] bg-bg-elev font-mono text-[10.5px] tracking-[0.03em]">
          {([['all', 'All'], ['ok', 'OK'], ['error', 'Error']] as [StatusFilter, string][]).map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => { setStatusFilter(v); setPage(1) }}
              className={cn(
                'px-[10px] py-[3px] rounded-[3px] transition-colors',
                statusFilter === v ? 'bg-text text-bg' : 'text-text-muted hover:text-text',
              )}
            >{l}</button>
          ))}
        </div>
        <button
          type="button"
          className="flex items-center gap-1.5 px-[10px] py-[4px] rounded-[5px] border border-border-strong bg-bg-elev font-mono text-[11px] text-text tracking-[0.03em]"
        >
          <span className="text-text-faint">☰</span> views · <span className="text-text-muted">all traces</span> ⌄
        </button>
        {['agent · all ⌄', 'duration ≥ — ⌄', 'cost ≥ — ⌄', 'last 24h ⌄'].map((label) => (
          <span key={label} className="font-mono text-[11px] text-text-muted px-[9px] py-[4px] border border-border rounded-[5px]">
            {label}
          </span>
        ))}
        <span className="font-mono text-[11px] text-text-faint px-[9px] py-[4px]">+ filter</span>
        <span className="flex-1" />
        <span className="font-mono text-[11px] text-text-faint">
          Showing {filtered.length.toLocaleString()} of {meta.total.toLocaleString()}
        </span>
        <span className="font-mono text-[11px] text-text px-[10px] py-[4px] border border-border rounded-[5px] bg-bg-elev cursor-pointer">
          Export ⌄
        </span>
      </div>

      {/* Column header */}
      <div
        className="grid border-b border-border bg-bg-muted shrink-0 font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] px-[22px] py-[9px]"
        style={{ gridTemplateColumns: GRID }}
      >
        <span />
        <span>Agent</span>
        <span>Trace id</span>
        <span>Spans</span>
        <span>Duration</span>
        <span>Cost</span>
        <span>Tokens</span>
        <span>Span timeline</span>
        <span>Tag</span>
        <span className="text-right">Age</span>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-6 space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-10 bg-bg-elev rounded animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
            <p className="text-[13px]">No traces yet.</p>
            <p className="font-mono text-[12px]">Use the Spanlens SDK to start recording agent traces.</p>
          </div>
        ) : (
          filtered.map((t, idx) => {
            const isErr = t.status === 'error'
            const isRunning = t.status === 'running'
            return (
              <Link
                key={t.id}
                href={`/traces/${t.id}`}
                className={cn(
                  'grid items-center px-[22px] py-[11px] border-b border-border font-mono text-[12.5px] hover:bg-bg-elev transition-colors',
                  isErr && 'bg-accent-bg',
                )}
                style={{ gridTemplateColumns: GRID }}
              >
                <span>
                  {isErr ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-bad block" />
                  ) : isRunning ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse block" />
                  ) : null}
                </span>
                <span className="text-text font-sans text-[13px] font-medium truncate pr-4">{t.name}</span>
                <span className="text-text-muted truncate pr-4">{t.id}</span>
                <span className="text-text-muted">{t.span_count}</span>
                <span className={isErr ? 'text-bad' : 'text-text'}>{fmtDuration(t.duration_ms)}</span>
                <span className="text-text">{fmtCost(t.total_cost_usd)}</span>
                <span className="text-text-muted">{t.total_tokens.toLocaleString()}</span>
                <span className="pr-4 flex items-center">
                  <TraceMini idx={idx} hasError={isErr} />
                </span>
                <span className={cn('text-[11px] font-sans', isErr ? 'text-bad' : isRunning ? 'text-accent' : 'text-text-faint')}>
                  {isErr ? 'error' : isRunning ? 'running' : '—'}
                </span>
                <span className="text-text-faint text-right">{fmtAge(t.started_at)}</span>
              </Link>
            )
          })
        )}
      </div>

      {/* Pagination */}
      {!isLoading && traces.length > 0 && (
        <div className="flex items-center justify-between px-[22px] py-3 border-t border-border shrink-0">
          <span className="font-mono text-[11.5px] text-text-muted">
            {filtered.length.toLocaleString()} of {meta.total.toLocaleString()} traces
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isFetching}
              className="font-mono text-[11.5px] px-3 py-[5px] border border-border rounded-[5px] text-text-muted hover:text-text disabled:opacity-40 transition-colors"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={traces.length < (data?.meta.limit ?? 50) || isFetching}
              className="font-mono text-[11.5px] px-3 py-[5px] border border-border rounded-[5px] text-text-muted hover:text-text disabled:opacity-40 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
