'use client'

import { useMemo, useState } from 'react'
import { Beaker, Play, Trash2, Plus, AlertTriangle } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { cn } from '@/lib/utils'
import {
  DEMO_EVALUATORS,
  DEMO_EVAL_RUNS,
  DEMO_EVAL_RESULTS,
  DEMO_CORRELATION_PAIRS,
} from '@/lib/demo-data'
import type { Evaluator, EvalRunStatus } from '@/lib/queries/use-evals'
import { pearsonR } from '@/lib/queries/use-human-evals'

function demoNotice(action: string) {
  return () => alert(`${action}, sign up to use this`)
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return '—'
  return n >= 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(5)}`
}
function fmtScore(n: number | null | undefined): string {
  return n == null ? '—' : `${(n * 100).toFixed(1)}`
}

function StatusBadge({ status }: { status: EvalRunStatus }) {
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

// ── Correlation card ────────────────────────────────────────────────────────

function CorrelationCard({ promptName }: { promptName: string }) {
  const pairs = DEMO_CORRELATION_PAIRS[promptName] ?? []
  const r = pearsonR(pairs)
  if (pairs.length === 0) return null

  const W = 120, H = 120, PAD = 6
  const dotX = (s: number) => PAD + s * (W - 2 * PAD)
  const dotY = (s: number) => H - PAD - s * (H - 2 * PAD)

  const interpretation = r == null
    ? '—'
    : Math.abs(r) >= 0.7 ? 'Strong'
    : Math.abs(r) >= 0.4 ? 'Moderate'
    : Math.abs(r) >= 0.2 ? 'Weak'
    : 'None'
  const rColor = r == null ? 'text-text-faint' : r >= 0.7 ? 'text-good' : r >= 0.4 ? 'text-warn' : 'text-bad'

  return (
    <div className="bg-bg-elev border border-border rounded-[6px] p-4">
      <div className="flex items-start gap-4">
        <svg width={W} height={H} className="shrink-0 bg-bg rounded-[4px] border border-border">
          <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={PAD} stroke="currentColor" strokeOpacity={0.3} strokeDasharray="2 2" />
          {pairs.map((p) => (
            <circle key={p.requestId} cx={dotX(p.judgeScore)} cy={dotY(p.humanScore)} r={2.5} className="fill-text/70" />
          ))}
        </svg>
        <div className="flex-1 min-w-0 space-y-2">
          <div>
            <p className="font-mono text-[11px] text-text-faint mb-0.5 truncate">{promptName}</p>
            <div className="flex items-baseline gap-2">
              <span className={cn('font-mono text-[22px] font-medium', rColor)}>
                {r == null ? '—' : r.toFixed(2)}
              </span>
              <span className="font-mono text-[10.5px] text-text-muted">
                Pearson r · {interpretation}
              </span>
            </div>
          </div>
          <div className="font-mono text-[10.5px] text-text-faint">
            {pairs.length} paired sample{pairs.length === 1 ? '' : 's'}
          </div>
        </div>
      </div>
      <p className="font-mono text-[10.5px] text-text-faint mt-3 leading-relaxed">
        Dot = one request judged by both. Dashed line = perfect agreement.
      </p>
    </div>
  )
}

// ── Run detail panel ─────────────────────────────────────────────────────────

function RunDetailPanel({ runId, onClose }: { runId: string; onClose: () => void }) {
  const run = DEMO_EVAL_RUNS.find((r) => r.id === runId)
  // Memoize results lookup so it has a stable identity across renders
  // (DEMO_EVAL_RESULTS[runId] ?? [] would create a new [] on each render).
  const results = useMemo(() => DEMO_EVAL_RESULTS[runId] ?? [], [runId])

  const histBuckets = useMemo(() => {
    const buckets = [0, 0, 0, 0, 0]
    for (const result of results) {
      const idx = Math.min(4, Math.floor(result.score * 5))
      buckets[idx] = (buckets[idx] ?? 0) + 1
    }
    return buckets
  }, [results])
  const maxBucket = Math.max(1, ...histBuckets)

  const lowest = useMemo(
    () => [...results].sort((a, b) => a.score - b.score).slice(0, 5),
    [results],
  )

  if (!run) return null

  return (
    <div className="border-l border-border w-[420px] shrink-0 overflow-y-auto">
      <div className="sticky top-0 bg-bg-elev border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusBadge status={run.status} />
          <span className="font-mono text-[11px] text-text-muted">
            {run.scored_count}/{run.sample_size} scored
          </span>
        </div>
        <button onClick={onClose} className="text-text-faint hover:text-text text-xs">✕</button>
      </div>
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-bg-muted border border-border rounded-[5px] px-3 py-2">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-text-faint">Avg score</p>
            <p className="font-mono text-[16px] text-text font-medium">{fmtScore(run.avg_score)}</p>
          </div>
          <div className="bg-bg-muted border border-border rounded-[5px] px-3 py-2">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-text-faint">Samples</p>
            <p className="font-mono text-[16px] text-text font-medium">{run.scored_count}</p>
          </div>
          <div className="bg-bg-muted border border-border rounded-[5px] px-3 py-2">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-text-faint">Cost</p>
            <p className="font-mono text-[16px] text-text font-medium">{fmtUsd(run.total_cost_usd)}</p>
          </div>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-2">Score distribution</p>
          <div className="flex items-end gap-1 h-20">
            {histBuckets.map((c, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full bg-text/70 rounded-[2px]" style={{ height: `${(c / maxBucket) * 60}px` }} />
                <span className="font-mono text-[9px] text-text-faint">{c}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between font-mono text-[9px] text-text-faint mt-1">
            <span>0</span><span>0.2</span><span>0.4</span><span>0.6</span><span>0.8</span><span>1</span>
          </div>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-2">Lowest-scoring samples</p>
          <div className="space-y-2">
            {lowest.map((res) => (
              <div key={res.id} className="block p-2 rounded-[5px] border border-border bg-bg">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-mono text-[12px] text-text font-medium">{fmtScore(res.score)}</span>
                  <span className="font-mono text-[10px] text-text-faint">{fmtUsd(res.judge_cost_usd)}</span>
                </div>
                {res.reasoning && (
                  <p className="font-mono text-[10.5px] text-text-muted line-clamp-2">{res.reasoning}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Evaluator row ───────────────────────────────────────────────────────────

function EvaluatorRow({
  evaluator,
  onSelectRun,
}: {
  evaluator: Evaluator
  onSelectRun: (runId: string) => void
}) {
  const runs = DEMO_EVAL_RUNS.filter((r) => r.evaluator_id === evaluator.id)
  const [expanded, setExpanded] = useState(false)
  const latestCompleted = runs.find((r) => r.status === 'completed')

  return (
    <div className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center px-[16px] py-[12px] hover:bg-bg-muted transition-colors text-left"
      >
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[13px] text-text font-medium truncate">{evaluator.name}</p>
          <p className="font-mono text-[11px] text-text-faint truncate">
            {evaluator.prompt_name} · judge: {evaluator.config.judge_model}
          </p>
        </div>
        <div className="font-mono text-[12px] text-text-muted w-[100px] text-right">
          {latestCompleted ? fmtScore(latestCompleted.avg_score) : '—'}
        </div>
        <div className="font-mono text-[11px] text-text-faint w-[80px] text-right">
          {runs.length} runs
        </div>
        <div className="flex items-center gap-2 ml-3">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); demoNotice('Running evaluations')() }}
            className="font-mono text-[11px] px-2 py-1 rounded-[4px] border border-border hover:bg-bg-elev flex items-center gap-1"
          >
            <Play className="h-3 w-3" />
            Run
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); demoNotice('Deleting evaluators')() }}
            className="text-text-faint hover:text-bad p-1"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </button>
      {expanded && (
        <div className="bg-bg-muted/50 px-[16px] py-[10px] border-t border-border">
          <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
            Recent runs
          </p>
          <div className="space-y-1.5">
            {runs.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onSelectRun(r.id)}
                className="w-full flex items-center gap-3 px-2 py-1.5 rounded-[4px] hover:bg-bg-elev text-left"
              >
                <StatusBadge status={r.status} />
                <span className="font-mono text-[11.5px] text-text-muted">
                  {new Date(r.started_at).toLocaleString()}
                </span>
                <span className="font-mono text-[11.5px] text-text-faint">
                  {r.scored_count}/{r.sample_size}
                </span>
                <span className="font-mono text-[12px] text-text ml-auto">{fmtScore(r.avg_score)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function DemoEvalsPage() {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const promptNames = useMemo(() => {
    const set = new Set<string>()
    for (const ev of DEMO_EVALUATORS) set.add(ev.prompt_name)
    return [...set]
  }, [])

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col h-screen overflow-hidden bg-bg">
      <Topbar
        crumbs={[{ label: 'Demo', href: '/demo/dashboard' }, { label: 'Evals' }]}
        right={
          <button
            type="button"
            onClick={demoNotice('Creating evaluators')}
            className="font-mono text-[11.5px] px-3 py-[6px] rounded-[5px] bg-text text-bg font-medium hover:opacity-90 flex items-center gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            New evaluator
          </button>
        }
      />
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto">
          <div className="px-[22px] py-[12px] bg-bg-muted border-b border-border flex items-center gap-2 font-mono text-[11px] text-text-muted">
            <Beaker className="h-3.5 w-3.5" />
            <span>
              LLM-as-judge scores production responses against a criterion you define.
              Cost is billed to your provider key.
            </span>
          </div>

          {/* Correlation cards */}
          <div className="px-[22px] py-[14px] border-b border-border">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-3">
              <span>LLM judge vs Human agreement</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {promptNames.map((name) => <CorrelationCard key={name} promptName={name} />)}
            </div>
          </div>

          {/* Evaluator list */}
          <div className="flex items-center px-[16px] py-[8px] bg-bg-muted border-b border-border font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
            <span className="flex-1">Evaluator</span>
            <span className="w-[100px] text-right">Avg score</span>
            <span className="w-[80px] text-right">Runs</span>
            <span className="w-[150px]" />
          </div>
          {DEMO_EVALUATORS.map((ev) => (
            <EvaluatorRow key={ev.id} evaluator={ev} onSelectRun={(rid) => setSelectedRunId(rid)} />
          ))}

          <div className="p-[22px] flex items-start gap-2 font-mono text-[11px] text-text-faint">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              This is sample data. Sign up free to run real evaluations against your production traffic.
            </span>
          </div>
        </div>

        {selectedRunId && (
          <RunDetailPanel runId={selectedRunId} onClose={() => setSelectedRunId(null)} />
        )}
      </div>
    </div>
  )
}
