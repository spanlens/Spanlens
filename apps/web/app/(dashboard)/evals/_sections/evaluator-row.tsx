'use client'
import { useState } from 'react'
import { Play, Trash2 } from 'lucide-react'
import { cn, formatDateTime } from '@/lib/utils'
import { useEvalRuns, useDeleteEvaluator, type Evaluator } from '@/lib/queries/use-evals'
import { fmtScore, scoreColor } from '../_shared/format'
import { StatusBadge } from '../_shared/status-badge'

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

  const latestCompleted = (runs.data ?? []).find((r) => r.status === 'completed')

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(`Delete evaluator "${evaluator.name}"?`)) return
    void deleteMutation.mutateAsync(evaluator.id)
  }

  return (
    <div className="border-b border-border last:border-0">
      {/* Outer container is a div, not a button: HTML forbids nested buttons,
          and we need the Run/Delete buttons inside the same row. Keyboard
          activation is preserved via role="button" + Enter/Space handlers. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setExpanded((v) => !v)
          }
        }}
        className="w-full flex items-center px-[16px] py-[12px] hover:bg-bg-muted transition-colors text-left cursor-pointer"
        style={{ gridTemplateColumns: '1fr 140px 100px 100px 120px' }}
      >
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[13px] text-text font-medium truncate">{evaluator.name}</p>
          <p className="font-mono text-[11px] text-text-faint truncate">
            {evaluator.prompt_name} · judge: {evaluator.config.judge_model}
          </p>
        </div>
        <div className={cn('font-mono text-[12px] w-[100px] text-right tabular-nums', latestCompleted ? scoreColor(latestCompleted.avg_score) : 'text-text-faint')}>
          {latestCompleted ? fmtScore(latestCompleted.avg_score) : '—'}
        </div>
        <div className="font-mono text-[11px] text-text-faint w-[80px] text-right">
          {runs.data?.length ?? 0} runs
        </div>
        <div className="flex items-center gap-2 ml-3">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRun(evaluator) }}
            className="font-mono text-[11px] px-2 py-1 rounded-[4px] border border-border hover:bg-bg-elev flex items-center gap-1 transition-colors"
          >
            <Play className="h-3 w-3" />
            Run
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="text-text-faint hover:text-bad transition-colors p-1"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="bg-bg-muted/50 px-[16px] py-[10px] border-t border-border">
          {!runs.data || runs.data.length === 0 ? (
            <p className="font-mono text-[11.5px] text-text-faint">No runs yet.</p>
          ) : (
            <div className="space-y-1.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
                Recent runs
              </p>
              {runs.data.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onSelectRun(r.id)}
                  className="w-full flex items-center gap-3 px-2 py-1.5 rounded-[4px] hover:bg-bg-elev text-left transition-colors"
                >
                  <StatusBadge status={r.status} />
                  <span className="font-mono text-[11.5px] text-text-muted">
                    {formatDateTime(r.started_at)}
                  </span>
                  <span className="font-mono text-[11.5px] text-text-faint">
                    {r.scored_count}/{r.sample_size}
                  </span>
                  <span className={cn('font-mono text-[12px] ml-auto tabular-nums', scoreColor(r.avg_score))}>
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
