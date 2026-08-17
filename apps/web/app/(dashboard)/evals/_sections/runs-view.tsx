'use client'
import { Play } from 'lucide-react'
import { cn, formatDateTime } from '@/lib/utils'
import { useEvalRuns, type Evaluator } from '@/lib/queries/use-evals'
import { TableCard, TableHead, Th, ROW } from '../../_board/surfaces'
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
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-bg-chip rounded-card animate-pulse" />
        ))}
      </div>
    )
  }

  if (list.length === 0) {
    return (
      <div className="card-surface rounded-card flex h-64 flex-col items-center justify-center gap-3 text-text-muted">
        <Play className="h-9 w-9 text-text-faint" />
        <p className="text-[13.5px] font-semibold text-text">No runs yet.</p>
        <p className="max-w-[380px] text-center text-[12.5px] leading-[1.6] text-text-muted">
          Create an evaluator, then run it against a dataset or production traffic to see results here.
        </p>
      </div>
    )
  }

  // Inline grid template — Tailwind's JIT does not always parse arbitrary
  // grid-cols with commas reliably, so set columns via style for stability.
  const rowGridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '160px minmax(160px,1.6fr) 110px 90px 90px 90px',
    gap: 12,
    alignItems: 'center',
  }

  return (
    <TableCard>
      <div className="overflow-x-auto">
        <div className="min-w-[840px]">
          <TableHead>
            <div style={rowGridStyle}>
              <Th>Started</Th>
              <Th>Evaluator · Prompt</Th>
              <Th>Status</Th>
              <Th>Avg score</Th>
              <Th>Samples</Th>
              <Th className="text-right">Cost</Th>
            </div>
          </TableHead>
          {list.map((r) => {
            const ev = evaluatorsById.get(r.evaluator_id)
            const isSelected = selectedRunId === r.id
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onSelectRun(r.id)}
                className={cn(
                  ROW,
                  'w-full text-left transition-colors hover:bg-bg-muted',
                  isSelected && 'bg-bg-muted',
                )}
                style={rowGridStyle}
              >
                <span className="font-mono text-[12px] text-text-muted tabular-nums">
                  {formatDateTime(r.started_at)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-mono text-[12px] text-text">
                    {ev?.name ?? 'Unknown evaluator'}
                  </span>
                  <span className="block truncate font-mono text-[10.5px] text-text-faint">
                    {ev?.prompt_name ?? '—'} · {r.source}
                  </span>
                </span>
                <StatusBadge status={r.status} />
                <span className={cn('font-mono text-[12px] tabular-nums', scoreColor(r.avg_score))}>
                  {fmtScore(r.avg_score)}
                </span>
                <span className="font-mono text-[12px] text-text-muted tabular-nums">
                  {r.scored_count}/{r.sample_size}
                </span>
                <span className="text-right font-mono text-[12px] text-text-muted tabular-nums">
                  {fmtUsd(r.total_cost_usd)}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </TableCard>
  )
}
