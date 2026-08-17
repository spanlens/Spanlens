'use client'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { FlaskConical, Plus, Search } from 'lucide-react'
import { DEMO_PROMPTS } from '@/lib/demo-data'
import { Topbar } from '@/components/layout/topbar'
import { DemoExportButton } from '@/components/ui/demo-export-button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { StatusPill } from '@/components/ui/primitives'
import { cn, formatDate } from '@/lib/utils'
import {
  Board,
  TOPBAR_BLEED,
  FilterBar,
  CONTROL,
  CONTROL_TEXT,
  Segment,
  SegmentItem,
  StatCard,
  TableCard,
  TableHead,
  Th,
  ROW,
} from '../../(dashboard)/_board/surfaces'

// D4's accent lozenge: borderless, full radius, accent tint. `StatusPill`
// covers the status colours only, so the accent case carries its own classes.
const ACCENT_CHIP =
  'inline-flex items-center whitespace-nowrap rounded-full bg-accent-bg px-2 py-[3px] text-[11px] font-semibold leading-[15px] text-accent'

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
  return <span className={cn('tabular-nums', color)}>{score}</span>
}

type FilterType = 'all' | 'ab'
type MinCalls = 0 | 1 | 10 | 100
type DateRange = '24h' | '7d' | '30d'
type ViewMode = 'all' | 'active'

// Same column ledger as the live board so the demo reads at product density.
const LIST_GRID: React.CSSProperties = {
  gridTemplateColumns: '14px minmax(180px,1fr) 70px 80px 110px 110px 100px 100px 78px 96px',
}

const USAGE_GRID: React.CSSProperties = {
  gridTemplateColumns: 'minmax(200px,1.6fr) 110px 130px 130px',
}

