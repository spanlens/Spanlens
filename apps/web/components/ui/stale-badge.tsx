import type * as React from 'react'
import { cn } from '@/lib/utils'
import {
  classifyStaleness,
  type StalenessInput,
} from '@/lib/api-key-staleness'

interface StaleBadgeProps extends StalenessInput {
  className?: string
}

/**
 * Compact badge that surfaces an api_key's idleness next to its name.
 *
 *   • 30–89d idle  →  "Stale"             (neutral)
 *   • 90+d idle    →  "Consider revoking" (accent)
 *   • <30d idle    →  no badge (renders null) — callers don't need to
 *                     guard, the absence is the no-op.
 *
 * Renders deterministically given the same props (no `Date.now()` baked
 * in) so SSR/CSR agree as long as the caller passes a stable `now`. The
 * projects page passes `now` only after `mounted` flips true, which keeps
 * first paint deterministic.
 */
export function StaleBadge(props: StaleBadgeProps): React.ReactElement | null {
  const { className, ...input } = props
  const { bucket, daysIdle } = classifyStaleness(input)

  if (bucket === 'fresh' || bucket === 'unknown') return null

  const isRevokeTier = bucket === 'consider_revoking'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-chip px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.04em] shrink-0',
        isRevokeTier
          ? 'border border-accent-border bg-accent-bg text-accent'
          : 'border border-border bg-bg-elev text-text-faint',
        className,
      )}
      title={`Idle ${daysIdle} day${daysIdle === 1 ? '' : 's'}`}
    >
      {isRevokeTier ? 'Consider revoking' : 'Stale'}
    </span>
  )
}
