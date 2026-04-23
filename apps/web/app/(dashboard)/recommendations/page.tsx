'use client'

import { useState } from 'react'
import { TrendingDown, ChevronRight } from 'lucide-react'
import { useRecommendations, type ModelRecommendation } from '@/lib/queries/use-recommendations'
import { Topbar } from '@/components/layout/topbar'
import { MicroLabel } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'

function fmtUsd(v: number): string {
  if (v >= 100) return `$${Math.round(v)}`
  if (v >= 1) return `$${v.toFixed(2)}`
  return `$${v.toFixed(5)}`
}

function getConfidence(r: ModelRecommendation): 'high' | 'medium' | 'low' {
  if (r.estimatedMonthlySavingsUsd >= 50 && r.sampleCount >= 100) return 'high'
  if (r.estimatedMonthlySavingsUsd >= 10 && r.sampleCount >= 30) return 'medium'
  return 'low'
}

function ConfidenceBar({ level }: { level: 'high' | 'medium' | 'low' }) {
  const filled = level === 'high' ? 3 : level === 'medium' ? 2 : 1
  return (
    <div className="flex items-center gap-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn(
            'w-3.5 h-1.5 rounded-sm',
            i < filled
              ? level === 'high'
                ? 'bg-good'
                : level === 'medium'
                  ? 'bg-text'
                  : 'bg-text-faint'
              : 'bg-bg-elev border border-border',
          )}
        />
      ))}
      <span className="ml-1.5 text-[10.5px] font-mono text-text-muted capitalize">{level}</span>
    </div>
  )
}

function HeroTile({
  label,
  value,
  sub,
  big,
}: {
  label: string
  value: string
  sub?: string
  big?: boolean
}) {
  return (
    <div className="flex flex-col gap-1 px-6 py-5 border-r border-border last:border-r-0">
      <MicroLabel>{label}</MicroLabel>
      <span
        className={cn(
          'font-semibold leading-none',
          big ? 'text-[28px] text-accent' : 'text-[22px] text-text',
        )}
      >
        {value}
      </span>
      {sub && <span className="text-[11px] text-text-muted font-mono">{sub}</span>}
    </div>
  )
}

function dismissKey(r: ModelRecommendation): string {
  return `${r.currentProvider}/${r.currentModel}`
}

export default function RecommendationsPage() {
  const { data, isLoading, error } = useRecommendations({ hours: 24 * 7, minSavings: 5 })
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const all = data ?? []
  const visible = all.filter((r) => !dismissed.has(dismissKey(r)))

  const totalSavings = visible.reduce((s, r) => s + r.estimatedMonthlySavingsUsd, 0)
  const totalSpend = visible.reduce((s, r) => s + r.totalCostUsdLastNDays, 0)
  const highConf = visible.filter((r) => getConfidence(r) === 'high').length

  function dismiss(r: ModelRecommendation) {
    setDismissed((prev) => new Set([...prev, dismissKey(r)]))
  }

  return (
    <div className="-m-7 flex flex-col h-screen overflow-hidden bg-bg">
      {/* Topbar */}
      <Topbar
        crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Savings' }]}
      />

      {/* Hero strip */}
      <div className="grid grid-cols-4 border-b border-border shrink-0">
        <HeroTile
          label="Potential savings / mo"
          value={totalSavings > 0 ? fmtUsd(totalSavings) : '—'}
          sub="based on last 7 days"
          big
        />
        <HeroTile
          label="Spend (7d)"
          value={totalSpend > 0 ? fmtUsd(totalSpend) : '—'}
          sub="across analyzed models"
        />
        <HeroTile
          label="Opportunities"
          value={String(visible.length)}
          sub="model substitutions"
        />
        <HeroTile
          label="High confidence"
          value={String(highConf)}
          sub="≥$50/mo + ≥100 samples"
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-bg-elev rounded animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="m-6 p-4 rounded border border-bad/20 bg-bad-bg text-[13px] text-bad">
            Failed to load recommendations.
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
            <TrendingDown className="h-8 w-8 text-text-faint" />
            <p className="text-[13px]">No cost-saving opportunities right now.</p>
            <p className="text-[12px]">
              Already on optimal models, or need more traffic (min 30 requests per model).
            </p>
          </div>
        ) : (
          <div>
            {/* Group header */}
            <div className="flex items-center gap-2 px-6 py-2 bg-bg-elev border-b border-border">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.05em] text-accent font-semibold">
                Open
              </span>
              <span className="font-mono text-[10px] text-accent/70">{visible.length}</span>
            </div>

            {visible.map((r, i) => {
              const conf = getConfidence(r)
              return (
                <div
                  key={`${r.currentProvider}-${r.currentModel}-${i}`}
                  className="flex items-start gap-5 px-6 py-4 border-b border-border hover:bg-bg-elev transition-colors"
                >
                  {/* From → To + reason */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="font-mono text-[12px] text-text-muted">
                        {r.currentProvider} / {r.currentModel}
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 text-text-faint shrink-0" />
                      <span className="font-mono text-[12px] text-good font-medium">
                        {r.suggestedProvider} / {r.suggestedModel}
                      </span>
                    </div>
                    <p className="text-[12.5px] text-text-muted leading-relaxed">{r.reason}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-text-faint font-mono mt-1.5">
                      <span>{r.sampleCount} samples</span>
                      <span>~{Math.round(r.avgPromptTokens)} prompt tk</span>
                      <span>~{Math.round(r.avgCompletionTokens)} comp tk</span>
                      <span>{fmtUsd(r.totalCostUsdLastNDays)} / 7d</span>
                    </div>
                  </div>

                  {/* Savings + confidence */}
                  <div className="text-right shrink-0 w-32">
                    <div className="text-[20px] font-semibold text-good leading-none">
                      {fmtUsd(r.estimatedMonthlySavingsUsd)}
                    </div>
                    <div className="text-[10.5px] text-text-faint font-mono mt-0.5">saved / month</div>
                    <div className="mt-2 flex justify-end">
                      <ConfidenceBar level={conf} />
                    </div>
                  </div>

                  {/* Dismiss */}
                  <div className="shrink-0">
                    <button
                      type="button"
                      onClick={() => dismiss(r)}
                      className="px-2.5 py-1 rounded border border-border text-[11.5px] text-text-muted hover:text-text transition-colors"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
