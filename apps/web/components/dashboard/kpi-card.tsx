import { cn } from '@/lib/utils'

/** Inline SVG sparkline path from a values array */
function sparklinePath(values: number[], w: number, h: number, pad = 2): string {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(1, max - min)
  const step = (w - pad * 2) / Math.max(1, values.length - 1)
  return values
    .map((v, i) => {
      const x = pad + i * step
      const y = h - pad - ((v - min) / span) * (h - pad * 2)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

interface KpiCardProps {
  label: string
  value: string
  delta?: string
  deltaVariant?: 'warn' | 'good' | 'neutral'
  sparkValues?: number[]
  linkLabel?: string
  linkHref?: string
  className?: string
}

/**
 * KPI card — micro label + large value + delta + sparkline.
 * Used in the dashboard KPI row.
 */
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
  const W = 220
  const H = 26
  const strokeColor =
    deltaVariant === 'warn' ? 'var(--accent)'
    : deltaVariant === 'good' ? 'var(--good)'
    : 'var(--border-strong)'

  const path = sparkValues && sparkValues.length > 1 ? sparklinePath(sparkValues, W, H) : null

  return (
    <div className={cn('flex flex-col p-[18px] border-r border-border last:border-r-0', className)}>
      <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2.5">
        {label}
      </div>

      <div className="flex items-baseline gap-2.5 mb-2">
        <span className="text-[30px] font-medium tracking-[-0.8px] text-text leading-none">
          {value}
        </span>
        {delta && (
          <span
            className={cn(
              'font-mono text-[11.5px]',
              deltaVariant === 'warn' && 'text-accent',
              deltaVariant === 'good' && 'text-good',
              deltaVariant === 'neutral' && 'text-text-faint',
            )}
          >
            {delta}
          </span>
        )}
      </div>

      {path && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block w-full max-w-[220px]">
          <path
            d={path + ` L${W - 2},${H - 2} L2,${H - 2} Z`}
            fill={strokeColor}
            opacity="0.08"
          />
          <path
            d={path}
            stroke={strokeColor}
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}

      {linkLabel && linkHref && (
        <a
          href={linkHref}
          className="font-mono text-[10.5px] text-text-muted mt-2.5 tracking-[0.03em] hover:text-text transition-colors"
        >
          {linkLabel}
        </a>
      )}
    </div>
  )
}
