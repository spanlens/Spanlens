'use client'

import { use, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { StatusPill } from '@/components/ui/primitives'

/** The tints `StatusPill` accepts, read off the primitive itself. */
type TagVariant = NonNullable<React.ComponentProps<typeof StatusPill>['variant']>
import { DEMO_EXPERIMENTS, DEMO_EXPERIMENT_RESULTS } from '@/lib/demo-data'
import type { Experiment, ExperimentResult } from '@/lib/queries/use-experiments'
import {
  Board,
  TOPBAR_BLEED,
  SummaryStrip,
  SummaryCell,
  TableCard,
  TableHead,
  Th,
  ROW,
  Well,
} from '../../../(dashboard)/_board/surfaces'

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return '—'
  return n >= 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(5)}`
}
function fmtScore(n: number | null | undefined): string {
  return n == null ? '—' : (n * 100).toFixed(1)
}
function fmtMs(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1000) return `${(n / 1000).toFixed(2)}s`
  return `${Math.round(n)}ms`
}

/* Run state → the ink the STATUS cell carries. */
const STATUS_INK: Record<Experiment['status'], string> = {
  running:   'text-warn',
  completed: 'text-good',
  failed:    'text-bad',
  pending:   'text-text-muted',
}

/* Shared column template so the header band and the rows stay locked. */
const RESULT_GRID: CSSProperties = {
  gridTemplateColumns: '56px minmax(220px,1fr) 92px 92px 92px 150px 20px',
}

/*
 * Winner verdict for one graded pair. A bare "A"/"B" is neutral; when both
 * sides land under the 0.60 quality floor the verdict is qualified on a warn
 * tint so a win between two poor answers does not read as a success.
 */
function winnerTag(
  a: number | null,
  b: number | null,
): { label: string; variant: TagVariant } | null {
  if (a == null || b == null) return null
  if (a === b) return { label: 'Tie', variant: 'neutral' }
  const side = b > a ? 'B' : 'A'
  const bothWeak = a < 0.6 && b < 0.6
  return bothWeak
    ? { label: `${side}, both weak`, variant: 'warn' }
    : { label: side, variant: 'neutral' }
}

function p95(values: Array<number | null>): number | null {
  const xs = values.filter((v): v is number => v != null).sort((x, y) => x - y)
  if (xs.length === 0) return null
  return xs[Math.max(0, Math.ceil(xs.length * 0.95) - 1)] ?? null
}

function mean(values: Array<number | null>): number | null {
  const xs = values.filter((v): v is number => v != null)
  if (xs.length === 0) return null
  return xs.reduce((s, v) => s + v, 0) / xs.length
}

function diffHighlight(a: string, b: string): {
  aTokens: Array<{ t: string; cls: string }>
  bTokens: Array<{ t: string; cls: string }>
} {
  const aw = a.split(/(\s+)/)
  const bw = b.split(/(\s+)/)
  const aSet = new Set(aw)
  const bSet = new Set(bw)
  return {
    aTokens: aw.map((t) => ({ t, cls: bSet.has(t) ? '' : 'bg-bad-bg text-bad' })),
    bTokens: bw.map((t) => ({ t, cls: aSet.has(t) ? '' : 'bg-good-bg text-good' })),
  }
}

// ── Variant card ─────────────────────────────────────────────────────────────

interface VariantCardProps {
  side: 'A' | 'B'
  model: string
  score: number | null
  avgCost: number | null
  p95Ms: number | null
  /** Fraction of the dataset graded so far, 0..1. Shared by both cards. */
  progress: number
  graded: number
  total: number
  /** This side is ahead on average score — it gets the accent figure and fill. */
  leading: boolean
}

function VariantCard({ side, model, score, avgCost, p95Ms, progress, graded, total, leading }: VariantCardProps) {
  return (
    <Card className="flex flex-col gap-3.5 px-5 py-[18px]">
      <div className="text-[13.5px] font-semibold leading-[1.4] text-text">
        Variant {side} · {model}
      </div>
      {/* `leading` is forced because `.font-display` carries the 112% display
          line height, which is too airy for a single-line figure. */}
      <div
        className={cn(
          'font-display text-[32px] tracking-[-0.025em] leading-[1.05]! tabular-nums',
          leading ? 'text-accent' : 'text-text',
        )}
      >
        {fmtScore(score)}
      </div>
      <div className="flex gap-[22px]">
        <div className="flex flex-col gap-[3px]">
          <span className="font-mono text-[10.5px] leading-[1.45] tracking-[0.08em] text-text-faint">avg cost</span>
          <span className="font-mono text-[12px] leading-[1.45] tabular-nums text-text-muted">{fmtUsd(avgCost)}</span>
        </div>
        <div className="flex flex-col gap-[3px]">
          <span className="font-mono text-[10.5px] leading-[1.45] tracking-[0.08em] text-text-faint">p95</span>
          <span className="font-mono text-[12px] leading-[1.45] tabular-nums text-text-muted">{fmtMs(p95Ms)}</span>
        </div>
      </div>
      <div className="mt-auto flex flex-col gap-2.5">
        {/* Both meters carry the same run progress; only the fill colour
            differs, so the leading variant is readable at a glance. */}
        <div
          className="h-1.5 overflow-hidden rounded-full bg-track"
          role="progressbar"
          aria-label={`Variant ${side} grading progress`}
          aria-valuenow={graded}
          aria-valuemin={0}
          aria-valuemax={total}
        >
          <div
            className={cn('h-full rounded-full', leading ? 'bg-accent' : 'bg-text-muted')}
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
        <div className="font-mono text-[11px] leading-[1.45] text-text-faint">
          {graded} of {total} items graded
        </div>
      </div>
    </Card>
  )
}

// ── Result row ───────────────────────────────────────────────────────────────

function ResultRow({ result, idx }: { result: ExperimentResult; idx: number }) {
  const [expanded, setExpanded] = useState(false)
  const inputPreview = useMemo(() => {
    const input = result.dataset_items?.input
    if (!input) return `Item ${idx + 1}`
    if (input.messages?.[0]?.content) return input.messages[0].content
    if (input.variables) return JSON.stringify(input.variables)
    return `Item ${idx + 1}`
  }, [result, idx])

  const { aTokens, bTokens } = useMemo(
    () => diffHighlight(result.output_a ?? '', result.output_b ?? ''),
    [result.output_a, result.output_b],
  )

  const scoreDelta = result.score_a != null && result.score_b != null ? result.score_b - result.score_a : null
  const winner = winnerTag(result.score_a, result.score_b)

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={cn(
          ROW,
          'grid w-full items-center gap-3 border-b-0 text-left font-mono text-[12px] leading-[1.45] transition-colors hover:bg-bg-muted',
        )}
        style={RESULT_GRID}
      >
        <span className="text-text">{String(idx + 1).padStart(3, '0')}</span>
        <span className="truncate font-sans text-text-muted">{inputPreview}</span>
        <span className="tabular-nums text-text-muted">{fmtScore(result.score_a)}</span>
        <span className="tabular-nums text-text-muted">{fmtScore(result.score_b)}</span>
        <span className={cn(
          'tabular-nums',
          scoreDelta == null ? 'text-text-faint' : scoreDelta > 0 ? 'text-good' : scoreDelta < 0 ? 'text-bad' : 'text-text-muted',
        )}>
          {scoreDelta == null ? '—' : (scoreDelta > 0 ? '+' : '') + (scoreDelta * 100).toFixed(1)}
        </span>
        <span>{winner ? <StatusPill variant={winner.variant}>{winner.label}</StatusPill> : null}</span>
        <span className="text-text-faint">
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
      </button>

      {expanded && (
        <div className="grid grid-cols-1 gap-3 border-t border-border bg-bg-muted px-[18px] py-3.5 md:grid-cols-2">
          <Well className="min-w-0 bg-bg-elev">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="micro-label tracking-[0.1em]">Output A</p>
              <span className="font-mono text-[10px] text-text-faint">
                {fmtUsd(result.cost_a_usd)} · {fmtMs(result.latency_a_ms)} · {result.tokens_a}t
              </span>
            </div>
            <p className="whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.6] text-text">
              {aTokens.map((token, i) => <span key={i} className={token.cls}>{token.t}</span>)}
            </p>
            {result.reasoning_a && (
              <p className="mt-2 border-t border-border pt-2 font-mono text-[10.5px] text-text-faint">
                Judge: {result.reasoning_a}
              </p>
            )}
          </Well>
          <Well className="min-w-0 bg-bg-elev">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="micro-label tracking-[0.1em]">Output B</p>
              <span className="font-mono text-[10px] text-text-faint">
                {fmtUsd(result.cost_b_usd)} · {fmtMs(result.latency_b_ms)} · {result.tokens_b}t
              </span>
            </div>
            <p className="whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.6] text-text">
              {bTokens.map((token, i) => <span key={i} className={token.cls}>{token.t}</span>)}
            </p>
            {result.reasoning_b && (
              <p className="mt-2 border-t border-border pt-2 font-mono text-[10.5px] text-text-faint">
                Judge: {result.reasoning_b}
              </p>
            )}
          </Well>
        </div>
      )}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DemoExperimentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const exp = DEMO_EXPERIMENTS.find((e) => e.id === id)
  // Memoised so the `??` fallback does not hand a fresh array to the rollup
  // below on every render.
  const results = useMemo(() => DEMO_EXPERIMENT_RESULTS[id] ?? [], [id])

  // Per-variant cost and latency are not on the experiment row, so they are
  // rolled up from the per-item results the table already renders.
  const perVariant = useMemo(() => ({
    costA: mean(results.map((r) => r.cost_a_usd ?? null)),
    costB: mean(results.map((r) => r.cost_b_usd ?? null)),
    p95A: p95(results.map((r) => r.latency_a_ms)),
    p95B: p95(results.map((r) => r.latency_b_ms)),
  }), [results])

  if (!exp) {
    return (
      <div>
        <div className={TOPBAR_BLEED}>
          <Topbar crumbs={[{ label: 'Demo', href: '/demo/dashboard' }, { label: 'Experiments', href: '/demo/experiments' }, { label: 'Not found' }]} />
        </div>
        <div className="flex h-64 items-center justify-center text-[13px] text-text-muted">
          Experiment not found.{' '}
          <Link href="/demo/experiments" className="ml-2 text-accent underline underline-offset-2">Back to list</Link>
        </div>
      </div>
    )
  }

  const progress = exp.total_items > 0 ? Math.min(1, exp.completed_items / exp.total_items) : 0
  // A tie leaves neither card in the accent, which is the honest reading.
  const leadA = exp.avg_score_a != null && exp.avg_score_b != null && exp.avg_score_a > exp.avg_score_b
  const leadB = exp.avg_score_a != null && exp.avg_score_b != null && exp.avg_score_b > exp.avg_score_a

  return (
    <div>
      <div className={TOPBAR_BLEED}>
        <Topbar
          crumbs={[
            { label: 'Demo', href: '/demo/dashboard' },
            { label: 'Experiments', href: '/demo/experiments' },
            { label: exp.name },
          ]}
        />
        {/* The name already reads in the breadcrumb, so the heading is for
            assistive tech only rather than a repeated visible title. */}
        <h1 className="sr-only">{exp.name}</h1>
      </div>

      <Board>
        <SummaryStrip>
          <SummaryCell label="Prompt">{exp.prompt_name}</SummaryCell>
          <SummaryCell label="Model">{exp.run_model}</SummaryCell>
          <SummaryCell label="Items">{exp.total_items}</SummaryCell>
          <SummaryCell label="Graded">{exp.completed_items}</SummaryCell>
          <SummaryCell label="Spend">{fmtUsd(exp.total_cost_usd)}</SummaryCell>
          <SummaryCell label="Status">
            <span className={STATUS_INK[exp.status]}>{exp.status}</span>
          </SummaryCell>
        </SummaryStrip>

        {(exp.status === 'pending' || exp.status === 'running') && (
          <div className="flex items-center gap-2 rounded-card border border-accent-border bg-accent-bg px-5 py-3.5 font-mono text-[11.5px] text-accent">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Running… {exp.completed_items}/{exp.total_items} items completed
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <VariantCard
            side="A"
            model={exp.run_model}
            score={exp.avg_score_a}
            avgCost={perVariant.costA}
            p95Ms={perVariant.p95A}
            progress={progress}
            graded={exp.completed_items}
            total={exp.total_items}
            leading={leadA}
          />
          <VariantCard
            side="B"
            model={exp.run_model}
            score={exp.avg_score_b}
            avgCost={perVariant.costB}
            p95Ms={perVariant.p95B}
            progress={progress}
            graded={exp.completed_items}
            total={exp.total_items}
            leading={leadB}
          />
        </div>

        {results.length > 0 && (
          /* Wider than a narrow viewport, so the card scrolls its own table
             sideways rather than the page. */
          <TableCard>
            <div className="overflow-x-auto">
              <div className="min-w-[820px]">
                <TableHead>
                  <div className="grid items-center gap-3" style={RESULT_GRID}>
                    <Th>#</Th>
                    <Th>Input</Th>
                    <Th>A score</Th>
                    <Th>B score</Th>
                    <Th>Delta</Th>
                    <Th>Winner</Th>
                    <Th><span className="sr-only">Expand</span></Th>
                  </div>
                </TableHead>
                {results.map((r, i) => <ResultRow key={r.id} result={r} idx={i} />)}
              </div>
            </div>
          </TableCard>
        )}
      </Board>
    </div>
  )
}
