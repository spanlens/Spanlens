'use client'
import { useState, useEffect } from 'react'
import { Copy, Check } from 'lucide-react'
import { useRecommendations, type ModelRecommendation } from '@/lib/queries/use-recommendations'
import { Topbar } from '@/components/layout/topbar'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

function fmtUsd(v: number): string {
  if (v >= 100) return `$${Math.round(v)}`
  if (v >= 1) return `$${v.toFixed(2)}`
  return `$${v.toFixed(5)}`
}

function getConfidence(r: ModelRecommendation): 'high' | 'medium' | 'low' {
  if (r.estimatedMonthlySavingsUsd >= 40 && r.sampleCount >= 100) return 'high'
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

const DISMISS_STORAGE_KEY = 'spanlens:savings:dismissed'

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISS_STORAGE_KEY)
    if (!raw) return new Set()
    const arr: unknown = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? (arr as string[]) : [])
  } catch {
    return new Set()
  }
}

export default function RecommendationsPage() {
  const { data, isLoading, error } = useRecommendations({ hours: 24 * 7, minSavings: 5 })
  // SSR/hydration 안전: 초기값은 빈 Set, mount 후 localStorage에서 복원
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [isLoaded, setIsLoaded] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const [applyRec, setApplyRec] = useState<ModelRecommendation | null>(null)
  const [simRec, setSimRec] = useState<ModelRecommendation | null>(null)
  const [copiedModel, setCopiedModel] = useState(false)

  const all = data ?? []
  const visible = all.filter((r) => !dismissed.has(dismissKey(r)))

  const totalOpen = visible.reduce((s, r) => s + r.estimatedMonthlySavingsUsd, 0)
  const totalSpend = visible.reduce((s, r) => s + r.totalCostUsdLastNDays, 0)
  const highConf   = visible.filter((r) => getConfidence(r) === 'high')
  const medConf    = visible.filter((r) => getConfidence(r) === 'medium')
  const lowConf    = visible.filter((r) => getConfidence(r) === 'low')

  // 히어로 타일: 가장 높은 신뢰도 레벨부터 표시
  const bestConfLevel = highConf.length > 0 ? 'high' : medConf.length > 0 ? 'medium' : lowConf.length > 0 ? 'low' : null
  const bestConfCount = highConf.length > 0 ? highConf.length : medConf.length > 0 ? medConf.length : lowConf.length
  const bestConfLabel: Record<string, string> = { high: '≥$40/mo + ≥100 samples', medium: '≥$10/mo + ≥30 samples', low: 'below medium threshold' }

  // mount 후 localStorage 복원 (SSR과 일치시키기 위해 lazy initializer 대신 useEffect 사용)
  useEffect(() => {
    setDismissed(loadDismissed())
    setIsLoaded(true)
  }, [])

  // isLoaded 전엔 저장하지 않음 — 빈 Set으로 localStorage를 덮어쓰는 것 방지
  useEffect(() => {
    if (!isLoaded) return
    try {
      localStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify([...dismissed]))
    } catch {
      // localStorage 사용 불가 환경(시크릿 모드 quota 초과 등)에서 조용히 무시
    }
  }, [dismissed, isLoaded])

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
            <span className={cn(bestConfLevel === 'high' ? 'text-good' : bestConfLevel === 'medium' ? 'text-text' : 'text-text-faint')}>
              {bestConfCount}
            </span>{' '}
            <span className="text-text-faint">{bestConfLevel ?? 'no'}-confidence</span>
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
          { label: `${bestConfLevel ?? 'No'} confidence`, value: String(bestConfCount), delta: bestConfLevel ? bestConfLabel[bestConfLevel] : 'no recommendations yet', good: bestConfLevel === 'high' },
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
        {dismissed.size > 0 && (
          <button
            type="button"
            onClick={() => setShowHidden((v) => !v)}
            className={cn(
              'font-mono text-[11px] px-[9px] py-[3px] border rounded-[4px] transition-colors',
              showHidden
                ? 'border-border-strong bg-bg-elev text-text'
                : 'border-border text-text-faint hover:text-text hover:border-border-strong'
            )}
          >
            {showHidden ? 'Hide hidden' : `Show hidden · ${dismissed.size}`}
          </button>
        )}
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
        ) : (
          <>
            {/* Empty state — only visible items are 0 */}
            {visible.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 gap-3 text-text-muted">
                <p className="text-[13px]">No cost-saving opportunities right now.</p>
                <p className="font-mono text-[12px]">Need more traffic (min 30 requests per model) or already optimal.</p>
              </div>
            )}

            {/* Group header */}
            {visible.length > 0 && (
              <div className="flex items-center gap-2.5 px-[22px] py-[10px] bg-bg-muted border-b border-border border-t border-t-border">
                <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-accent">
                  Open · {visible.length} · {fmtUsd(totalOpen)} / mo
                </span>
              </div>
            )}

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
                      was {fmtUsd(r.totalCostUsdLastNDays)} /wk
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
                      onClick={() => setSimRec(r)}
                      className="font-mono text-[10.5px] text-text-muted px-[10px] py-[4px] border border-border rounded-[5px] hover:text-text transition-colors"
                    >
                      Simulate
                    </button>
                    <button
                      type="button"
                      onClick={() => dismiss(r)}
                      className="font-mono text-[10.5px] text-text-muted px-[10px] py-[4px] border border-border rounded-[5px] hover:text-text transition-colors"
                    >
                      Hide
                    </button>
                    <button
                      type="button"
                      onClick={() => { setApplyRec(r); setCopiedModel(false) }}
                      className="font-mono text-[10.5px] text-bg px-[10px] py-[4px] rounded-[5px] bg-text font-medium hover:opacity-90 transition-opacity"
                    >
                      Apply →
                    </button>
                  </div>
                </div>
              )
            })}

            {/* Hidden items — shown when showHidden toggle is on */}
            {showHidden && dismissed.size > 0 && (
              <>
                <div className="flex items-center gap-2.5 px-[22px] py-[10px] bg-bg-muted border-b border-border border-t border-t-border">
                  <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint">
                    Hidden · {dismissed.size}
                  </span>
                </div>
                {all.filter((r) => dismissed.has(dismissKey(r))).map((r, i, arr) => (
                  <div
                    key={`${r.currentProvider}-${r.currentModel}-hidden`}
                    className={cn('flex items-center gap-5 px-[22px] py-[12px] opacity-50', i < arr.length - 1 && 'border-b border-border')}
                  >
                    <div className="flex-1 min-w-0 font-mono text-[12px] text-text-faint">
                      {r.currentProvider} / {r.currentModel}
                      <span className="mx-2 text-text-faint">→</span>
                      {r.suggestedProvider} / {r.suggestedModel}
                    </div>
                    <div className="font-mono text-[11px] text-accent">{fmtUsd(r.estimatedMonthlySavingsUsd)} / mo</div>
                    <span className="font-mono text-[10px] text-text-faint px-[7px] py-[2px] border border-border rounded-[3px]">hidden</span>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* Simulate dialog — shows how the savings estimate is computed */}
      <Dialog open={simRec !== null} onOpenChange={(open) => !open && setSimRec(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Simulate savings</DialogTitle>
          </DialogHeader>
          {simRec && (
            <div className="space-y-4 mt-2 text-[13px] text-text-muted">
              <div className="font-mono text-[12px]">
                <span className="text-text-faint line-through">{simRec.currentProvider} / {simRec.currentModel}</span>
                <span className="mx-2 text-text-faint">→</span>
                <span className="text-text">{simRec.suggestedProvider} / {simRec.suggestedModel}</span>
              </div>
              <div className="rounded-lg border border-border bg-bg-elev p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3 font-mono text-[11.5px]">
                  <div>
                    <div className="text-text-faint uppercase text-[10px] tracking-[0.05em] mb-1">Last 7 days</div>
                    <div className="text-text font-medium">{fmtUsd(simRec.totalCostUsdLastNDays)}</div>
                    <div className="text-text-muted text-[10.5px]">{simRec.sampleCount.toLocaleString()} requests</div>
                  </div>
                  <div>
                    <div className="text-text-faint uppercase text-[10px] tracking-[0.05em] mb-1">Projected monthly save</div>
                    <div className="text-accent font-medium text-[14px]">{fmtUsd(simRec.estimatedMonthlySavingsUsd)}</div>
                    <div className="text-text-muted text-[10.5px]">/mo at current volume</div>
                  </div>
                </div>
                <div className="border-t border-border pt-3 font-mono text-[10.5px] text-text-faint leading-relaxed">
                  Projection = current cost × 30/7 × (1 − new_model_price_per_token / old_model_price_per_token).
                  Assumes identical token counts; real savings shift with traffic.
                </div>
              </div>
              <p className="text-[12px]">
                <span className="text-text font-medium">Caveat:</span> {simRec.reason}. Always run a
                shadow comparison before switching a production model.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Apply dialog — manual instructions, no auto-rewrite */}
      <Dialog open={applyRec !== null} onOpenChange={(open) => !open && setApplyRec(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply this recommendation</DialogTitle>
          </DialogHeader>
          {applyRec && (
            <div className="space-y-4 mt-2 text-[13px] text-text-muted">
              <p>
                Spanlens doesn&apos;t rewrite your application code. To apply this swap, update the
                <span className="font-mono text-text"> model </span>
                parameter in your LLM call from
                <span className="font-mono text-text"> {applyRec.currentModel} </span>
                to
                <span className="font-mono text-text"> {applyRec.suggestedModel}</span>.
              </p>
              <div className="rounded-lg border border-border bg-bg-elev overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border bg-bg-muted flex items-center justify-between">
                  <span className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em]">
                    New model name
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(applyRec.suggestedModel)
                      setCopiedModel(true)
                      setTimeout(() => setCopiedModel(false), 1500)
                    }}
                    className="font-mono text-[11px] text-accent hover:opacity-80 transition-opacity flex items-center gap-1"
                  >
                    {copiedModel
                      ? <><Check className="h-3 w-3" /> Copied</>
                      : <><Copy className="h-3 w-3" /> Copy</>}
                  </button>
                </div>
                <code className="block px-4 py-3 font-mono text-[13px] text-text">
                  {applyRec.suggestedModel}
                </code>
              </div>
              <ol className="list-decimal pl-5 space-y-1 text-[12.5px]">
                <li>Find the call to <span className="font-mono text-text">{applyRec.currentProvider}</span> using <span className="font-mono text-text">{applyRec.currentModel}</span></li>
                <li>Swap the model name to <span className="font-mono text-text">{applyRec.suggestedModel}</span></li>
                <li>Deploy to a canary or staging first — verify output quality matches</li>
                <li>Watch the Requests page for 24h to confirm no regressions</li>
              </ol>
              <p className="text-[11.5px] text-text-faint">
                Once rolled out, hide this recommendation to clear it from the list.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
