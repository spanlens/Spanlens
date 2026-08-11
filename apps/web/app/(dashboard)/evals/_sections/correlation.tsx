'use client'
import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { useCorrelation, pearsonR } from '@/lib/queries/use-human-evals'
import type { Evaluator } from '@/lib/queries/use-evals'

// ── Correlation card (LLM judge vs Human) ───────────────────────────────────

function CorrelationCard({ promptName }: { promptName: string }) {
  const correlation = useCorrelation({ promptName })
  const pairs = correlation.data?.pairs ?? []
  // P3-19: prefer the server's agreement statistic (handles Pearson r for
  // numeric scores AND Cohen's κ for CATEGORICAL / BOOLEAN evaluators that
  // the old client-side pearsonR couldn't measure). Falls back to client
  // Pearson when the server didn't return one (e.g. pre-deploy old API).
  const agreement = correlation.data?.agreement ?? null
  const clientR = agreement == null ? pearsonR(pairs) : null
  const metricValue = agreement != null ? agreement.value : clientR
  const metricLabel = agreement?.metric === 'kappa' ? "Cohen's κ" : 'Pearson r'

  if (pairs.length === 0 && agreement == null) return null

  // Scatter plot bounds: 0..1 × 0..1, padded to 120×120
  const W = 120, H = 120, PAD = 6
  const dotX = (judge: number) => PAD + judge * (W - 2 * PAD)
  const dotY = (human: number) => H - PAD - human * (H - 2 * PAD)

  // Capitalised first letter to match the prior 'Strong' / 'Moderate' display.
  const interpretation = agreement
    ? agreement.interpretation.charAt(0).toUpperCase() + agreement.interpretation.slice(1)
    : metricValue == null
      ? '—'
      : Math.abs(metricValue) >= 0.7 ? 'Strong'
      : Math.abs(metricValue) >= 0.4 ? 'Moderate'
      : Math.abs(metricValue) >= 0.2 ? 'Weak'
      : 'None'

  const rColor = metricValue == null
    ? 'text-text-faint'
    : metricValue >= 0.7 ? 'text-good'
    : metricValue >= 0.4 ? 'text-warn'
    : 'text-bad'

  // n for the displayed metric: agreement.n if server-computed, otherwise the
  // numeric pairs count we already have.
  const sampleCount = agreement?.n ?? pairs.length

  return (
    <div className="bg-bg-elev border border-border rounded-[6px] p-4">
      <div className="flex items-start gap-4">
        {/* Scatter plot — only meaningful for numeric pairs. */}
        <svg width={W} height={H} className="shrink-0 bg-bg rounded-[4px] border border-border">
          {/* Diagonal reference line, perfect agreement */}
          <line
            x1={PAD} y1={H - PAD} x2={W - PAD} y2={PAD}
            stroke="var(--border-strong, currentColor)"
            strokeOpacity={0.3}
            strokeDasharray="2 2"
          />
          {pairs.map((p) => (
            <circle
              key={p.requestId}
              cx={dotX(p.judgeScore)}
              cy={dotY(p.humanScore)}
              r={2.5}
              className="fill-text/70"
            />
          ))}
        </svg>

        {/* Metrics */}
        <div className="flex-1 min-w-0 space-y-2">
          <div>
            <p className="font-mono text-[11px] text-text-faint mb-0.5 truncate">
              {promptName}
            </p>
            {/* flex-wrap so the metric label drops below the big number
                instead of overflowing the card on narrow (2-up) widths. */}
            <div className="flex items-baseline flex-wrap gap-x-2 gap-y-0.5">
              <span className={cn('font-mono text-[22px] font-medium', rColor)}>
                {metricValue == null ? '—' : metricValue.toFixed(2)}
              </span>
              <span className="font-mono text-[10.5px] text-text-muted">
                {metricLabel} · {interpretation}
              </span>
            </div>
          </div>
          <div className="font-mono text-[10.5px] text-text-faint">
            {sampleCount} paired sample{sampleCount === 1 ? '' : 's'}
            {sampleCount < 10 && ' (more data → more reliable)'}
          </div>
        </div>
      </div>
      <p className="font-mono text-[10.5px] text-text-faint mt-3 leading-relaxed">
        Dot = one request judged by both. Dashed line = perfect agreement.
        Low values mean your LLM judge disagrees with humans → revise the criterion.
      </p>
    </div>
  )
}

export function CorrelationRow({ evaluators }: { evaluators: Evaluator[] }) {
  // Unique prompt names that have at least one evaluator
  const promptNames = useMemo(() => {
    const set = new Set<string>()
    for (const ev of evaluators) set.add(ev.prompt_name)
    return [...set]
  }, [evaluators])

  if (promptNames.length === 0) return null

  return (
    <div className="px-[22px] py-[14px] border-b border-border">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-3">
        <span>LLM judge vs Human agreement</span>
      </div>
      {/* 2-up only at lg+ (1024px): below that the cards are too narrow for
          the scatter plot + metrics side by side, so go full-width. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {promptNames.map((name) => (
          <CorrelationCard key={name} promptName={name} />
        ))}
      </div>
    </div>
  )
}
