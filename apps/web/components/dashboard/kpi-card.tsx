import Link from 'next/link'
import { cn } from '@/lib/utils'

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
  const strokeColor =
    deltaVariant === 'warn' ? 'var(--accent)'
    : deltaVariant === 'good' ? 'var(--good)'
    : 'var(--text-faint)'

  const path = sparkValues && sparkValues.length > 1 ? sparklinePath(sparkValues) : null

  return (
    <div className={cn('flex flex-col p-[18px]', className)}>
      <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2.5">
        {label}
      </div>

      <div className="flex items-baseline gap-2.5 mb-3">
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

      {/* Sparkline — fills full card width, fixed 44px tall */}
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
          className="font-mono text-[10.5px] text-text-muted mt-2.5 tracking-[0.03em] hover:text-text transition-colors"
        >
          {linkLabel}
        </Link>
      )}
    </div>
  )
}
