'use client'

import { useMemo, useState } from 'react'
import { Beaker, Play, Trash2, Plus, AlertTriangle } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { cn } from '@/lib/utils'
import { StatusPill } from '@/components/ui/primitives'
import {
  Board,
  TOPBAR_BLEED,
  StatCard,
  TableCard,
  TableHead,
  Th,
  ROW,
} from '../../(dashboard)/_board/surfaces'
import { EVAL_GRID, relAge, runTagVariant } from '../../(dashboard)/evals/_shared/table'
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
  const label = { pending: 'Pending', running: 'Running', completed: 'Completed', failed: 'Failed' }[status]
  return <StatusPill variant={runTagVariant(status)}>{label}</StatusPill>
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
    <div className="rounded-lg border border-border bg-bg-sunk p-4">
      <div className="flex items-start gap-4">
        <svg width={W} height={H} className="shrink-0 rounded border border-border bg-bg-elev">
          <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={PAD} stroke="currentColor" strokeOpacity={0.3} strokeDasharray="2 2" />
          {pairs.map((p) => (
            <circle key={p.requestId} cx={dotX(p.judgeScore)} cy={dotY(p.humanScore)} r={2.5} className="fill-text/70" />
          ))}
        </svg>
        <div className="flex-1 min-w-0 space-y-2">
          <div>
            <p className="font-mono text-[11px] text-text-faint mb-0.5 truncate">{promptName}</p>
            {/* flex-wrap so the "Pearson r · …" label drops below the big
                number instead of overflowing the card on narrow (2-up) widths. */}
            <div className="flex items-baseline flex-wrap gap-x-2 gap-y-0.5">
              <span className={cn('font-display text-[22px] tracking-[-0.02em] leading-[1.05]!', rColor)}>
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
    /* Full-screen sheet on mobile, a sticky card in the right column from md
       up, where it holds position as the table scrolls past it. */
    <div className="fixed inset-0 z-30 overflow-y-auto bg-bg md:sticky md:inset-x-auto md:bottom-auto md:top-[77px] md:z-auto md:max-h-[calc(100vh-93px)] md:w-[420px] md:shrink-0 md:rounded-card md:border md:border-border md:bg-bg-elev md:shadow-card">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-bg-elev px-5 py-3.5 md:rounded-t-card">
        <div className="flex items-center gap-2">
          <StatusBadge status={run.status} />
          <span className="font-mono text-[11px] text-text-muted tabular-nums">
            {run.scored_count}/{run.sample_size} scored
          </span>
        </div>
        <button
          onClick={onClose}
          aria-label="Close run detail"
          className="text-xs text-text-faint transition-colors hover:text-text"
        >
          ✕
        </button>
      </div>
      <div className="space-y-4 p-5">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-border bg-bg-sunk px-3 py-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-faint">Avg score</p>
            <p className="font-mono text-[16px] text-text tabular-nums">{fmtScore(run.avg_score)}</p>
            {(() => {
              const m =
                run.score_stddev != null && run.scored_count >= 2
                  ? (1.96 * run.score_stddev) / Math.sqrt(run.scored_count)
                  : null
              return m != null && run.avg_score != null ? (
                <p className="font-mono text-[9px] text-text-faint tabular-nums mt-0.5">±{(m * 100).toFixed(1)} · 95% CI</p>
              ) : null
            })()}
          </div>
          <div className="rounded-lg border border-border bg-bg-sunk px-3 py-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-faint">Samples</p>
            <p className="font-mono text-[16px] text-text tabular-nums">{run.scored_count}</p>
          </div>
          <div className="rounded-lg border border-border bg-bg-sunk px-3 py-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-faint">Cost</p>
            <p className="font-mono text-[16px] text-text tabular-nums">{fmtUsd(run.total_cost_usd)}</p>
          </div>
        </div>
        {/* Scoring-rate transparency (P0-2): the average reflects only the
            scored samples, so when some judge calls failed we say so. */}
        {run.status === 'completed' && run.failed_count > 0 && run.attempted_count > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn-bg p-3 font-mono text-[11.5px] text-warn">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              Scored {run.scored_count} of {run.attempted_count} attempted
              {' '}({Math.round((run.scored_count / run.attempted_count) * 100)}%).
              {' '}{run.failed_count} judge {run.failed_count === 1 ? 'call' : 'calls'} failed,
              {' '}so the average reflects only the scored samples.
            </span>
          </div>
        )}
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-faint mb-2">Score distribution</p>
          <div className="flex items-end gap-1 h-20">
            {histBuckets.map((c, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                {/* Data bars, not a track: they need to read as marks, so they
                    stay on ink rather than the meter-track grey. */}
                <div className="w-full rounded-[2px] bg-text/70" style={{ height: `${(c / maxBucket) * 60}px` }} />
                <span className="font-mono text-[9px] text-text-faint tabular-nums">{c}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between font-mono text-[9px] text-text-faint mt-1">
            <span>0</span><span>0.2</span><span>0.4</span><span>0.6</span><span>0.8</span><span>1</span>
          </div>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-faint mb-2">Lowest-scoring samples</p>
          <div className="space-y-2">
            {lowest.map((res) => (
              <div key={res.id} className="block rounded-lg border border-border bg-bg-sunk p-2">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-mono text-[12px] text-text tabular-nums">{fmtScore(res.score)}</span>
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
  const latest = runs[0]

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
        <span className="font-mono text-[12px] text-text-muted truncate">{evaluator.config.judge_model}</span>
        <span className="font-mono text-[12px] text-text-muted tabular-nums">{runs.length}</span>
        <span className="font-mono text-[12px] text-text-muted tabular-nums">
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
            onClick={(e) => { e.stopPropagation(); demoNotice('Running evaluations')() }}
            className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11.5px] font-medium text-text-muted transition-colors hover:bg-bg-muted hover:text-text"
          >
            <Play className="h-3 w-3" />
            Run
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); demoNotice('Deleting evaluators')() }}
            aria-label={`Delete evaluator ${evaluator.name}`}
            className="p-1 text-text-faint transition-colors hover:text-bad"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
      {expanded && (
        <div className="border-t border-border bg-bg-muted px-[18px] py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-faint mb-1.5">
            Recent runs
          </p>
          <div className="space-y-1">
            {runs.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onSelectRun(r.id)}
                className="flex w-full items-center gap-3 rounded px-2 py-1.5 text-left transition-colors hover:bg-bg-elev"
              >
                <StatusBadge status={r.status} />
                <span className="font-mono text-[11.5px] text-text-muted">
                  {new Date(r.started_at).toLocaleString('en-US')}
                </span>
                <span className="font-mono text-[11.5px] text-text-faint tabular-nums">
                  {r.scored_count}/{r.sample_size}
                </span>
                <span className="ml-auto font-mono text-[12px] text-text tabular-nums">
                  {fmtScore(r.avg_score)}
                </span>
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
  const judgeModels = useMemo(
    () => [...new Set(DEMO_EVALUATORS.map((ev) => ev.config.judge_model))],
    [],
  )

  return (
    <div>
      <div className={TOPBAR_BLEED}>
        <Topbar
          crumbs={[{ label: 'Demo', href: '/demo/dashboard' }, { label: 'Evals' }]}
          right={
            <button
              type="button"
              onClick={demoNotice('Creating evaluators')}
              className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-accent-fg transition-colors hover:bg-accent-strong"
            >
              <Plus className="h-3.5 w-3.5" />
              New evaluator
            </button>
          }
        />
      </div>

      <div className="flex flex-col items-start gap-4 md:flex-row">
        <div className="min-w-0 flex-1">
          <Board>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label="Evaluators"
                value={DEMO_EVALUATORS.length}
                foot={`${DEMO_EVALUATORS.filter((e) => e.archived_at == null).length} active`}
              />
              <StatCard
                label="Distinct prompts"
                value={promptNames.length}
                foot="covered by an eval"
              />
              <StatCard
                label="Distinct judges"
                value={judgeModels.length}
                foot={judgeModels.slice(0, 2).join(', ')}
              />
              <StatCard
                label="Runs"
                value={DEMO_EVAL_RUNS.length}
                foot={`${DEMO_EVAL_RUNS.filter((r) => r.status === 'completed').length} completed`}
              />
            </div>

            <div className="card-surface rounded-card flex flex-wrap items-center gap-2 px-5 py-3.5 font-mono text-[11px] text-text-muted">
              <Beaker className="h-3.5 w-3.5 shrink-0" />
              <span>
                LLM-as-judge scores production responses against a criterion you define.
                Cost is billed to your provider key.
              </span>
            </div>

            <div className="card-surface rounded-card px-5 py-[18px]">
              <div className="mb-3.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-faint">
                LLM judge vs Human agreement
              </div>
              {/* 2-up only at lg+ (1024px): below that the cards are too narrow
                  for the scatter plot + metrics side by side, so go full-width. */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {promptNames.map((name) => <CorrelationCard key={name} promptName={name} />)}
              </div>
            </div>

            {/* The row grid is wider than a narrow viewport, so the card scrolls
                its own table sideways rather than the page. */}
            <TableCard>
              <div className="overflow-x-auto">
                <div className="min-w-[1000px]">
                  <TableHead>
                    <div className="grid items-center gap-3" style={EVAL_GRID}>
                      <Th>Evaluator</Th>
                      <Th>Prompt</Th>
                      <Th>Judge</Th>
                      <Th>Runs</Th>
                      <Th>Avg score</Th>
                      <Th>Last run</Th>
                      <Th>Status</Th>
                      <Th><span className="sr-only">Actions</span></Th>
                    </div>
                  </TableHead>
                  {DEMO_EVALUATORS.map((ev) => (
                    <EvaluatorRow key={ev.id} evaluator={ev} onSelectRun={(rid) => setSelectedRunId(rid)} />
                  ))}
                </div>
              </div>
            </TableCard>

            <div className="flex items-start gap-2 font-mono text-[11px] text-text-faint">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                This is sample data. Sign up free to run real evaluations against your production traffic.
              </span>
            </div>
          </Board>
        </div>

        {selectedRunId && (
          <RunDetailPanel runId={selectedRunId} onClose={() => setSelectedRunId(null)} />
        )}
      </div>
    </div>
  )
}
