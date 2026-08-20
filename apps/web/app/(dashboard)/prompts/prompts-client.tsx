'use client'
import { useState, useRef, useEffect, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { FlaskConical, Plus, Search } from 'lucide-react'
import {
  usePrompts,
  useCreatePromptVersion,
} from '@/lib/queries/use-prompts'
import { Topbar, LiveDot } from '@/components/layout/topbar'
import { PermissionGate } from '@/components/permission-gate'
import { Card } from '@/components/ui/card'
import { StatusPill } from '@/components/ui/primitives'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
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
} from '../_board/surfaces'

// D4 draws its accent lozenges (variable names, source badges) as a borderless
// full-radius chip on the accent tint. `StatusPill` covers the status colours
// only, so the accent case carries its own class list.
const ACCENT_CHIP =
  'inline-flex items-center whitespace-nowrap rounded-full bg-accent-bg px-2 py-[3px] text-[11px] font-semibold leading-[15px] text-accent'

// Hydration-safe mounted gate, same pattern as the other overhauled pages.
const subscribeNoop = () => () => {}
const getTrue = () => true
const getFalse = () => false
function useMounted(): boolean {
  return useSyncExternalStore(subscribeNoop, getTrue, getFalse)
}

function fmtUsd(v: number): string {
  return v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(5)}`
}

function fmtMs(v: number): string {
  if (v === 0) return '—'
  if (v >= 1000) return `${(v / 1000).toFixed(2)}s`
  return `${Math.round(v)}ms`
}

function QualityBadge({ score }: { score: number | null | undefined }) {
  // Was rendering a stray comma (`<span>,</span>`) when null — that looked
  // like punctuation noise next to real numbers. Use an em-dash like every
  // other "no data" cell on the page.
  if (score == null) return <span className="text-text-faint">—</span>
  const color = score >= 90 ? 'text-good' : score >= 70 ? 'text-warn' : 'text-bad'
  return <span className={cn('tabular-nums', color)}>{score}</span>
}

type FilterType = 'all' | 'ab'
type MinCalls = 0 | 1 | 10 | 100
type DateRange = '24h' | '7d' | '30d'
type ViewMode = 'all' | 'active'

const DATE_RANGE_HOURS: Record<DateRange, number> = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30 }

// D4 draws board tables as fixed-width columns inside a card that scrolls
// sideways on its own, rather than dropping columns at narrow widths. Ten
// columns at these widths need ~1040px, so the card scrolls, not the page.
const LIST_GRID: React.CSSProperties = {
  gridTemplateColumns: '14px minmax(180px,1fr) 70px 80px 110px 110px 100px 100px 78px 96px',
}

const USAGE_GRID: React.CSSProperties = {
  gridTemplateColumns: 'minmax(200px,1.6fr) 110px 130px 130px',
}

// ── Usage tab: rolls up production calls per prompt version ──────────────────

interface PromptRowLike {
  name: string
  version: number
  stats?: { calls?: number; totalCostUsd?: number } | null
}

function PromptsUsageView({ prompts, hours }: { prompts: PromptRowLike[]; hours: number }) {
  const promptsWithCalls = prompts.filter((p) => (p.stats?.calls ?? 0) > 0)
  const rangeLabel = hours <= 24 ? '24h' : hours <= 24 * 7 ? '7d' : '30d'

  if (promptsWithCalls.length === 0) {
    return (
      <TableCard>
        <div className="flex flex-col items-center gap-4 px-6 py-14 text-text-muted">
          <FlaskConical className="h-9 w-9 text-text-faint" />
          <p className="text-[13.5px] font-semibold leading-[1.45] text-text">
            No tagged production calls yet
          </p>
          <p className="max-w-[520px] text-center font-mono text-[11.5px] leading-[1.65] text-text-faint">
            To see per-version usage, tag each proxy call with the{' '}
            <code className="rounded border border-border bg-bg-sunk px-1 font-mono text-[11px] text-text">
              X-Spanlens-Prompt-Version
            </code>{' '}
            header (or use{' '}
            <code className="rounded border border-border bg-bg-sunk px-1 font-mono text-[11px] text-text">
              withPromptVersion()
            </code>{' '}
            in the SDK). Once tagged, calls show up here grouped by version.
          </p>
          <Link
            href="/docs/features/prompts"
            className="rounded-full border border-border px-3 py-1.5 font-mono text-[11px] text-text-muted transition-colors hover:border-border-strong hover:text-text"
          >
            Setup guide →
          </Link>
        </div>
      </TableCard>
    )
  }

  function fmtUsdLocal(n: number): string {
    if (n >= 100) return '$' + n.toFixed(0)
    return '$' + n.toFixed(4)
  }

  return (
    <TableCard>
      <div className="overflow-x-auto">
        <div className="min-w-[600px]">
          <TableHead>
            <div className="grid items-center gap-3" style={USAGE_GRID}>
              <Th>Prompt · version</Th>
              <Th>Calls · {rangeLabel}</Th>
              <Th>Spend · {rangeLabel}</Th>
              <Th className="block text-right">Cost / call</Th>
            </div>
          </TableHead>
          {promptsWithCalls.map((p) => {
            const calls = p.stats?.calls ?? 0
            const spend = p.stats?.totalCostUsd ?? 0
            const costPerCall = calls > 0 ? spend / calls : 0
            return (
              <div
                key={`${p.name}-${p.version}`}
                className={cn(ROW, 'grid items-center gap-3')}
                style={USAGE_GRID}
              >
                <span className="min-w-0">
                  <span className="block truncate font-mono text-[12px] text-text">{p.name}</span>
                  <span className="block font-mono text-[10.5px] text-text-faint">v{p.version}</span>
                </span>
                <span className="font-mono text-[12px] tabular-nums text-text-muted">
                  {calls.toLocaleString()}
                </span>
                <span className="font-mono text-[12px] tabular-nums text-text-muted">
                  {fmtUsdLocal(spend)}
                </span>
                <span className="text-right font-mono text-[12px] tabular-nums text-text-muted">
                  {fmtUsdLocal(costPerCall)}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </TableCard>
  )
}

export function PromptsClient() {
  const router = useRouter()
  const sp = useSearchParams()
  const mounted = useMounted()

  // URL-backed filter state — shareable, survives reload.
  const search    = sp.get('q') ?? ''
  const filter    = (sp.get('filter') ?? 'all') as FilterType
  const minCalls  = (parseInt(sp.get('minCalls') ?? '0', 10) || 0) as MinCalls
  const dateRange = (sp.get('range') ?? '24h') as DateRange
  const viewMode  = (sp.get('view') ?? 'all') as ViewMode
  const tabParam  = sp.get('tab')
  const tab: 'versions' | 'usage' = tabParam === 'usage' ? 'usage' : 'versions'

  function updateQuery(updates: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString())
    Object.entries(updates).forEach(([k, v]) => {
      if (v == null || v === '') next.delete(k)
      else next.set(k, v)
    })
    router.replace(`/prompts?${next.toString()}`)
  }

  // Local search input — debounced to URL after 300ms so each keystroke
  // doesn't push a history entry.
  const [searchInput, setSearchInput] = useState(search)
  useEffect(() => {
    const id = setTimeout(() => {
      if (searchInput !== search) updateQuery({ q: searchInput.trim() || null })
    }, 300)
    return () => clearTimeout(id)
    // searchInput intentionally only — URL change re-mounts the input via key=
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  const [callsMenuOpen, setCallsMenuOpen] = useState(false)
  const [dateMenuOpen, setDateMenuOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ name: '', content: '' })
  const [formError, setFormError] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)

  const callsMenuRef = useRef<HTMLDivElement>(null)
  const dateMenuRef = useRef<HTMLDivElement>(null)
  const exportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!callsMenuOpen && !dateMenuOpen && !exportOpen) return
    const handler = (e: PointerEvent) => {
      if (callsMenuOpen && !callsMenuRef.current?.contains(e.target as Node)) setCallsMenuOpen(false)
      if (dateMenuOpen && !dateMenuRef.current?.contains(e.target as Node)) setDateMenuOpen(false)
      if (exportOpen && !exportRef.current?.contains(e.target as Node)) setExportOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCallsMenuOpen(false); setDateMenuOpen(false); setExportOpen(false)
      }
    }
    document.addEventListener('pointerdown', handler)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', handler)
      document.removeEventListener('keydown', onKey)
    }
  }, [callsMenuOpen, dateMenuOpen, exportOpen])

  const hours = DATE_RANGE_HOURS[dateRange]
  const { data: prompts, isLoading, isError, isFetching, refetch } = usePrompts(undefined, hours)
  const createMutation = useCreatePromptVersion()

  const all = prompts ?? []
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
      (filter === 'all' || (p.versionCount ?? p.version) > 1 || p.activeExperiment != null) &&
      (minCalls === 0 || (p.stats?.calls ?? 0) >= minCalls) &&
      (viewMode === 'all' || (p.stats?.calls ?? 0) > 0),
  )

  async function handleCreate() {
    setFormError(null)
    if (!form.name.trim() || !form.content.trim()) {
      setFormError('Name and content are required.')
      return
    }
    try {
      await createMutation.mutateAsync({ name: form.name.trim(), content: form.content })
      setForm({ name: '', content: '' })
      setFormOpen(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create')
    }
  }

  // CSV / JSON export — RFC 4180 escaping, same pattern as savings/users.
  function csvField(v: string | number): string {
    const s = String(v)
    return /["\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  function csvRow(cells: (string | number)[]): string {
    return cells.map(csvField).join(',')
  }
  function downloadFile(content: string, mime: string, ext: string) {
    const blob = new Blob([content], { type: `${mime};charset=utf-8;` })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `spanlens-prompts-${dateRange}-${new Date().toISOString().slice(0, 10)}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }
  function exportCsv() {
    const lines: string[] = []
    lines.push(csvRow([`Prompts (${dateRange})`]))
    lines.push(csvRow(['Name', 'Active Version', 'Versions', `Calls ${dateRange}`, 'Avg Cost USD', 'Avg Latency ms', `Quality ${dateRange}`, 'A/B Running', 'Updated']))
    for (const p of filtered) {
      lines.push(csvRow([
        p.name,
        `v${p.version}`,
        p.versionCount ?? p.version,
        p.stats?.calls ?? 0,
        p.stats?.avgCostUsd != null ? p.stats.avgCostUsd.toFixed(5) : '',
        p.stats?.avgLatencyMs != null ? Math.round(p.stats.avgLatencyMs) : '',
        p.qualityScore ?? '',
        p.activeExperiment ? 'yes' : 'no',
        p.created_at,
      ]))
    }
    downloadFile(lines.join('\n'), 'text/csv', 'csv')
  }
  function exportJson() {
    downloadFile(JSON.stringify({ range: dateRange, prompts: filtered }, null, 2), 'application/json', 'json')
  }

  return (
    <div>
      {/* The topbar is the one full-bleed row: it cancels the shell inset so
          its hairline spans the whole main column. Everything below sits
          flush inside that inset. */}
      <div className={TOPBAR_BLEED}>
        <Topbar
          crumbs={[{ label: 'Prompts' }]}
          right={
            <div className="flex items-center gap-3">
              <LiveDot refetching={isFetching} />
              <button
                type="button"
                onClick={() => void refetch()}
                disabled={isFetching}
                title="Refresh now"
                className="rounded border border-border px-2 py-1 font-mono text-[11px] text-text-muted transition-colors hover:text-text disabled:opacity-40"
              >
                <span className={cn('inline-block', isFetching && 'animate-spin')}>↻</span>
              </button>
              <PermissionGate need="edit">
                <button
                  type="button"
                  onClick={() => setFormOpen((v) => !v)}
                  aria-expanded={formOpen}
                  className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-accent px-3.5 py-2 text-[12.5px] font-semibold leading-[18px] text-accent-fg transition-colors hover:bg-accent-strong"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New prompt
                </button>
              </PermissionGate>
            </div>
          }
        />
        <h1 className="sr-only">Prompts</h1>
      </div>

      <Board>
        {/* Radix drives the tab row so the triggers carry real tab semantics
            (`aria-selected` plus arrow-key roving). The value still lives in
            the URL, so deep links and reloads keep landing on the right pane. */}
        <Tabs
          value={tab}
          onValueChange={(v) => updateQuery({ tab: v === 'versions' ? null : v })}
          className="flex flex-col gap-4"
        >
          <TabsList>
            <TabsTrigger value="versions">Versions</TabsTrigger>
            <TabsTrigger value="usage">Usage</TabsTrigger>
          </TabsList>

          {/* Stat strip — reads the same on both tabs, so it sits between the
              tab row and the panels instead of being duplicated inside each. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard
              label="Prompts"
              value={mounted ? all.length : ' '}
              foot={abCount > 0 ? `${abCount} running an A/B test` : 'no A/B tests running'}
            />
            <StatCard label="Versions" value={mounted ? totalVersions : ' '} foot="across all prompts" />
            <StatCard
              label={`Calls · ${dateRange}`}
              value={mounted ? (totalCalls > 0 ? totalCalls.toLocaleString() : '—') : ' '}
              foot="tagged production calls"
            />
            <StatCard
              label="Avg quality"
              value={mounted ? (avgQuality != null ? avgQuality : '—') : ' '}
              foot="mean eval score"
            />
            <StatCard
              label={`Spend · ${dateRange}`}
              value={mounted ? (totalSpend > 0 ? fmtUsd(totalSpend) : '—') : ' '}
              foot="billed to your provider key"
            />
          </div>

          <TabsContent value="usage" className="mt-0">
            <PromptsUsageView prompts={all} hours={hours} />
          </TabsContent>

          <TabsContent value="versions" className="mt-0 flex flex-col gap-4">
            {/* Filter bar — search runs the width of the row, with the filters
                and the result count parked at the end. */}
            <FilterBar>
              <div className={cn(CONTROL, 'flex min-w-[220px] flex-1 items-center gap-2 px-3')}>
                <Search className="h-[13px] w-[13px] shrink-0 text-text-faint" />
                <input
                  key={search}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setSearchInput('')
                      updateQuery({ q: null })
                    }
                  }}
                  placeholder="Search prompts"
                  aria-label="Search prompts"
                  className="w-full bg-transparent text-[12.5px] leading-[18px] text-text placeholder:text-text-faint focus:outline-none"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => { setSearchInput(''); updateQuery({ q: null }) }}
                    className="shrink-0 font-mono text-[11px] text-text-faint transition-colors hover:text-text"
                  >
                    Clear
                  </button>
                )}
              </div>

              <Segment>
                {([['all', 'All', all.length], ['ab', 'A/B', abCount]] as [FilterType, string, number][]).map(
                  ([v, l, c]) => (
                    <SegmentItem
                      key={v}
                      active={filter === v}
                      onClick={() => updateQuery({ filter: v === 'all' ? null : v })}
                    >
                      {l}
                      <span
                        className={cn(
                          'ml-1.5 font-mono text-[10.5px]',
                          filter === v ? 'text-text-muted' : 'text-text-faint',
                        )}
                      >
                        {mounted ? c : ' '}
                      </span>
                    </SegmentItem>
                  ),
                )}
              </Segment>

              <Segment>
                {([['all', 'All prompts'], ['active', 'Active only']] as [ViewMode, string][]).map(
                  ([v, l]) => (
                    <SegmentItem
                      key={v}
                      active={viewMode === v}
                      onClick={() => updateQuery({ view: v === 'all' ? null : v })}
                    >
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
                        onClick={() => { updateQuery({ minCalls: n === 0 ? null : String(n) }); setCallsMenuOpen(false) }}
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
                        onClick={() => { updateQuery({ range: r === '24h' ? null : r }); setDateMenuOpen(false) }}
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

              <div className="relative ml-auto" ref={exportRef}>
                <button
                  type="button"
                  onClick={() => setExportOpen((v) => !v)}
                  disabled={filtered.length === 0}
                  aria-expanded={exportOpen}
                  className={cn(CONTROL, CONTROL_TEXT, 'px-3 disabled:opacity-40')}
                >
                  Export
                  <span className="ml-1.5 text-text-faint">⌄</span>
                </button>
                {exportOpen && (
                  <div className="absolute right-0 top-full z-20 mt-1 min-w-[110px] overflow-hidden rounded-md border border-border bg-bg-elev py-1 shadow-card">
                    <button
                      type="button"
                      onClick={() => { setExportOpen(false); exportCsv() }}
                      className="block w-full px-3 py-1.5 text-left font-mono text-[11px] uppercase tracking-[0.1em] text-text-muted transition-colors hover:bg-bg-muted hover:text-text"
                    >CSV</button>
                    <button
                      type="button"
                      onClick={() => { setExportOpen(false); exportJson() }}
                      className="block w-full px-3 py-1.5 text-left font-mono text-[11px] uppercase tracking-[0.1em] text-text-muted transition-colors hover:bg-bg-muted hover:text-text"
                    >JSON</button>
                  </div>
                )}
              </div>

              <span className="font-mono text-[11px] text-text-faint">
                {mounted ? (filtered.length === all.length ? `${all.length} prompts` : `${filtered.length} of ${all.length}`) : ' '}
              </span>
            </FilterBar>

            {/* Explainer with docs link */}
            <div className="card-surface rounded-card flex flex-wrap items-center gap-2 px-5 py-3.5 font-mono text-[11px] text-text-muted">
              <span className={ACCENT_CHIP}>code = source</span>
              <span>
                Prompts are defined in code. Versions are tracked with the{' '}
                <code className="rounded border border-border bg-bg-sunk px-1 font-mono text-[11px] text-text">
                  X-Spanlens-Prompt-Version
                </code>{' '}
                header.
              </span>
              <Link
                href="/docs/features/prompts"
                className="ml-auto text-text transition-opacity hover:opacity-80"
              >
                View setup guide →
              </Link>
            </div>

            {/* Create form panel */}
            {formOpen && (
              <Card className="flex flex-col gap-3.5 px-5 py-[18px]">
                <div className="flex items-center justify-between">
                  <span className="text-[13.5px] font-semibold leading-[1.4] text-text">
                    Register prompt or version
                  </span>
                  <button
                    type="button"
                    onClick={() => setFormOpen(false)}
                    className="font-mono text-[11px] text-text-faint transition-colors hover:text-text"
                  >
                    Close
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label className="micro-label tracking-[0.1em]" htmlFor="prompt-name">Name</label>
                    <input
                      id="prompt-name"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="chatbot-system"
                      className={cn(CONTROL, 'w-full px-3 font-mono text-[12.5px] text-text placeholder:text-text-faint focus:border-border-strong focus:outline-none')}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="micro-label tracking-[0.1em]" htmlFor="prompt-content">Content preview</label>
                    <input
                      id="prompt-content"
                      value={form.content}
                      onChange={(e) => setForm({ ...form, content: e.target.value })}
                      placeholder="You are a helpful assistant…"
                      className={cn(CONTROL, 'w-full px-3 font-mono text-[12.5px] text-text placeholder:text-text-faint focus:border-border-strong focus:outline-none')}
                    />
                  </div>
                </div>
                {formError && <p className="font-mono text-[11.5px] text-bad">{formError}</p>}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-mono text-[11px] text-text-faint">
                    An existing name adds a version. A new name starts at v1.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setFormOpen(false)}
                      className="rounded-full border border-border px-3 py-1.5 text-[11.5px] font-medium text-text-muted transition-colors hover:text-text"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCreate()}
                      disabled={createMutation.isPending}
                      className="rounded-full bg-accent px-3.5 py-1.5 text-[11.5px] font-semibold text-accent-fg transition-colors hover:bg-accent-strong disabled:opacity-40"
                    >
                      {createMutation.isPending ? 'Saving…' : 'Save version'}
                    </button>
                  </div>
                </div>
              </Card>
            )}

            {/* Table: header + rows */}
            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-card bg-bg-chip" />)}
              </div>
            ) : isError ? (
              // Don't fall through to the "register first prompt" empty state on a
              // load failure — a workspace with existing prompts would look brand-new.
              <div className="card-surface rounded-card flex flex-col items-center gap-3 px-5 py-20 text-center text-text-muted">
                <p className="text-[13px] text-bad">Couldn&apos;t load prompts.</p>
                <button
                  type="button"
                  onClick={() => void refetch()}
                  className="rounded-full border border-border px-3 py-1.5 text-[11.5px] font-medium text-text-muted transition-colors hover:border-border-strong hover:text-text"
                >
                  Retry
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="card-surface rounded-card flex flex-col items-center justify-center gap-3 px-5 py-20 text-text-muted">
                <p className="text-[12.5px]">{search ? 'No prompts match your search.' : 'No prompts registered yet.'}</p>
                {!search && (
                  <PermissionGate need="edit">
                    <button
                      type="button"
                      onClick={() => setFormOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-accent-fg transition-colors hover:bg-accent-strong"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Register first prompt
                    </button>
                  </PermissionGate>
                )}
              </div>
            ) : (
              /* The row grid is wider than a narrow viewport, so the card
                 scrolls its own table sideways rather than the page. */
              <TableCard>
                <div className="overflow-x-auto">
                  <div className="min-w-[1040px]">
                    <TableHead>
                      <div className="grid items-center gap-3" style={LIST_GRID}>
                        {/* The status dot's column still needs a grid cell, so
                            the label hides inside the cell rather than on it —
                            `sr-only` is absolutely positioned and would drop
                            the cell out of the grid, shifting every header. */}
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
                        onClick={() => router.push(`/prompts/${encodeURIComponent(p.name)}`)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            router.push(`/prompts/${encodeURIComponent(p.name)}`)
                          }
                        }}
                        className={cn(
                          ROW,
                          'group grid cursor-pointer items-center gap-3 text-left font-mono text-[12px] transition-colors hover:bg-bg-muted focus:bg-bg-muted focus:outline-none',
                        )}
                        style={LIST_GRID}
                      >
                        {/* Status dot */}
                        <span>
                          <span className={cn(
                            'block h-1.5 w-1.5 rounded-full',
                            (p.stats?.calls ?? 0) > 0 ? 'bg-good' : 'bg-border-strong',
                          )} />
                        </span>

                        {/* Name — the one cell in full ink, per D4. */}
                        <span className="truncate text-text transition-colors group-hover:text-accent">
                          {p.name}
                        </span>

                        <span className="text-text-muted">v{p.version}</span>

                        {/* Version count — deep-links to the Versions tab on the
                            detail page. */}
                        <span>
                          <Link
                            href={`/prompts/${encodeURIComponent(p.name)}?tab=versions`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-text-muted transition-colors hover:text-accent"
                          >
                            {p.versionCount ?? p.version}
                          </Link>
                        </span>

                        <span className={cn('tabular-nums', p.stats && p.stats.calls > 0 ? 'text-text-muted' : 'text-text-faint')}>
                          {p.stats?.calls ? p.stats.calls.toLocaleString() : '—'}
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

                        {/* A/B lozenge — pulses while a test is running so the eye
                            lands on the active one in a list of many prompts. */}
                        <span>
                          {p.activeExperiment ? (
                            <StatusPill variant="warn" className="animate-pulse">A/B</StatusPill>
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
