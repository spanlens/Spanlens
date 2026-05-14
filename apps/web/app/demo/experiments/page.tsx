'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { FlaskConical, Plus } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
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
  const delta = useMemo(() => {
    if (exp.avg_score_a == null || exp.avg_score_b == null) return null
    return exp.avg_score_b - exp.avg_score_a
  }, [exp.avg_score_a, exp.avg_score_b])

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
      <div className="font-mono text-[12px] text-text-muted w-[90px] text-right">
        {fmtScore(exp.avg_score_a)}
      </div>
      <div className="font-mono text-[12px] text-text-muted w-[90px] text-right">
        {fmtScore(exp.avg_score_b)}
      </div>
      <div className={cn(
        'font-mono text-[12px] w-[80px] text-right',
        delta == null ? 'text-text-faint' : delta > 0 ? 'text-good' : delta < 0 ? 'text-bad' : 'text-text-muted',
      )}>
        {delta == null ? '—' : (delta > 0 ? '+' : '') + (delta * 100).toFixed(1)}
      </div>
      <div className="font-mono text-[11px] text-text-faint w-[80px] text-right">
        {fmtUsd(exp.total_cost_usd)}
      </div>
    </Link>
  )
}

export default function DemoExperimentsPage() {
  const list = DEMO_EXPERIMENTS
  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col h-screen overflow-hidden bg-bg">
      <Topbar
        crumbs={[{ label: 'Demo', href: '/demo/dashboard' }, { label: 'Experiments' }]}
        right={
          <button
            type="button"
            onClick={() => alert('Creating experiments — sign up to use this')}
            className="font-mono text-[11.5px] px-3 py-[6px] rounded-[5px] bg-text text-bg font-medium hover:opacity-90 flex items-center gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            New experiment
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto">
        <div className="px-[22px] py-[12px] bg-bg-muted border-b border-border flex items-center gap-2 font-mono text-[11px] text-text-muted">
          <FlaskConical className="h-3.5 w-3.5" />
          <span>
            Offline side-by-side: runs both prompt versions on a dataset and compares outputs.
            Unlike A/B (Prompts), no production traffic is affected.
          </span>
        </div>
        <div className="flex items-center px-[16px] py-[8px] bg-bg-muted border-b border-border font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
          <span className="flex-1">Name</span>
          <span className="w-[90px] text-right">A score</span>
          <span className="w-[90px] text-right">B score</span>
          <span className="w-[80px] text-right">Δ</span>
          <span className="w-[80px] text-right">Cost</span>
        </div>
        {list.map((exp) => <ExperimentRow key={exp.id} exp={exp} />)}
      </div>
    </div>
  )
}
