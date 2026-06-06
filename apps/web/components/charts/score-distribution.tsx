'use client'

/**
 * Type-aware compact distribution charts for human-eval scores.
 *
 * Each component takes a flat list of typed values (categorical strings,
 * booleans, or numbers) and renders a single-row visualisation suitable
 * for the annotation page's stat strip and the upcoming evaluator-results
 * detail view.
 *
 * No recharts dependency — these are static HTML bars driven by CSS
 * widths. The rendering cost is negligible (≤10 nodes per chart) and the
 * bundle stays small. If we later need real interactivity (hover
 * tooltips, drilldowns) we can switch to recharts behind the same
 * component API.
 */

import { cn } from '@/lib/utils'

interface CategoricalDistributionProps {
  /** Allowed categories in the order they should be drawn. */
  categories: string[]
  /** Flat list of saved string values. Unknown categories are ignored. */
  values: Array<string | null | undefined>
  className?: string
}

export function CategoricalDistribution({
  categories,
  values,
  className,
}: CategoricalDistributionProps) {
  if (categories.length === 0) return null

  // Build the counts map up front so unused categories still render at 0%.
  const counts = new Map<string, number>()
  for (const cat of categories) counts.set(cat, 0)
  let total = 0
  for (const v of values) {
    if (!v) continue
    if (!counts.has(v)) continue
    counts.set(v, (counts.get(v) ?? 0) + 1)
    total += 1
  }

  if (total === 0) {
    return (
      <p className={cn('font-mono text-[11px] text-text-faint', className)}>
        No ratings captured yet.
      </p>
    )
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      {categories.map((cat) => {
        const count = counts.get(cat) ?? 0
        const pct = total > 0 ? (count / total) * 100 : 0
        return (
          <div key={cat} className="grid grid-cols-[120px_1fr_64px] items-center gap-2">
            <div className="font-mono text-[11.5px] text-text-muted truncate">{cat}</div>
            <div className="h-2 rounded-[3px] bg-bg-elev overflow-hidden">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${pct}%` }}
                aria-label={`${count} ratings, ${pct.toFixed(0)}%`}
              />
            </div>
            <div className="font-mono text-[10.5px] text-text-faint text-right tabular-nums">
              {count} · {pct.toFixed(0)}%
            </div>
          </div>
        )
      })}
    </div>
  )
}

interface BoolPassRateProps {
  values: Array<boolean | null | undefined>
  /** Optional workspace-configured labels. Default to Pass/Fail. */
  trueLabel?: string
  falseLabel?: string
  className?: string
}

export function BoolPassRate({
  values,
  trueLabel = 'Pass',
  falseLabel = 'Fail',
  className,
}: BoolPassRateProps) {
  let pass = 0
  let fail = 0
  for (const v of values) {
    if (v === true) pass += 1
    else if (v === false) fail += 1
  }
  const total = pass + fail
  if (total === 0) {
    return (
      <p className={cn('font-mono text-[11px] text-text-faint', className)}>
        No ratings captured yet.
      </p>
    )
  }
  const passPct = (pass / total) * 100

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between font-mono text-[11.5px]">
        <span className="text-good">{trueLabel}: {pass} · {passPct.toFixed(0)}%</span>
        <span className="text-bad">{falseLabel}: {fail} · {(100 - passPct).toFixed(0)}%</span>
      </div>
      {/* Single horizontal bar split between the two outcomes. The split
          point itself is the readout. */}
      <div className="h-2 rounded-[3px] bg-bg-elev overflow-hidden flex">
        <div className="h-full bg-good" style={{ width: `${passPct}%` }} />
        <div className="h-full bg-bad" style={{ width: `${100 - passPct}%` }} />
      </div>
    </div>
  )
}

interface NumericHistogramProps {
  /** Saved numeric values; ignored when null/undefined/NaN. */
  values: Array<number | null | undefined>
  /** Number of buckets. Defaults to 5 (matches the 1..5 stars layout). */
  buckets?: number
  /** Optional bounds. Falls back to min/max of the data. */
  min?: number
  max?: number
  className?: string
}

/**
 * Equal-width histogram for NUMERIC scores. Five buckets by default so
 * the result looks natural for the legacy 0..1 / 1..5 stars layout.
 */
export function NumericHistogram({
  values,
  buckets = 5,
  min,
  max,
  className,
}: NumericHistogramProps) {
  const cleaned = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (cleaned.length === 0) {
    return (
      <p className={cn('font-mono text-[11px] text-text-faint', className)}>
        No ratings captured yet.
      </p>
    )
  }

  const actualMin = min ?? Math.min(...cleaned)
  const actualMax = max ?? Math.max(...cleaned)
  const range = actualMax - actualMin || 1
  const bucketSize = range / buckets

  const counts = new Array(buckets).fill(0) as number[]
  for (const v of cleaned) {
    const idx = Math.min(buckets - 1, Math.floor((v - actualMin) / bucketSize))
    counts[idx] = (counts[idx] ?? 0) + 1
  }
  const total = cleaned.length
  const maxCount = Math.max(...counts, 1)

  return (
    <div className={cn('space-y-1.5', className)}>
      {counts.map((c, i) => {
        const lo = actualMin + i * bucketSize
        const hi = i === buckets - 1 ? actualMax : actualMin + (i + 1) * bucketSize
        const pct = (c / maxCount) * 100
        const sharePct = total > 0 ? (c / total) * 100 : 0
        return (
          <div key={i} className="grid grid-cols-[120px_1fr_64px] items-center gap-2">
            <div className="font-mono text-[11.5px] text-text-muted truncate">
              {lo.toFixed(2)} – {hi.toFixed(2)}
            </div>
            <div className="h-2 rounded-[3px] bg-bg-elev overflow-hidden">
              <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
            </div>
            <div className="font-mono text-[10.5px] text-text-faint text-right tabular-nums">
              {c} · {sharePct.toFixed(0)}%
            </div>
          </div>
        )
      })}
    </div>
  )
}
