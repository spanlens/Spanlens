'use client'

import { useMemo, useState } from 'react'
import { Loader2, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { cn } from '@/lib/utils'
import {
  useExperiment,
  useExperimentResults,
  type ExperimentResult,
} from '@/lib/queries/use-experiments'

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

// Lightweight word-level diff highlighter for two strings.
function diffHighlight(a: string, b: string): { aTokens: Array<{ t: string; cls: string }>; bTokens: Array<{ t: string; cls: string }> } {
  const aw = a.split(/(\s+)/)
  const bw = b.split(/(\s+)/)
  const aSet = new Set(aw)
  const bSet = new Set(bw)
  const aTokens = aw.map((t) => ({
    t,
    cls: bSet.has(t) ? '' : 'bg-bad/15 text-bad',
  }))
  const bTokens = bw.map((t) => ({
    t,
    cls: aSet.has(t) ? '' : 'bg-good/15 text-good',
  }))
  return { aTokens, bTokens }
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

  return (
    <div className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center px-[16px] py-[10px] hover:bg-bg-muted transition-colors text-left"
      >
        <span className="font-mono text-[11px] text-text-faint w-[28px]">#{idx + 1}</span>
        <span className="flex-1 font-mono text-[12px] text-text truncate min-w-0">{inputPreview}</span>
        <span className="font-mono text-[11.5px] text-text-muted w-[60px] text-right">
          {fmtScore(result.score_a)}
        </span>
        <span className="font-mono text-[11.5px] text-text-muted w-[60px] text-right">
          {fmtScore(result.score_b)}
        </span>
        <span className={cn(
          'font-mono text-[11.5px] w-[60px] text-right',
          scoreDelta == null ? 'text-text-faint' : scoreDelta > 0 ? 'text-good' : scoreDelta < 0 ? 'text-bad' : 'text-text-muted',
        )}>
          {scoreDelta == null ? '—' : (scoreDelta > 0 ? '+' : '') + (scoreDelta * 100).toFixed(1)}
        </span>
        <span className="ml-3 text-text-faint">
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
      </button>

      {expanded && (
        <div className="bg-bg-muted/50 border-t border-border p-3 space-y-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-1">Input</p>
            <pre className="font-mono text-[11.5px] text-text-muted whitespace-pre-wrap break-all">
              {JSON.stringify(result.dataset_items?.input ?? {}, null, 2)}
            </pre>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-bg rounded-[5px] border border-border p-3 min-w-0">
              <div className="flex items-center justify-between mb-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
                  Output A
                </p>
                <span className="font-mono text-[10px] text-text-faint">
                  {fmtUsd(result.cost_a_usd)} · {fmtMs(result.latency_a_ms)} · {result.tokens_a}t
                </span>
              </div>
              {result.error_a ? (
                <div className="flex items-start gap-1.5 font-mono text-[11px] text-bad">
                  <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                  <span>{result.error_a}</span>
                </div>
              ) : (
                <p className="font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-words">
                  {aTokens.map((token, i) => (
                    <span key={i} className={token.cls}>{token.t}</span>
                  ))}
                </p>
              )}
              {result.reasoning_a && (
                <p className="font-mono text-[10.5px] text-text-faint mt-2 pt-2 border-t border-border">
                  Judge: {result.reasoning_a}
                </p>
              )}
            </div>

            <div className="bg-bg rounded-[5px] border border-border p-3 min-w-0">
              <div className="flex items-center justify-between mb-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
                  Output B
                </p>
                <span className="font-mono text-[10px] text-text-faint">
                  {fmtUsd(result.cost_b_usd)} · {fmtMs(result.latency_b_ms)} · {result.tokens_b}t
                </span>
              </div>
              {result.error_b ? (
                <div className="flex items-start gap-1.5 font-mono text-[11px] text-bad">
                  <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                  <span>{result.error_b}</span>
                </div>
              ) : (
                <p className="font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-words">
                  {bTokens.map((token, i) => (
                    <span key={i} className={token.cls}>{token.t}</span>
                  ))}
                </p>
              )}
              {result.reasoning_b && (
                <p className="font-mono text-[10.5px] text-text-faint mt-2 pt-2 border-t border-border">
                  Judge: {result.reasoning_b}
                </p>
              )}
            </div>
          </div>

          {result.dataset_items?.expected_output && (
            <div className="bg-bg-elev rounded-[5px] border border-border p-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-1">
                Expected output (from dataset)
              </p>
              <p className="font-mono text-[11.5px] text-text-muted whitespace-pre-wrap">
                {result.dataset_items.expected_output}
              </p>
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

  if (exp.isLoading || !exp.data) {
    return (
      <div className="flex flex-col h-full">
        <Topbar crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Experiments', href: '/experiments' }, { label: '...' }]} />
        <div className="flex items-center justify-center h-64 text-text-faint">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      </div>
    )
  }

  const e = exp.data
  const delta = e.avg_score_a != null && e.avg_score_b != null
    ? e.avg_score_b - e.avg_score_a
    : null

  return (
    <div className="flex flex-col h-full">
      <Topbar
        crumbs={[
          { label: 'Workspace', href: '/dashboard' },
          { label: 'Experiments', href: '/experiments' },
          { label: e.name },
        ]}
      />

      <div className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="px-[22px] py-[14px] border-b border-border">
          <p className="font-mono text-[15px] text-text font-medium">{e.name}</p>
          <p className="font-mono text-[11.5px] text-text-faint mt-0.5">
            {e.prompt_name} · {e.run_model}
          </p>
        </div>

        {/* Running banner */}
        {(e.status === 'pending' || e.status === 'running') && (
          <div className="mx-[22px] mt-3 p-3 bg-accent-bg border border-accent-border rounded-[5px] font-mono text-[11.5px] text-accent flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Running… {e.completed_items}/{e.total_items} items completed
          </div>
        )}

        {/* Error banner */}
        {e.status === 'failed' && e.error && (
          <div className="mx-[22px] mt-3 p-3 bg-bad/10 border border-bad/30 rounded-[5px] font-mono text-[11.5px] text-bad flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{e.error}</span>
          </div>
        )}

        {/* KPIs */}
        {e.status === 'completed' && (
          <div className="grid grid-cols-4 gap-3 px-[22px] py-[14px] border-b border-border">
            <div className="bg-bg-muted border border-border rounded-[5px] px-3 py-2.5">
              <p className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-text-faint mb-1">Avg score A</p>
              <p className="font-mono text-[18px] text-text font-medium">{fmtScore(e.avg_score_a)}</p>
            </div>
            <div className="bg-bg-muted border border-border rounded-[5px] px-3 py-2.5">
              <p className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-text-faint mb-1">Avg score B</p>
              <p className="font-mono text-[18px] text-text font-medium">{fmtScore(e.avg_score_b)}</p>
            </div>
            <div className="bg-bg-muted border border-border rounded-[5px] px-3 py-2.5">
              <p className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-text-faint mb-1">Δ (B − A)</p>
              <p className={cn(
                'font-mono text-[18px] font-medium',
                delta == null ? 'text-text-faint' : delta > 0 ? 'text-good' : delta < 0 ? 'text-bad' : 'text-text',
              )}>
                {delta == null ? '—' : (delta > 0 ? '+' : '') + (delta * 100).toFixed(1)}
              </p>
            </div>
            <div className="bg-bg-muted border border-border rounded-[5px] px-3 py-2.5">
              <p className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-text-faint mb-1">Total cost</p>
              <p className="font-mono text-[18px] text-text font-medium">{fmtUsd(e.total_cost_usd)}</p>
            </div>
          </div>
        )}

        {/* Results */}
        {e.status === 'completed' && results.data && results.data.length > 0 && (
          <>
            <div className="flex items-center px-[16px] py-[8px] bg-bg-muted border-b border-border font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
              <span className="w-[28px]" />
              <span className="flex-1">Input</span>
              <span className="w-[60px] text-right">A</span>
              <span className="w-[60px] text-right">B</span>
              <span className="w-[60px] text-right">Δ</span>
              <span className="w-[16px] ml-3" />
            </div>
            {results.data.map((r, i) => <ResultRow key={r.id} result={r} idx={i} />)}
          </>
        )}
      </div>
    </div>
  )
}
