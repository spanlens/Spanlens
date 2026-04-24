'use client'
import { useState } from 'react'
import { useRecommendations, type ModelRecommendation } from '@/lib/queries/use-recommendations'
import { Topbar } from '@/components/layout/topbar'
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
  const color = level === 'high' ? 'bg-good' : level === 'medium' ? 'bg-text' : 'bg-text-faint'
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex gap-[3px]">
        {[0, 1, 2].map((i) => (
          <span key={i} className={cn('w-4 h-1 rounded-[1px]', i < filled ? color : 'bg-border')} />
        ))}
      </div>
      <span className={cn('font-mono text-[11px] capitalize', level === 'high' ? 'text-good' : level === 'medium' ? 'text-text' : 'text-text-faint')}>
        {level}
      </span>
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

  const totalOpen = visible.reduce((s, r) => s + r.estimatedMonthlySavingsUsd, 0)
  const totalSpend = visible.reduce((s, r) => s + r.totalCostUsdLastNDays, 0)
  const highConf = visible.filter((r) => getConfidence(r) === 'high')

  function dismiss(r: ModelRecommendation) {
    setDismissed((prev) => new Set([...prev, dismissKey(r)]))
  }

  return (
    <div className="-m-7 flex flex-col h-screen overflow-hidden bg-bg">
      <Topbar
        crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Savings' }]}
        right={
          <span className="font-mono text-[11px] text-text-muted">
            Analysis window · <span className="text-text">7d</span>
          </span>
        }
      />

      {/* Hero strip */}
      <div className="grid border-b border-border shrink-0" style={{ gridTemplateColumns: '1.25fr 1fr 1fr 1fr' }}>
        {/* Hero tile */}
        <div className="px-[22px] py-[20px] bg-bg-elev border-r border-border">
          <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">
            Potential savings · next 30d
          </div>
          <div className="flex items-baseline gap-2.5 mb-2">
            <span className={cn('font-medium leading-none tracking-[-1.6px]', totalOpen > 0 ? 'text-[48px] text-accent' : 'text-[36px] text-text-faint')}>
              {totalOpen > 0 ? fmtUsd(totalOpen) : '—'}
            </span>
            <span className="font-mono text-[11px] text-text-muted">/ mo</span>
          </div>
          <div className="font-mono text-[11px] text-text-muted mb-3">
            across <span className="text-text">{visible.length}</span> recommendations ·{' '}
            <span className="text-good">{highConf.length}</span> high-confidence
          </div>
          {highConf.length > 0 && (
            <div className="font-mono text-[11px] text-good">
              {fmtUsd(highConf.reduce((s, r) => s + r.estimatedMonthlySavingsUsd, 0))} / mo from high-confidence recommendations alone
            </div>
          )}
        </div>

        {[
          { label: 'Spend · 7d',         value: totalSpend > 0 ? fmtUsd(totalSpend) : '—', delta: 'across analyzed models', good: false },
          { label: 'Opportunities',       value: String(visible.length),                     delta: 'model substitutions',    good: false },
          { label: 'High confidence',     value: String(highConf.length),                    delta: '≥$50/mo + ≥100 samples', good: highConf.length > 0 },
        ].map((s, i) => (
          <div key={i} className={cn('px-[22px] py-[20px]', i < 2 && 'border-r border-border')}>
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">{s.label}</div>
            <div className={cn('text-[32px] font-medium leading-none tracking-[-0.8px]', s.good ? 'text-good' : 'text-text')}>
              {s.value}
            </div>
            <div className="font-mono text-[11px] text-text-muted mt-2">{s.delta}</div>
          </div>
        ))}
      </div>

      {/* Scope row — only model-swap recs exist today */}
      <div className="flex items-center gap-2 px-[22px] py-[10px] border-b border-border shrink-0">
        <span className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em]">Type</span>
        <span className="font-mono text-[11px] text-text px-[9px] py-[3px] border border-border-strong bg-bg-elev rounded-[4px]">
          model swap · {visible.length}
        </span>
        <span className="flex-1" />
        <span className="font-mono text-[10px] text-text-faint">
          Sorted by estimated monthly savings · desc
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-bg-elev rounded animate-pulse" />)}
          </div>
        ) : error ? (
          <div className="m-6 p-4 rounded border border-border bg-bg-elev text-[13px] text-bad">
            Failed to load recommendations.
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
            <p className="text-[13px]">No cost-saving opportunities right now.</p>
            <p className="font-mono text-[12px]">Need more traffic (min 30 requests per model) or already optimal.</p>
          </div>
        ) : (
          <>
            {/* Group header */}
            <div className="flex items-center gap-2.5 px-[22px] py-[10px] bg-bg-muted border-b border-border border-t border-t-border">
              <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-accent">
                Open · {visible.length} · {fmtUsd(totalOpen)} / mo
              </span>
            </div>

            {visible.map((r, i) => {
              const conf = getConfidence(r)
              return (
                <div
                  key={`${r.currentProvider}-${r.currentModel}-${i}`}
                  className="border-b border-border hover:bg-bg-elev transition-colors"
                  style={{ display: 'grid', gridTemplateColumns: '1.7fr 170px 130px 150px 180px', gap: 16, alignItems: 'center', padding: '14px 22px' }}
                >
                  {/* Title + from/to */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="font-mono text-[9px] px-[6px] py-[1px] rounded-[3px] border border-accent-border bg-accent-bg text-accent uppercase tracking-[0.04em]"
                      >
                        SWAP
                      </span>
                      <span className="text-[13.5px] text-text font-medium truncate">
                        {r.currentProvider} / {r.currentModel} → {r.suggestedProvider} / {r.suggestedModel}
                      </span>
                    </div>
                    <div className="font-mono text-[11.5px] text-text-muted flex items-center gap-2 flex-wrap">
                      <span className="text-text-faint line-through">{r.currentProvider} / {r.currentModel}</span>
                      <span className="text-text-faint">→</span>
                      <span className="text-text">{r.suggestedProvider} / {r.suggestedModel}</span>
                    </div>
                    <p className="text-[12px] text-text-faint mt-1 leading-relaxed">{r.reason}</p>
                  </div>

                  {/* Savings */}
                  <div>
                    <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.03em] mb-[3px]">SAVE / MO</div>
                    <div className="font-mono text-[18px] font-medium tracking-[-0.3px] text-accent">
                      {fmtUsd(r.estimatedMonthlySavingsUsd)}
                    </div>
                    <div className="font-mono text-[10.5px] text-text-faint mt-0.5">
                      was {fmtUsd(r.totalCostUsdLastNDays)} /7d
                    </div>
                  </div>

                  {/* Quality + latency */}
                  <div>
                    <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.03em] mb-[3px]">SAMPLES</div>
                    <div className="text-[12.5px] text-text">{r.sampleCount.toLocaleString()}</div>
                    <div className="font-mono text-[10.5px] text-good mt-0.5">−cost latency</div>
                  </div>

                  {/* Confidence */}
                  <div>
                    <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.03em] mb-[5px]">CONFIDENCE</div>
                    <ConfidenceBar level={conf} />
                    <div className="font-mono text-[10.5px] text-text-faint mt-1">
                      ~{Math.round(r.avgPromptTokens)} prompt tk
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex justify-end gap-1.5 flex-wrap">
                    <button
                      type="button"
                      className="font-mono text-[10.5px] text-text-muted px-[10px] py-[4px] border border-border rounded-[5px] hover:text-text transition-colors"
                    >
                      Simulate
                    </button>
                    <button
                      type="button"
                      onClick={() => dismiss(r)}
                      className="font-mono text-[10.5px] text-text-muted px-[10px] py-[4px] border border-border rounded-[5px] hover:text-text transition-colors"
                    >
                      Dismiss
                    </button>
                    <button
                      type="button"
                      className="font-mono text-[10.5px] text-bg px-[10px] py-[4px] rounded-[5px] bg-text font-medium hover:opacity-90 transition-opacity"
                    >
                      Apply →
                    </button>
                  </div>
                </div>
              )
            })}

            {dismissed.size > 0 && (
              <>
                <div className="flex items-center gap-2.5 px-[22px] py-[10px] bg-bg-muted border-b border-border border-t border-t-border">
                  <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint opacity-75">
                    Dismissed · {dismissed.size}
                  </span>
                </div>
                {all.filter((r) => dismissed.has(dismissKey(r))).map((r, i, arr) => (
                  <div
                    key={`${r.currentProvider}-${r.currentModel}-d`}
                    className={cn('flex items-center gap-5 px-[22px] py-[12px] opacity-60', i < arr.length - 1 && 'border-b border-border')}
                  >
                    <div className="flex-1 min-w-0 font-mono text-[12px] text-text-faint">
                      {r.currentProvider} / {r.currentModel} → {r.suggestedProvider} / {r.suggestedModel}
                    </div>
                    <div className="font-mono text-[11px] text-text-faint">dismissed</div>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
