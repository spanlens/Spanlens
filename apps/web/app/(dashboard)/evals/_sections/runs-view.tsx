'use client'
import { Play } from 'lucide-react'
import { cn, formatDateTime } from '@/lib/utils'
import { useEvalRuns, type Evaluator } from '@/lib/queries/use-evals'
import { fmtUsd, fmtScore, scoreColor } from '../_shared/format'
import { StatusBadge } from '../_shared/status-badge'

// ── Runs view (Results tab) ──────────────────────────────────────────────────

export function RunsView({
  evaluatorsById,
  onSelectRun,
  selectedRunId,
}: {
  evaluatorsById: Map<string, Evaluator>
  onSelectRun: (id: string) => void
  selectedRunId: string | null
}) {
  const runs = useEvalRuns()
  const list = runs.data ?? []

  if (runs.isLoading) {
    return (
      <div className="p-[22px] space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-bg-elev rounded animate-pulse" />
        ))}
      </div>
    )
  }

  if (list.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-text-muted">
        <Play className="h-9 w-9 text-text-faint" />
        <p className="font-mono text-[13px]">No runs yet.</p>
        <p className="font-mono text-[11.5px] text-text-faint max-w-[360px] text-center">
          Create an evaluator, then run it against a dataset or production traffic to see results here.
        </p>
      </div>
    )
  }

  // Inline grid template — Tailwind's JIT does not always parse arbitrary
  // grid-cols with commas reliably, so set columns via style for stability.
  const rowGridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '160px 1.6fr 110px 90px 90px 90px',
    gap: 12,
    alignItems: 'center',
  }

  return (
    <div>
      {/* Header */}
      <div
        className="px-[22px] py-[8px] bg-bg-muted border-b border-border font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint"
        style={rowGridStyle}
      >
        <span>Started</span>
        <span>Evaluator · Prompt</span>
        <span>Status</span>
        <span>Avg score</span>
        <span>Samples</span>
        <span className="text-right">Cost</span>
      </div>
      {list.map((r) => {
        const ev = evaluatorsById.get(r.evaluator_id)
        const isSelected = selectedRunId === r.id
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => onSelectRun(r.id)}
            className={cn(
              'px-[22px] py-[10px] border-b border-border text-left hover:bg-bg-elev transition-colors w-full',
              isSelected && 'bg-bg-elev',
            )}
            style={rowGridStyle}
          >
            <span className="font-mono text-[11px] text-text-muted tabular-nums">
              {formatDateTime(r.started_at)}
            </span>
            <div className="min-w-0">
              <div className="text-[12.5px] text-text truncate">{ev?.name ?? 'Unknown evaluator'}</div>
              <div className="font-mono text-[10.5px] text-text-faint truncate">
                {ev?.prompt_name ?? '—'} · {r.source}
              </div>
            </div>
            <StatusBadge status={r.status} />
            <span className={cn('font-mono text-[12px] tabular-nums', scoreColor(r.avg_score))}>
              {fmtScore(r.avg_score)}
            </span>
            <span className="font-mono text-[11.5px] text-text-muted tabular-nums">
              {r.scored_count}/{r.sample_size}
            </span>
            <span className="font-mono text-[11.5px] text-text-muted text-right tabular-nums">
              {fmtUsd(r.total_cost_usd)}
            </span>
          </button>
        )
      })}
    </div>
  )
}
