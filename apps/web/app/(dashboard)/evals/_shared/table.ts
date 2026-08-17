import type { CSSProperties } from 'react'
import type { EvalRunStatus } from '@/lib/queries/use-evals'

/** The variants `StatusPill` in `components/ui/primitives` accepts. */
type PillVariant = 'good' | 'bad' | 'warn' | 'neutral'

/*
 * Column template for the evaluator table on `D10 · Evals`. The header band
 * and the rows both read it so the two stay locked together; Tailwind's JIT
 * is unreliable with arbitrary multi-column `grid-cols-[…]` values, so it is
 * applied as a style.
 */
export const EVAL_GRID: CSSProperties = {
  gridTemplateColumns: 'minmax(140px,1fr) 150px 150px 64px 92px 92px 104px 96px',
}

/* Run status → chip colour. `running` is warn rather than accent because that
   is the tint the boards use for an in-flight run (D11, D12). */
export function runTagVariant(status: EvalRunStatus): PillVariant {
  if (status === 'completed') return 'good'
  if (status === 'failed') return 'bad'
  if (status === 'running') return 'warn'
  return 'neutral'
}

/** Compact "2h ago" age, matching the LAST RUN column on the boards. */
export function relAge(dateStr: string): string {
  const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
