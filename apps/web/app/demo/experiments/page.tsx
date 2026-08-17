'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { Plus, Search } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { DemoExportButton } from '@/components/ui/demo-export-button'
import { cn } from '@/lib/utils'
import { StatusPill } from '@/components/ui/primitives'

/** The tints `StatusPill` accepts, read off the primitive itself. */
type TagVariant = NonNullable<React.ComponentProps<typeof StatusPill>['variant']>
import { useHydrationSafeNow } from '@/lib/hydration-safe-now'
import { DEMO_EXPERIMENTS } from '@/lib/demo-data'
import type { Experiment, ExperimentStatus } from '@/lib/queries/use-experiments'
import {
  Board,
  TOPBAR_BLEED,
  FilterBar,
  CONTROL,
  Segment,
  SegmentItem,
  StatCard,
  TableCard,
  TableHead,
  Th,
  ROW,
} from '../../(dashboard)/_board/surfaces'

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return '—'
  return n >= 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(5)}`
}
function fmtScore(n: number | null | undefined): string {
  return n == null ? '—' : (n * 100).toFixed(1)
}
function fmtDelta(n: number | null): string {
  if (n == null) return '—'
  return (n > 0 ? '+' : '') + (n * 100).toFixed(1)
}

/*
 * Compact "2h ago" age for the STARTED column. `now` comes from
 * `useHydrationSafeNow()` and is 0 until hydration, so the SSR pass and the
 * first client paint emit the same blank cell (gotcha #22 B).
 */
function relAge(iso: string, now: number): string {
  if (!now) return ' '
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

// Score tier — same >=0.80 / >=0.60 ramp the live boards use.
function scoreColor(score: number | null | undefined): string {
  if (score == null) return 'text-text-faint'
  if (score >= 0.8) return 'text-good'
  if (score >= 0.6) return 'text-warn'
  return 'text-bad'
}

/* Run state → lozenge tint, matching the STATUS column on `D12 · Experiments`. */
const STATUS_TAG: Record<ExperimentStatus, TagVariant> = {
  running:   'warn',
  completed: 'good',
  failed:    'bad',
  pending:   'neutral',
}

/* Shared column template so the header band and the rows stay locked. */
const EXPERIMENT_GRID: CSSProperties = {
  gridTemplateColumns: 'minmax(180px,1fr) 150px 150px 84px 84px 84px 84px 96px 108px',
}

function ExperimentRow({ exp, now }: { exp: Experiment; now: number }) {
  const delta =
    exp.avg_score_a == null || exp.avg_score_b == null ? null : exp.avg_score_b - exp.avg_score_a

  return (
    <Link
      href={`/demo/experiments/${exp.id}`}
      className={cn(ROW, 'grid items-center gap-3 font-mono text-[12px] leading-[1.45] transition-colors hover:bg-bg-muted')}
      style={EXPERIMENT_GRID}
    >
      <span className="truncate text-text">{exp.name}</span>
      <span className="truncate text-text-muted">{exp.prompt_name}</span>
      <span className="truncate text-text-muted">{exp.run_model}</span>
      <span className={cn('tabular-nums', scoreColor(exp.avg_score_a))}>{fmtScore(exp.avg_score_a)}</span>
      <span className={cn('tabular-nums', scoreColor(exp.avg_score_b))}>{fmtScore(exp.avg_score_b)}</span>
      <span className={cn(
        'tabular-nums',
        delta == null ? 'text-text-faint' : delta > 0 ? 'text-good' : delta < 0 ? 'text-bad' : 'text-text-muted',
      )}>
        {fmtDelta(delta)}
      </span>
      <span className="tabular-nums text-text-muted">{fmtUsd(exp.total_cost_usd)}</span>
      <span className="text-text-muted">{relAge(exp.started_at, now)}</span>
      <span><StatusPill variant={STATUS_TAG[exp.status]}>{exp.status}</StatusPill></span>
    </Link>
  )
}

const STATUS_FILTERS = ['all', 'running', 'completed', 'failed', 'pending'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

export default function DemoExperimentsPage() {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const now = useHydrationSafeNow()

  const stats = useMemo(() => {
    let running = 0
    let spend = 0
    let best: { delta: number; name: string } | null = null
    const datasets = new Set<string>()
    for (const e of DEMO_EXPERIMENTS) {
      if (e.status === 'running' || e.status === 'pending') running += 1
      datasets.add(e.dataset_id)
      spend += e.total_cost_usd ?? 0
      if (e.avg_score_a != null && e.avg_score_b != null) {
        const d = e.avg_score_b - e.avg_score_a
        if (!best || d > best.delta) best = { delta: d, name: e.name }
      }
    }
    return { total: DEMO_EXPERIMENTS.length, running, datasets: datasets.size, spend, best }
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return DEMO_EXPERIMENTS.filter((e) => {
      if (status !== 'all' && e.status !== status) return false
      if (q && !(e.name.toLowerCase().includes(q) || e.prompt_name.toLowerCase().includes(q) || e.run_model.toLowerCase().includes(q))) {
        return false
      }
      return true
    })
  }, [query, status])

  const isFiltered = query.trim().length > 0 || status !== 'all'

  return (
    <div>
      <div className={TOPBAR_BLEED}>
        <Topbar
          crumbs={[{ label: 'Demo', href: '/demo/dashboard' }, { label: 'Experiments' }]}
          right={
            <div className="flex items-center gap-2">
              <DemoExportButton
                base="experiments"
                rows={filtered}
                columns={[
                  { header: 'Name', value: (e) => e.name },
                  { header: 'Status', value: (e) => e.status },
                  { header: 'Prompt', value: (e) => e.prompt_name },
                  { header: 'Model', value: (e) => e.run_model },
                  { header: 'Score A', value: (e) => fmtScore(e.avg_score_a) },
                  { header: 'Score B', value: (e) => fmtScore(e.avg_score_b) },
                  { header: 'Cost USD', value: (e) => e.total_cost_usd ?? '' },
                ]}
              />
              <button
                type="button"
                onClick={() => alert('Creating experiments, sign up to use this')}
                className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-accent-fg transition-colors hover:bg-accent-strong"
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">New experiment</span>
              </button>
            </div>
          }
        />
        <h1 className="sr-only">Experiments</h1>
      </div>

      <Board>
        <FilterBar>
          <div className={cn(CONTROL, 'flex min-w-[220px] flex-1 items-center gap-2 px-3')}>
            <Search className="h-[13px] w-[13px] shrink-0 text-text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('')
              }}
              placeholder="Search experiments"
              aria-label="Search experiments"
              className="w-full bg-transparent text-[12.5px] leading-[18px] text-text placeholder:text-text-faint focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="shrink-0 font-mono text-[11px] text-text-faint transition-colors hover:text-text"
              >
                Clear
              </button>
            )}
          </div>

          <Segment>
            {STATUS_FILTERS.map((s) => (
              <SegmentItem key={s} active={s === status} onClick={() => setStatus(s)} className="capitalize">
                {s}
              </SegmentItem>
            ))}
          </Segment>

          {isFiltered && (
            <span className="whitespace-nowrap font-mono text-[11px] text-text-faint">
              {filtered.length} of {stats.total}
            </span>
          )}
        </FilterBar>

        {/* Stat strip */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Experiments"
            value={stats.total}
            foot={`${stats.running} running now`}
            {...(stats.running > 0 ? { footClass: 'text-accent' } : {})}
          />
          <StatCard label="Datasets used" value={stats.datasets} foot="across all experiments" />
          <StatCard
            label="Best delta"
            value={stats.best ? fmtDelta(stats.best.delta) : '—'}
            foot={stats.best ? stats.best.name : 'no graded pairs yet'}
            {...(stats.best && stats.best.delta > 0 ? { footClass: 'text-good' } : {})}
          />
          <StatCard label="Spend on runs" value={fmtUsd(stats.spend)} foot="all experiments" />
        </div>

        <div className="card-surface rounded-card px-5 py-3.5 font-mono text-[11px] leading-[1.6] text-text-muted">
          Offline side-by-side: runs both prompt versions on a dataset and compares outputs.
          Unlike A/B (Prompts), no production traffic is affected.
        </div>

        {filtered.length === 0 ? (
          <div className="card-surface rounded-card flex h-40 flex-col items-center justify-center gap-3 text-text-muted">
            <p className="text-[12.5px]">No experiments match your filters.</p>
            {isFiltered && (
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  setStatus('all')
                }}
                className="font-mono text-[11px] text-text underline underline-offset-2 hover:no-underline"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          /* Wider than a narrow viewport, so the card scrolls its own table
             sideways rather than the page. */
          <TableCard>
            <div className="overflow-x-auto">
              <div className="min-w-[1060px]">
                <TableHead>
                  <div className="grid items-center gap-3" style={EXPERIMENT_GRID}>
                    <Th>Experiment</Th>
                    <Th>Prompt</Th>
                    <Th>Model</Th>
                    <Th>A score</Th>
                    <Th>B score</Th>
                    <Th>Delta</Th>
                    <Th>Cost</Th>
                    <Th>Started</Th>
                    <Th>Status</Th>
                  </div>
                </TableHead>
                {filtered.map((exp) => <ExperimentRow key={exp.id} exp={exp} now={now} />)}
              </div>
            </div>
          </TableCard>
        )}
      </Board>
    </div>
  )
}
