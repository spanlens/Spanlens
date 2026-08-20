'use client'
import { useState } from 'react'
import { Play, Trash2 } from 'lucide-react'
import { cn, formatDateTime } from '@/lib/utils'
import { useEvalRuns, useDeleteEvaluator, type Evaluator } from '@/lib/queries/use-evals'
import { ROW } from '../../_board/surfaces'
import { StatusPill } from '@/components/ui/primitives'
import { fmtScore, scoreColor } from '../_shared/format'
import { StatusBadge } from '../_shared/status-badge'
import { EVAL_GRID, relAge, runTagVariant } from '../_shared/table'

// ── Evaluator row ────────────────────────────────────────────────────────────

export function EvaluatorRow({
  evaluator,
  onRun,
  onSelectRun,
}: {
  evaluator: Evaluator
  onRun: (e: Evaluator) => void
  onSelectRun: (runId: string) => void
}) {
  const runs = useEvalRuns({ evaluatorId: evaluator.id })
  const deleteMutation = useDeleteEvaluator()
  const [expanded, setExpanded] = useState(false)

  const runList = runs.data ?? []
  const latestCompleted = runList.find((r) => r.status === 'completed')
  const latest = runList[0]

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(`Delete evaluator "${evaluator.name}"?`)) return
    void deleteMutation.mutateAsync(evaluator.id)
  }

  return (
    <div className="border-b border-border last:border-b-0">
      {/* Outer container is a div, not a button: HTML forbids nested buttons,
          and we need the Run/Delete buttons inside the same row. Keyboard
          activation is preserved via role="button" + Enter/Space handlers. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setExpanded((v) => !v)
          }
        }}
        className={cn(
          ROW,
          'grid items-center gap-3 border-b-0 text-left transition-colors hover:bg-bg-muted cursor-pointer',
        )}
        style={EVAL_GRID}
      >
        <span className="font-mono text-[12px] text-text truncate">{evaluator.name}</span>
        <span className="font-mono text-[12px] text-text-muted truncate">{evaluator.prompt_name}</span>
        <span className="font-mono text-[12px] text-text-muted truncate">
          {evaluator.config.judge_model}
        </span>
        <span className="font-mono text-[12px] text-text-muted tabular-nums">{runList.length}</span>
        <span
          className={cn(
            'font-mono text-[12px] tabular-nums',
            latestCompleted ? scoreColor(latestCompleted.avg_score) : 'text-text-faint',
          )}
        >
          {latestCompleted ? fmtScore(latestCompleted.avg_score) : '—'}
        </span>
        <span className="font-mono text-[12px] text-text-muted tabular-nums">
          {latest ? relAge(latest.started_at) : '—'}
        </span>
        <span>
          {latest ? (
            <StatusPill variant={runTagVariant(latest.status)}>{latest.status}</StatusPill>
          ) : (
            <span className="font-mono text-[12px] text-text-faint">no runs</span>
          )}
        </span>
        <span className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRun(evaluator)
            }}
            className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11.5px] font-medium text-text-muted transition-colors hover:bg-bg-muted hover:text-text"
          >
            <Play className="h-3 w-3" />
            Run
          </button>
          <button
            type="button"
            onClick={handleDelete}
            aria-label={`Delete evaluator ${evaluator.name}`}
            className="p-1 text-text-faint transition-colors hover:text-bad"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>

      {expanded && (
        <div className="border-t border-border bg-bg-muted px-[18px] py-3">
          {runList.length === 0 ? (
            <p className="font-mono text-[11.5px] text-text-faint">No runs yet.</p>
          ) : (
            <div className="space-y-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-faint mb-1.5">
                Recent runs
              </p>
              {runList.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onSelectRun(r.id)}
                  className="flex w-full items-center gap-3 rounded px-2 py-1.5 text-left transition-colors hover:bg-bg-muted"
                >
                  <StatusBadge status={r.status} />
                  <span className="font-mono text-[11.5px] text-text-muted">
                    {formatDateTime(r.started_at)}
                  </span>
                  <span className="font-mono text-[11.5px] text-text-faint tabular-nums">
                    {r.scored_count}/{r.sample_size}
                  </span>
                  <span
                    className={cn('ml-auto font-mono text-[12px] tabular-nums', scoreColor(r.avg_score))}
                  >
                    {fmtScore(r.avg_score)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
