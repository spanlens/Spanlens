'use client'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { X, FlaskConical } from 'lucide-react'
import { DEMO_PROMPTS } from '@/lib/demo-data'
import { Topbar } from '@/components/layout/topbar'
import { cn } from '@/lib/utils'

function fmtUsd(v: number): string {
  return v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(5)}`
}

function fmtMs(v: number): string {
  if (v === 0) return '—'
  if (v >= 1000) return `${(v / 1000).toFixed(2)}s`
  return `${Math.round(v)}ms`
}

function QualityBadge({ score }: { score: number | null | undefined }) {
  if (score == null) return <span className="text-text-faint">—</span>
  const color = score >= 90 ? 'text-good' : score >= 70 ? 'text-warn' : 'text-bad'
  return <span className={cn('font-mono tabular-nums', color)}>{score}</span>
}

type FilterType = 'all' | 'ab'
type MinCalls = 0 | 1 | 10 | 100
type DateRange = '24h' | '7d' | '30d'
type ViewMode = 'all' | 'active'

const GRID = '20px 1.5fr 0.55fr 0.55fr 0.8fr 0.8fr 0.8fr 0.7fr 0.5fr 0.5fr'

export default function DemoPromptsPage() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterType>('all')
  const [minCalls, setMinCalls] = useState<MinCalls>(0)
  const [callsMenuOpen, setCallsMenuOpen] = useState(false)
  const [dateRange, setDateRange] = useState<DateRange>('24h')
  const [dateMenuOpen, setDateMenuOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('all')

  const callsMenuRef = useRef<HTMLDivElement>(null)
  const dateMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!callsMenuOpen && !dateMenuOpen) return
    const handler = (e: PointerEvent) => {
      if (callsMenuOpen && !callsMenuRef.current?.contains(e.target as Node))
        setCallsMenuOpen(false)
      if (dateMenuOpen && !dateMenuRef.current?.contains(e.target as Node)) setDateMenuOpen(false)
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [callsMenuOpen, dateMenuOpen])

  const all = DEMO_PROMPTS

  const totalVersions = all.reduce((s, p) => s + (p.versionCount ?? p.version), 0)
  const totalCalls = all.reduce((s, p) => s + (p.stats?.calls ?? 0), 0)
  const totalSpend = all.reduce((s, p) => s + (p.stats?.totalCostUsd ?? 0), 0)
  const abCount = all.filter((p) => p.activeExperiment != null).length

  const filtered = all.filter(
    (p) =>
      (!search || p.name.toLowerCase().includes(search.toLowerCase())) &&
      (filter === 'all' ||
        (p.versionCount ?? p.version) > 1 ||
        p.activeExperiment != null) &&
      (minCalls === 0 || (p.stats?.calls ?? 0) >= minCalls) &&
      (viewMode === 'all' || (p.stats?.calls ?? 0) > 0),
  )

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col h-screen overflow-hidden bg-bg">
      <Topbar
        crumbs={[{ label: 'Demo', href: '/demo/dashboard' }, { label: 'Prompts' }]}
        right={
          <div className="flex items-center gap-2">
            {/* Search — desktop only */}
            <div className="hidden md:flex items-center gap-2 px-[10px] py-[5px] border border-border rounded-[6px] bg-bg-elev w-[280px]">
              <span className="text-text-faint text-[14px] leading-none">⌕</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search prompts…"
                className="flex-1 bg-transparent font-mono text-[12px] text-text-muted placeholder:text-text-faint focus:outline-none"
              />
              <span className="font-mono text-[10px] text-text-faint border border-border rounded-[3px] px-[5px] py-[1px]">
                ⌘K
              </span>
            </div>
            <button
              type="button"
              onClick={() => alert('Sign up to create prompts')}
              className="font-mono text-[11px] text-text px-[10px] py-[5px] border border-border-strong rounded-[5px] bg-bg-elev hover:bg-bg-muted transition-colors whitespace-nowrap shrink-0"
            >
              + New prompt
            </button>
          </div>
        }
      />

      {/* Info banner */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-[22px] py-[10px] bg-bg-muted border-b border-border text-[12px] text-text-muted shrink-0">
        <span className="font-mono text-[10px] text-accent uppercase tracking-[0.04em] px-[7px] py-[2px] rounded-[3px] bg-accent-bg border border-accent-border shrink-0">
          code = source
        </span>
        <span>
          Prompts are defined in code. Versions tracked via{' '}
          <code className="font-mono text-[11px] px-1 rounded border border-border bg-bg text-text">
            X-Spanlens-Prompt-Version
          </code>{' '}
          header.
        </span>
      </div>

      {/* Stat strip */}
      <div className="overflow-x-auto shrink-0 border-b border-border">
        <div className="grid grid-cols-5 min-w-[480px]">
          {[
            { label: 'Total prompts',             value: String(all.length) },
            { label: 'Total versions',            value: String(totalVersions) },
            { label: `Total calls`,               value: totalCalls > 0 ? totalCalls.toLocaleString() : '—' },
            { label: `Total spend`,               value: totalSpend > 0 ? fmtUsd(totalSpend) : '—' },
            { label: `A/B tests`,                 value: String(abCount) },
          ].map((s, i) => (
            <div key={i} className={cn('px-[18px] py-[14px]', i < 4 && 'border-r border-border')}>
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">
                {s.label}
              </div>
              <span className="text-[24px] font-medium leading-none tracking-[-0.6px] text-text">
                {s.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Filter toolbar */}
      <div className="flex flex-col gap-[6px] px-[22px] py-[10px] border-b border-border shrink-0">
        {/* Mobile search */}
        <div className="md:hidden flex items-center gap-2 px-[10px] py-[5px] border border-border rounded-[6px] bg-bg-elev">
          <span className="text-text-faint text-[14px] leading-none">⌕</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search prompts…"
            className="flex-1 bg-transparent font-mono text-[12px] text-text-muted placeholder:text-text-faint focus:outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="text-text-faint hover:text-text transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-[6px] flex-wrap">
          <div className="flex p-0.5 border border-border rounded-[5px] bg-bg-elev font-mono text-[10.5px] tracking-[0.03em]">
            {(
              [
                ['all', 'All', String(all.length)],
                ['ab', 'A/B', String(abCount)],
              ] as [FilterType, string, string][]
            ).map(([v, l, c]) => (
              <button
                key={v}
                type="button"
                onClick={() => setFilter(v)}
                className={cn(
                  'px-[10px] py-[3px] rounded-[3px] flex items-center gap-1.5 transition-colors',
                  filter === v ? 'bg-text text-bg' : 'text-text-muted hover:text-text',
                )}
              >
                {l}
                <span className={cn('text-[10px]', filter === v ? 'opacity-60' : 'text-text-faint')}>
                  {c}
                </span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setViewMode((v) => (v === 'all' ? 'active' : 'all'))}
            className={cn(
              'flex items-center gap-1.5 px-[10px] py-[4px] rounded-[5px] border font-mono text-[11px] tracking-[0.03em] transition-colors',
              viewMode === 'active'
                ? 'border-border-strong bg-text text-bg'
                : 'border-border-strong bg-bg-elev text-text',
            )}
          >
            <span className={viewMode === 'active' ? 'opacity-60' : 'text-text-faint'}>☰</span>
            {' '}views ·{' '}
            <span className={viewMode === 'active' ? 'opacity-80' : 'text-text-muted'}>
              {viewMode === 'active' ? 'active only' : 'all prompts'}
            </span>
          </button>

          <div className="relative" ref={callsMenuRef}>
            <button
              type="button"
              onClick={() => setCallsMenuOpen((v) => !v)}
              className={cn(
                'font-mono text-[11px] px-[9px] py-[4px] border rounded-[5px] transition-colors',
                minCalls > 0
                  ? 'border-border-strong bg-text text-bg'
                  : 'border-border text-text-muted hover:text-text',
              )}
            >
              calls ≥ {minCalls === 0 ? 'all' : minCalls} ⌄
            </button>
            {callsMenuOpen && (
              <div className="absolute left-0 top-full mt-1 z-20 bg-bg-elev border border-border rounded-[6px] shadow-lg overflow-hidden py-1 w-28">
                {([0, 1, 10, 100] as const).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => {
                      setMinCalls(n)
                      setCallsMenuOpen(false)
                    }}
                    className={cn(
                      'w-full text-left px-[10px] py-[5px] font-mono text-[11px] transition-colors',
                      minCalls === n
                        ? 'text-text bg-bg-muted'
                        : 'text-text-muted hover:text-text hover:bg-bg-muted',
                    )}
                  >
                    {n === 0 ? 'All' : `≥ ${n}`}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative" ref={dateMenuRef}>
            <button
              type="button"
              onClick={() => setDateMenuOpen((v) => !v)}
              className={cn(
                'font-mono text-[11px] px-[9px] py-[4px] border rounded-[5px] transition-colors',
                dateRange !== '24h'
                  ? 'border-border-strong bg-text text-bg'
                  : 'border-border text-text-muted hover:text-text',
              )}
            >
              {dateRange} ⌄
            </button>
            {dateMenuOpen && (
              <div className="absolute left-0 top-full mt-1 z-20 bg-bg-elev border border-border rounded-[6px] shadow-lg overflow-hidden py-1 w-20">
                {(['24h', '7d', '30d'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => {
                      setDateRange(r)
                      setDateMenuOpen(false)
                    }}
                    className={cn(
                      'w-full text-left px-[10px] py-[5px] font-mono text-[11px] transition-colors',
                      dateRange === r
                        ? 'text-text bg-bg-muted'
                        : 'text-text-muted hover:text-text hover:bg-bg-muted',
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
            )}
          </div>

          <span className="flex-1" />
          <span className="font-mono text-[11px] text-text-faint">
            {filtered.length === all.length
              ? `${all.length} prompts`
              : `${filtered.length} of ${all.length} prompts`}
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-text-muted">
            <p className="text-[13px]">
              {search ? 'No prompts match your search.' : 'No prompts registered yet.'}
            </p>
          </div>
        ) : (
          <div className="min-w-[700px]">
            {/* Column headers */}
            <div
              className="grid sticky top-0 z-10 font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] px-[22px] py-[9px] bg-bg-muted border-b border-border"
              style={{ gridTemplateColumns: GRID }}
            >
              <span />
              <span>Prompt</span>
              <span>Active</span>
              <span>Versions</span>
              <span>Calls · {dateRange}</span>
              <span>Avg cost</span>
              <span>Avg lat</span>
              <span>Quality · {dateRange}</span>
              <span>A/B</span>
              <span className="text-right">Updated</span>
            </div>
            {filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => router.push(`/demo/prompts/${encodeURIComponent(p.name)}`)}
                className="w-full grid items-center px-[22px] py-[11px] border-b border-border font-mono text-[12.5px] text-left hover:bg-bg-elev transition-colors group"
                style={{ gridTemplateColumns: GRID }}
              >
                {/* Status dot */}
                <span>
                  <span
                    className={cn(
                      'w-1.5 h-1.5 rounded-full block',
                      (p.stats?.calls ?? 0) > 0 ? 'bg-good' : 'bg-border',
                    )}
                  />
                </span>

                {/* Name */}
                <span className="flex items-center gap-2 min-w-0">
                  <span className="text-text font-sans text-[13px] font-medium truncate group-hover:text-accent transition-colors">
                    {p.name}
                  </span>
                </span>

                {/* Active version */}
                <span className="text-text-muted">v{p.version}</span>

                {/* Version count */}
                <span className="text-text-muted">{p.versionCount ?? p.version}</span>

                {/* Calls */}
                <span className={cn(p.stats && p.stats.calls > 0 ? 'text-text' : 'text-text-faint')}>
                  {p.stats?.calls ? p.stats.calls.toLocaleString() : '—'}
                </span>

                {/* Avg cost */}
                <span className={cn(p.stats?.avgCostUsd != null ? 'text-text' : 'text-text-faint')}>
                  {p.stats?.avgCostUsd != null ? fmtUsd(p.stats.avgCostUsd) : '—'}
                </span>

                {/* Avg latency */}
                <span className={cn(p.stats?.avgLatencyMs != null ? 'text-text' : 'text-text-faint')}>
                  {p.stats?.avgLatencyMs != null ? fmtMs(p.stats.avgLatencyMs) : '—'}
                </span>

                {/* Quality score */}
                <QualityBadge score={p.qualityScore} />

                {/* A/B badge */}
                <span>
                  {p.activeExperiment ? (
                    <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.05em] px-[5px] py-[2px] rounded-[3px] bg-accent-bg border border-accent-border text-accent">
                      <FlaskConical className="h-2.5 w-2.5" />
                      A/B
                    </span>
                  ) : (
                    <span className="text-text-faint">—</span>
                  )}
                </span>

                {/* Updated date */}
                <span className="text-text-faint text-right text-[11px]">
                  {new Date(p.created_at).toLocaleDateString()}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