export default function DemoPromptsPage() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterType>('all')
  const [minCalls, setMinCalls] = useState<MinCalls>(0)
  const [callsMenuOpen, setCallsMenuOpen] = useState(false)
  const [dateRange, setDateRange] = useState<DateRange>('24h')
  const [dateMenuOpen, setDateMenuOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('all')
  const [tab, setTab] = useState<'versions' | 'usage'>('versions')

  const callsMenuRef = useRef<HTMLDivElement>(null)
  const dateMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!callsMenuOpen && !dateMenuOpen) return
    const handler = (e: PointerEvent) => {
      if (callsMenuOpen && !callsMenuRef.current?.contains(e.target as Node))
        setCallsMenuOpen(false)
      if (dateMenuOpen && !dateMenuRef.current?.contains(e.target as Node)) setDateMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setCallsMenuOpen(false); setDateMenuOpen(false) }
    }
    document.addEventListener('pointerdown', handler)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', handler)
      document.removeEventListener('keydown', onKey)
    }
  }, [callsMenuOpen, dateMenuOpen])

  const all = DEMO_PROMPTS

  const totalVersions = all.reduce((s, p) => s + (p.versionCount ?? p.version), 0)
  const totalCalls = all.reduce((s, p) => s + (p.stats?.calls ?? 0), 0)
  const totalSpend = all.reduce((s, p) => s + (p.stats?.totalCostUsd ?? 0), 0)
  const abCount = all.filter((p) => p.activeExperiment != null).length
  const avgQuality = (() => {
    const scores = all.map((p) => p.qualityScore).filter((s): s is number => s != null)
    return scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null
  })()

  const filtered = all.filter(
    (p) =>
      (!search || p.name.toLowerCase().includes(search.toLowerCase())) &&
      (filter === 'all' ||
        (p.versionCount ?? p.version) > 1 ||
        p.activeExperiment != null) &&
      (minCalls === 0 || (p.stats?.calls ?? 0) >= minCalls) &&
      (viewMode === 'all' || (p.stats?.calls ?? 0) > 0),
  )

  const withCalls = all.filter((p) => (p.stats?.calls ?? 0) > 0)

  return (
    <div>
      <div className={TOPBAR_BLEED}>
        <Topbar
          crumbs={[{ label: 'Demo', href: '/demo/dashboard' }, { label: 'Prompts' }]}
          right={
            <div className="flex items-center gap-3">
              <DemoExportButton
                base="prompts"
                rows={filtered}
                columns={[
                  { header: 'Name', value: (p) => p.name },
                  { header: 'Version', value: (p) => p.versionCount ?? p.version },
                  { header: 'Calls', value: (p) => p.stats?.calls ?? 0 },
                  { header: 'Cost USD', value: (p) => (p.stats?.totalCostUsd ?? 0).toFixed(4) },
                  { header: 'A/B', value: (p) => (p.activeExperiment != null ? 'yes' : 'no') },
                ]}
              />
              <button
                type="button"
                onClick={() => alert('Sign up to create prompts')}
                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-accent px-3.5 py-2 text-[12.5px] font-semibold leading-[18px] text-accent-fg transition-colors hover:bg-accent-strong"
              >
                <Plus className="h-3.5 w-3.5" />
                New prompt
              </button>
            </div>
          }
        />
        <h1 className="sr-only">Prompts</h1>
      </div>

      <Board>
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as 'versions' | 'usage')}
          className="flex flex-col gap-4"
        >
          <TabsList>
            <TabsTrigger value="versions">Versions</TabsTrigger>
            <TabsTrigger value="usage">Usage</TabsTrigger>
          </TabsList>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard
              label="Prompts"
              value={all.length}
              foot={abCount > 0 ? `${abCount} running an A/B test` : 'no A/B tests running'}
            />
            <StatCard label="Versions" value={totalVersions} foot="across all prompts" />
            <StatCard
              label={`Calls · ${dateRange}`}
              value={totalCalls > 0 ? totalCalls.toLocaleString('en-US') : '—'}
              foot="tagged production calls"
            />
            <StatCard
              label="Avg quality"
              value={avgQuality != null ? avgQuality : '—'}
              foot="mean eval score"
            />
            <StatCard
              label={`Spend · ${dateRange}`}
              value={totalSpend > 0 ? fmtUsd(totalSpend) : '—'}
              foot="billed to your provider key"
            />
          </div>

          <TabsContent value="usage" className="mt-0">
            <TableCard>
              <div className="overflow-x-auto">
                <div className="min-w-[600px]">
                  <TableHead>
                    <div className="grid items-center gap-3" style={USAGE_GRID}>
                      <Th>Prompt · version</Th>
                      <Th>Calls · {dateRange}</Th>
                      <Th>Spend · {dateRange}</Th>
                      <Th className="block text-right">Cost / call</Th>
                    </div>
                  </TableHead>
                  {withCalls.map((p) => {
                    const calls = p.stats?.calls ?? 0
                    const spend = p.stats?.totalCostUsd ?? 0
                    return (
                      <div
                        key={p.id}
                        className={cn(ROW, 'grid items-center gap-3')}
                        style={USAGE_GRID}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-mono text-[12px] text-text">{p.name}</span>
                          <span className="block font-mono text-[10.5px] text-text-faint">v{p.version}</span>
                        </span>
                        <span className="font-mono text-[12px] tabular-nums text-text-muted">
                          {calls.toLocaleString('en-US')}
                        </span>
                        <span className="font-mono text-[12px] tabular-nums text-text-muted">
                          {fmtUsd(spend)}
                        </span>
                        <span className="text-right font-mono text-[12px] tabular-nums text-text-muted">
                          {calls > 0 ? fmtUsd(spend / calls) : '—'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </TableCard>
          </TabsContent>

          <TabsContent value="versions" className="mt-0 flex flex-col gap-4">
            <FilterBar>
              <div className={cn(CONTROL, 'flex min-w-[220px] flex-1 items-center gap-2 px-3')}>
                <Search className="h-[13px] w-[13px] shrink-0 text-text-faint" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setSearch('') }}
                  placeholder="Search prompts"
                  aria-label="Search prompts"
                  className="w-full bg-transparent text-[12.5px] leading-[18px] text-text placeholder:text-text-faint focus:outline-none"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="shrink-0 font-mono text-[11px] text-text-faint transition-colors hover:text-text"
                  >
                    Clear
                  </button>
                )}
              </div>

              <Segment>
                {([['all', 'All', all.length], ['ab', 'A/B', abCount]] as [FilterType, string, number][]).map(
                  ([v, l, c]) => (
                    <SegmentItem key={v} active={filter === v} onClick={() => setFilter(v)}>
                      {l}
                      <span
                        className={cn(
                          'ml-1.5 font-mono text-[10.5px]',
                          filter === v ? 'text-text-muted' : 'text-text-faint',
                        )}
                      >
                        {c}
                      </span>
                    </SegmentItem>
                  ),
                )}
              </Segment>

              <Segment>
                {([['all', 'All prompts'], ['active', 'Active only']] as [ViewMode, string][]).map(
                  ([v, l]) => (
                    <SegmentItem key={v} active={viewMode === v} onClick={() => setViewMode(v)}>
                      {l}
                    </SegmentItem>
                  ),
                )}
              </Segment>

              <div className="relative" ref={callsMenuRef}>
                <button
                  type="button"
                  onClick={() => setCallsMenuOpen((v) => !v)}
                  aria-expanded={callsMenuOpen}
                  className={cn(CONTROL, CONTROL_TEXT, 'px-3', minCalls > 0 && 'border-border-strong')}
                >
                  calls ≥ {minCalls === 0 ? 'all' : minCalls}
                  <span className="ml-1.5 text-text-faint">⌄</span>
                </button>
                {callsMenuOpen && (
                  <div className="absolute left-0 top-full z-20 mt-1 w-28 overflow-hidden rounded-md border border-border bg-bg-elev py-1 shadow-card">
                    {([0, 1, 10, 100] as const).map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => { setMinCalls(n); setCallsMenuOpen(false) }}
                        className={cn(
                          'w-full px-3 py-1.5 text-left font-mono text-[11.5px] transition-colors',
                          minCalls === n ? 'bg-bg-muted text-text' : 'text-text-muted hover:bg-bg-muted hover:text-text',
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
                  aria-expanded={dateMenuOpen}
                  className={cn(CONTROL, CONTROL_TEXT, 'px-3', dateRange !== '24h' && 'border-border-strong')}
                >
                  {dateRange}
                  <span className="ml-1.5 text-text-faint">⌄</span>
                </button>
                {dateMenuOpen && (
                  <div className="absolute left-0 top-full z-20 mt-1 w-24 overflow-hidden rounded-md border border-border bg-bg-elev py-1 shadow-card">
                    {(['24h', '7d', '30d'] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => { setDateRange(r); setDateMenuOpen(false) }}
                        className={cn(
                          'w-full px-3 py-1.5 text-left font-mono text-[11.5px] transition-colors',
                          dateRange === r ? 'bg-bg-muted text-text' : 'text-text-muted hover:bg-bg-muted hover:text-text',
                        )}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <span className="ml-auto font-mono text-[11px] text-text-faint">
                {filtered.length === all.length
                  ? `${all.length} prompts`
                  : `${filtered.length} of ${all.length}`}
              </span>
            </FilterBar>

            <div className="card-surface rounded-card flex flex-wrap items-center gap-2 px-5 py-3.5 font-mono text-[11px] text-text-muted">
              <span className={ACCENT_CHIP}>code = source</span>
              <span>
                Prompts are defined in code. Versions are tracked with the{' '}
                <code className="rounded border border-border bg-bg-sunk px-1 font-mono text-[11px] text-text">
                  X-Spanlens-Prompt-Version
                </code>{' '}
                header.
              </span>
            </div>

            {filtered.length === 0 ? (
              <div className="card-surface rounded-card flex flex-col items-center justify-center gap-3 px-5 py-20 text-text-muted">
                <p className="text-[12.5px]">
                  {search ? 'No prompts match your search.' : 'No prompts registered yet.'}
                </p>
              </div>
            ) : (
              <TableCard>
                <div className="overflow-x-auto">
                  <div className="min-w-[1040px]">
                    <TableHead>
                      <div className="grid items-center gap-3" style={LIST_GRID}>
                        {/* The label hides inside the cell, not on it: `sr-only`
                            is absolutely positioned and would drop the status
                            column out of the grid. */}
                        <Th><span className="sr-only">Status</span></Th>
                        <Th>Prompt</Th>
                        <Th>Active</Th>
                        <Th>Versions</Th>
                        <Th>Calls · {dateRange}</Th>
                        <Th>Avg cost</Th>
                        <Th>Avg lat</Th>
                        <Th>Quality</Th>
                        <Th>A/B</Th>
                        <Th className="block text-right">Updated</Th>
                      </div>
                    </TableHead>
                    {filtered.map((p) => (
                      <div
                        key={p.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => router.push(`/demo/prompts/${encodeURIComponent(p.name)}`)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            router.push(`/demo/prompts/${encodeURIComponent(p.name)}`)
                          }
                        }}
                        className={cn(
                          ROW,
                          'group grid cursor-pointer items-center gap-3 text-left font-mono text-[12px] transition-colors hover:bg-bg-muted focus:bg-bg-muted focus:outline-none',
                        )}
                        style={LIST_GRID}
                      >
                        <span>
                          <span
                            className={cn(
                              'block h-1.5 w-1.5 rounded-full',
                              (p.stats?.calls ?? 0) > 0 ? 'bg-good' : 'bg-border-strong',
                            )}
                          />
                        </span>

                        <span className="truncate text-text transition-colors group-hover:text-accent">
                          {p.name}
                        </span>

                        <span className="text-text-muted">v{p.version}</span>
                        <span className="text-text-muted">{p.versionCount ?? p.version}</span>

                        <span className={cn('tabular-nums', p.stats && p.stats.calls > 0 ? 'text-text-muted' : 'text-text-faint')}>
                          {p.stats?.calls ? p.stats.calls.toLocaleString('en-US') : '—'}
                        </span>

                        <span className={cn('tabular-nums', p.stats?.avgCostUsd != null ? 'text-text-muted' : 'text-text-faint')}>
                          {p.stats?.avgCostUsd != null ? fmtUsd(p.stats.avgCostUsd) : '—'}
                        </span>

                        <span className={cn('tabular-nums', p.stats?.avgLatencyMs != null ? 'text-text-muted' : 'text-text-faint')}>
                          {p.stats?.avgLatencyMs != null ? fmtMs(p.stats.avgLatencyMs) : '—'}
                        </span>

                        <span>
                          <QualityBadge score={p.qualityScore} />
                        </span>

                        <span>
                          {p.activeExperiment ? (
                            <StatusPill variant="warn" className="animate-pulse">
                              <FlaskConical className="h-2.5 w-2.5" />
                              A/B
                            </StatusPill>
                          ) : (
                            <span className="text-text-faint">—</span>
                          )}
                        </span>

                        <span className="text-right text-text-faint">{formatDate(p.created_at)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </TableCard>
            )}
          </TabsContent>
        </Tabs>
      </Board>
    </div>
  )
}
