'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { DemoExportButton } from '@/components/ui/demo-export-button'
import { cn } from '@/lib/utils'
import { DEMO_EXPERIMENTS } from '@/lib/demo-data'
import type { Experiment, ExperimentStatus } from '@/lib/queries/use-experiments'

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return '—'
  return n >= 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(5)}`
}
function fmtScore(n: number | null | undefined): string {
  return n == null ? '—' : (n * 100).toFixed(1)
}

function StatusBadge({ status }: { status: ExperimentStatus }) {
  const config = {
    pending:   { label: 'Pending',   cls: 'bg-bg-elev text-text-faint' },
    running:   { label: 'Running',   cls: 'bg-accent-bg text-accent border border-accent-border' },
    completed: { label: 'Completed', cls: 'bg-good/10 text-good border border-good/30' },
    failed:    { label: 'Failed',    cls: 'bg-bad/10 text-bad border border-bad/30' },
  }[status]
  return (
    <span className={cn('font-mono text-[10px] px-[6px] py-[1.5px] rounded-[3px]', config.cls)}>
      {config.label}
    </span>
  )
}

function ExperimentRow({ exp }: { exp: Experiment }) {
  const delta =
    exp.avg_score_a == null || exp.avg_score_b == null ? null : exp.avg_score_b - exp.avg_score_a

  return (
    <Link
      href={`/demo/experiments/${exp.id}`}
      className="flex items-center px-[16px] py-[12px] border-b border-border last:border-0 hover:bg-bg-muted transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="font-mono text-[13px] text-text font-medium truncate">{exp.name}</p>
          <StatusBadge status={exp.status} />
        </div>
        <p className="font-mono text-[11px] text-text-faint truncate">
          {exp.prompt_name} · {exp.run_model}
        </p>
      </div>
      <div className="hidden sm:block font-mono text-[12px] text-text-muted w-[90px] text-right">
        {fmtScore(exp.avg_score_a)}
      </div>
      <div className="hidden sm:block font-mono text-[12px] text-text-muted w-[90px] text-right">
        {fmtScore(exp.avg_score_b)}
      </div>
      <div className={cn(
        'font-mono text-[12px] w-[70px] text-right',
        delta == null ? 'text-text-faint' : delta > 0 ? 'text-good' : delta < 0 ? 'text-bad' : 'text-text-muted',
      )}>
        {delta == null ? '—' : (delta > 0 ? '+' : '') + (delta * 100).toFixed(1)}
      </div>
      <div className="hidden sm:block font-mono text-[11px] text-text-faint w-[80px] text-right">
        {fmtUsd(exp.total_cost_usd)}
      </div>
    </Link>
  )
}

const STATUS_FILTERS = ['all', 'running', 'completed', 'pending', 'failed'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

export default function DemoExperimentsPage() {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')

  const counts = useMemo(() => {
    let running = 0
    let completed = 0
    for (const e of DEMO_EXPERIMENTS) {
      if (e.status === 'running') running += 1
      else if (e.status === 'completed') completed += 1
    }
    return { total: DEMO_EXPERIMENTS.length, running, completed }
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
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col min-h-screen">
      <div className="sticky top-0 z-20 bg-bg">
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
                className="font-mono text-[11.5px] px-3 py-[6px] rounded-[5px] bg-text text-bg font-medium hover:opacity-90 flex items-center gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">New experiment</span>
              </button>
            </div>
          }
        />
      </div>

      {/* Stat strip */}
      <div className="overflow-x-auto shrink-0 border-b border-border">
        <div className="grid grid-cols-3 min-w-[360px]">
          {[
            { label: 'Experiments', value: String(counts.total) },
            { label: 'Running', value: String(counts.running) },
            { label: 'Completed', value: String(counts.completed) },
          ].map((s, i) => (
            <div key={s.label} className={cn('px-[18px] py-[14px]', i < 2 && 'border-r border-border')}>
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">{s.label}</div>
              <div className="text-[20px] font-medium tracking-[-0.4px] text-text">{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1">
        <div className="px-[22px] py-[12px] bg-bg-muted border-b border-border flex items-center gap-2 font-mono text-[11px] text-text-muted">
          <span>
            Offline side-by-side: runs both prompt versions on a dataset and compares outputs.
            Unlike A/B (Prompts), no production traffic is affected.
          </span>
        </div>

        {/* Search + status filter */}
        <div className="flex flex-wrap items-center gap-2 px-[16px] py-[10px] border-b border-border">
          <div className="relative flex-1 min-w-[180px] max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('')
              }}
              placeholder="Search experiments…"
              className="w-full pl-8 pr-8 py-1.5 font-mono text-[12px] bg-bg-elev border border-border rounded-[6px] text-text placeholder:text-text-faint focus:outline-none focus:border-accent"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-faint hover:text-text transition-colors"
              >
                ✕
              </button>
            )}
          </div>
          <div className="flex border border-border rounded-[6px] overflow-hidden">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={cn(
                  'font-mono text-[11px] px-[10px] py-[6px] border-r border-border last:border-r-0 transition-colors capitalize',
                  s === status ? 'bg-bg-elev text-text font-medium' : 'bg-transparent text-text-muted hover:text-text',
                )}
              >
                {s}
              </button>
            ))}
          </div>
          {isFiltered && (
            <span className="font-mono text-[11px] text-text-faint whitespace-nowrap">
              {filtered.length} of {counts.total}
            </span>
          )}
        </div>

        {/* Column header */}
        <div className="flex items-center px-[16px] py-[8px] bg-bg-muted border-b border-border font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
          <span className="flex-1">Name</span>
          <span className="hidden sm:block w-[90px] text-right">A score</span>
          <span className="hidden sm:block w-[90px] text-right">B score</span>
          <span className="w-[70px] text-right">Δ</span>
          <span className="hidden sm:block w-[80px] text-right">Cost</span>
        </div>

        {filtered.length === 0 ? (
          <div className="px-[16px] py-16 text-center">
            <p className="font-mono text-[12.5px] text-text-muted mb-1.5">No experiments match your filters</p>
            {isFiltered && (
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  setStatus('all')
                }}
                className="font-mono text-[11px] text-accent hover:opacity-80 transition-opacity"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          filtered.map((exp) => <ExperimentRow key={exp.id} exp={exp} />)
        )}
      </div>
    </div>
  )
}
