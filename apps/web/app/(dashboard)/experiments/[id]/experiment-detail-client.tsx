'use client'

import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { Loader2, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { StatusPill } from '@/components/ui/primitives'

/** The tints `StatusPill` accepts, read off the primitive itself. */
type TagVariant = NonNullable<React.ComponentProps<typeof StatusPill>['variant']>
import {
  useExperiment,
  useExperimentResults,
  type Experiment,
  type ExperimentResult,
} from '@/lib/queries/use-experiments'
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
} from '../../_board/surfaces'

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return '—'
  return n >= 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(5)}`
}

function fmtScore(n: number | null | undefined): string {
  if (n == null) return '—'
  return (n * 100).toFixed(1)
}

function fmtMs(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1000) return `${(n / 1000).toFixed(2)}s`
  return `${Math.round(n)}ms`
}

/* Run state → the ink the STATUS cell and the running banner share. */
const STATUS_INK: Record<Experiment['status'], string> = {
  running:   'text-warn',
  completed: 'text-good',
  failed:    'text-bad',
  pending:   'text-text-muted',
}

/*
 * Column template for the per-item table on `D23 · Experiment detail`. The
 * header band and the rows both read it so the two stay locked together;
 * Tailwind's JIT is unreliable with arbitrary `grid-cols-[…]` values.
 */
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

/** p95 over the non-null latencies of one side. */
function p95(values: Array<number | null>): number | null {
  const xs = values.filter((v): v is number => v != null).sort((x, y) => x - y)
  if (xs.length === 0) return null
  return xs[Math.max(0, Math.ceil(xs.length * 0.95) - 1)] ?? null
}

/** Mean over the non-null values of one side. */
function mean(values: Array<number | null>): number | null {
  const xs = values.filter((v): v is number => v != null)
  if (xs.length === 0) return null
  return xs.reduce((s, v) => s + v, 0) / xs.length
}

// Lightweight word-level diff highlighter for two strings.
function diffHighlight(a: string, b: string): { aTokens: Array<{ t: string; cls: string }>; bTokens: Array<{ t: string; cls: string }> } {
  const aw = a.split(/(\s+)/)
  const bw = b.split(/(\s+)/)
  const aSet = new Set(aw)
  const bSet = new Set(bw)
  const aTokens = aw.map((t) => ({
    t,
    cls: bSet.has(t) ? '' : 'bg-bad-bg text-bad',
  }))
  const bTokens = bw.map((t) => ({
    t,
    cls: aSet.has(t) ? '' : 'bg-good-bg text-good',
  }))
  return { aTokens, bTokens }
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

// ── Result row (collapsible side-by-side) ────────────────────────────────────

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

  const scoreDelta = result.score_a != null && result.score_b != null
    ? result.score_b - result.score_a
    : null
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
        <div className="flex flex-col gap-3 border-t border-border bg-bg-muted px-[18px] py-3.5">
          <div className="flex flex-col gap-1.5">
            <p className="micro-label tracking-[0.1em]">Input</p>
            <Well>
              <pre className="whitespace-pre-wrap break-all font-mono text-[11.5px] leading-[1.6] text-text-muted">
                {JSON.stringify(result.dataset_items?.input ?? {}, null, 2)}
              </pre>
            </Well>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Well className="min-w-0 bg-bg-elev">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="micro-label tracking-[0.1em]">Output A</p>
                <span className="font-mono text-[10px] text-text-faint">
                  {fmtUsd(result.cost_a_usd)} · {fmtMs(result.latency_a_ms)} · {result.tokens_a}t
                </span>
              </div>
              {result.error_a ? (
                <div className="flex items-start gap-1.5 font-mono text-[11px] text-bad">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{result.error_a}</span>
                </div>
              ) : (
                <p className="whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.6] text-text">
                  {aTokens.map((token, i) => (
                    <span key={i} className={token.cls}>{token.t}</span>
                  ))}
                </p>
              )}
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
              {result.error_b ? (
                <div className="flex items-start gap-1.5 font-mono text-[11px] text-bad">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{result.error_b}</span>
                </div>
              ) : (
                <p className="whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.6] text-text">
                  {bTokens.map((token, i) => (
                    <span key={i} className={token.cls}>{token.t}</span>
                  ))}
                </p>
              )}
              {result.reasoning_b && (
                <p className="mt-2 border-t border-border pt-2 font-mono text-[10.5px] text-text-faint">
                  Judge: {result.reasoning_b}
                </p>
              )}
            </Well>
          </div>

          {result.dataset_items?.expected_output && (
            <div className="flex flex-col gap-1.5">
              <p className="micro-label tracking-[0.1em]">Expected output (from dataset)</p>
              <Well className="bg-bg-elev">
                <p className="whitespace-pre-wrap font-mono text-[11.5px] leading-[1.6] text-text-muted">
                  {result.dataset_items.expected_output}
                </p>
              </Well>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export function ExperimentDetailClient({ experimentId }: { experimentId: string }) {
  const exp = useExperiment(experimentId, { pollWhilePending: true })
  const results = useExperimentResults(
    exp.data?.status === 'completed' ? experimentId : null,
  )

  // Per-variant cost and latency are not on the experiment row, so they are
  // rolled up from the results the table already fetched. Null until the run
  // completes and the results land.
  const rows = results.data
  const perVariant = useMemo(() => {
    const list = rows ?? []
    return {
      costA: mean(list.map((r) => r.cost_a_usd ?? null)),
      costB: mean(list.map((r) => r.cost_b_usd ?? null)),
      p95A: p95(list.map((r) => r.latency_a_ms)),
      p95B: p95(list.map((r) => r.latency_b_ms)),
    }
  }, [rows])

  if (exp.isLoading || !exp.data) {
    return (
      <div>
        <div className={TOPBAR_BLEED}>
          <Topbar crumbs={[{ label: 'Experiments', href: '/experiments' }, { label: '...' }]} />
        </div>
        <div className="flex h-64 items-center justify-center text-text-faint">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      </div>
    )
  }

  const e = exp.data
  const progress = e.total_items > 0 ? Math.min(1, e.completed_items / e.total_items) : 0
  // A tie leaves neither card in the accent, which is the honest reading.
  const leadA = e.avg_score_a != null && e.avg_score_b != null && e.avg_score_a > e.avg_score_b
  const leadB = e.avg_score_a != null && e.avg_score_b != null && e.avg_score_b > e.avg_score_a

  return (
    <div>
      <div className={TOPBAR_BLEED}>
        <Topbar
          crumbs={[
            { label: 'Experiments', href: '/experiments' },
            { label: e.name },
          ]}
        />
        {/* The name already reads in the breadcrumb, so the heading is for
            assistive tech only rather than a repeated visible title. */}
        <h1 className="sr-only">{e.name}</h1>
      </div>

      <Board>
        {/* Summary strip — one card whose cells are divided by hairlines. */}
        <SummaryStrip>
          <SummaryCell label="Prompt">{e.prompt_name}</SummaryCell>
          <SummaryCell label="Model">{e.run_model}</SummaryCell>
          <SummaryCell label="Items">{e.total_items}</SummaryCell>
          <SummaryCell label="Graded">{e.completed_items}</SummaryCell>
          <SummaryCell label="Spend">{fmtUsd(e.total_cost_usd)}</SummaryCell>
          <SummaryCell label="Status">
            <span className={STATUS_INK[e.status]}>{e.status}</span>
          </SummaryCell>
        </SummaryStrip>

        {/* Running banner */}
        {(e.status === 'pending' || e.status === 'running') && (
          <div className="flex items-center gap-2 rounded-card border border-accent-border bg-accent-bg px-5 py-3.5 font-mono text-[11.5px] text-accent">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Running… {e.completed_items}/{e.total_items} items completed
          </div>
        )}

        {/* Error banner */}
        {e.status === 'failed' && e.error && (
          <div className="flex items-start gap-2 rounded-card border border-bad/30 bg-bad-bg px-5 py-3.5 font-mono text-[11.5px] text-bad">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{e.error}</span>
          </div>
        )}

        {/* Compare row */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <VariantCard
            side="A"
            model={e.run_model}
            score={e.avg_score_a}
            avgCost={perVariant.costA}
            p95Ms={perVariant.p95A}
            progress={progress}
            graded={e.completed_items}
            total={e.total_items}
            leading={leadA}
          />
          <VariantCard
            side="B"
            model={e.run_model}
            score={e.avg_score_b}
            avgCost={perVariant.costB}
            p95Ms={perVariant.p95B}
            progress={progress}
            graded={e.completed_items}
            total={e.total_items}
            leading={leadB}
          />
        </div>

        {/* Per-item results. The row grid is wider than a narrow viewport, so
            the card scrolls its own table sideways rather than the page. */}
        {e.status === 'completed' && rows && rows.length > 0 && (
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
                {rows.map((r, i) => <ResultRow key={r.id} result={r} idx={i} />)}
              </div>
            </div>
          </TableCard>
        )}
      </Board>
    </div>
  )
}
