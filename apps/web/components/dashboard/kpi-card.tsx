import Link from 'next/link'
import { cn } from '@/lib/utils'
import { linkPrefetchFor } from '@/lib/heavy-pages'

const VW = 100
const VH = 44

function sparklinePath(values: number[]): string {
  const pad = 2
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(1, max - min)
  const step = (VW - pad * 2) / Math.max(1, values.length - 1)
  return values
    .map((v, i) => {
      const x = pad + i * step
      const y = VH - pad - ((v - min) / span) * (VH - pad * 2)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

interface KpiCardProps {
  label: string
  value: string
  delta?: string | undefined
  deltaVariant?: 'warn' | 'good' | 'neutral' | undefined
  sparkValues?: number[]
  linkLabel?: string
  linkHref?: string
  className?: string
}

export function KpiCard({
  label,
  value,
  delta,
  deltaVariant = 'neutral',
  sparkValues,
  linkLabel,
  linkHref,
  className,
}: KpiCardProps) {
  // The delta variant drives the sparkline too, so the tile reads as one
  // statement. `warn` means the number moved the wrong way, which is a status,
  // not an accent event — the accent belongs to the mark a reader is asked to
  // track, and every KPI tile lighting up orange would spend it on nothing.
  const strokeColor =
    deltaVariant === 'warn' ? 'var(--bad)'
    : deltaVariant === 'good' ? 'var(--good)'
    : 'var(--text-faint)'

  const path = sparkValues && sparkValues.length > 1 ? sparklinePath(sparkValues) : null

  return (
    <div className={cn('flex flex-col p-[18px]', className)}>
      <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-faint mb-2.5">
        {label}
      </div>

      <div className="flex items-baseline gap-2.5 mb-3">
        {/* Display face for the figure. It is the one number on the tile, and
            the tight KPI tracking is what separates it from body copy. */}
        {/* `leading` is forced because the `.font-display` utility carries the
            112% display line height, which is too airy for a one-line figure. */}
        <span className="font-display text-[28px] track-kpi leading-[1.05]! text-text">
          {value}
        </span>
        {delta && (
          <span
            className={cn(
              'text-[11.5px] font-medium',
              deltaVariant === 'warn' && 'text-bad',
              deltaVariant === 'good' && 'text-good',
              deltaVariant === 'neutral' && 'text-text-faint',
            )}
          >
            {delta}
          </span>
        )}
      </div>

      {/* Sparkline, fills full card width, fixed 44px tall */}
      <div className="w-full" style={{ height: VH }}>
        {path ? (
          <svg
            width="100%"
            height={VH}
            viewBox={`0 0 ${VW} ${VH}`}
            preserveAspectRatio="none"
            className="block"
          >
            <path
              d={path}
              stroke={strokeColor}
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ) : (
          <div className="w-full h-full border-b border-dashed border-border" />
        )}
      </div>

      {linkLabel && linkHref && (
        <Link
          href={linkHref}
          prefetch={linkPrefetchFor(linkHref)}
          className="font-mono text-[10.5px] text-text-muted mt-2.5 tracking-[0.03em] hover:text-text transition-colors"
        >
          {linkLabel}
        </Link>
      )}
    </div>
  )
}
