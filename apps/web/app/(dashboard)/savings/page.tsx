'use client'
import { useState, useEffect } from 'react'
import { Copy, Check, CheckCircle2 } from 'lucide-react'
import { useRecommendations, type ModelRecommendation } from '@/lib/queries/use-recommendations'
import {
  useRecommendationApplications,
  useMarkApplied,
  useUnmarkApplied,
  type RecommendationApplication,
} from '@/lib/queries/use-recommendation-applications'
import { Topbar } from '@/components/layout/topbar'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtUsd(v: number): string {
  if (v >= 100) return `$${Math.round(v)}`
  if (v >= 1) return `$${v.toFixed(2)}`
  return `$${v.toFixed(5)}`
}

function relativeDate(isoStr: string): string {
  const days = Math.floor((Date.now() - Date.parse(isoStr)) / (1000 * 60 * 60 * 24))
  if (days === 0) return 'today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

// ── Confidence helpers ────────────────────────────────────────────────────────

function getConfidence(r: ModelRecommendation): 'high' | 'medium' | 'low' {
  if (r.estimatedMonthlySavingsUsd >= 40 && r.sampleCount >= 100) return 'high'
  if (r.estimatedMonthlySavingsUsd >= 10 && r.sampleCount >= 30) return 'medium'
  return 'low'
}

const CONFIDENCE_CRITERIA: Record<'high' | 'medium' | 'low', string> = {
  high:   '≥$40/mo projected savings + ≥100 samples',
  medium: '≥$10/mo projected savings + ≥30 samples',
  low:    'below medium threshold (low traffic or small savings)',
}

function ConfidenceBar({ level }: { level: 'high' | 'medium' | 'low' }) {
  const filled = level === 'high' ? 3 : level === 'medium' ? 2 : 1
  const color = level === 'high' ? 'bg-good' : level === 'medium' ? 'bg-text' : 'bg-text-faint'
  return (
    <div className="flex items-center gap-1.5" title={CONFIDENCE_CRITERIA[level]}>
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

// ── Dismiss helpers ───────────────────────────────────────────────────────────

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

// ── Application key helper ────────────────────────────────────────────────────

function appliedKey(r: ModelRecommendation): string {
  return `${r.currentProvider}/${r.currentModel}/${r.suggestedProvider}/${r.suggestedModel}`
}

function buildAppliedMap(applications: RecommendationApplication[]): Map<string, RecommendationApplication> {
  const map = new Map<string, RecommendationApplication>()
  for (const app of applications) {
    const key = `${app.provider}/${app.model}/${app.suggestedProvider}/${app.suggestedModel}`
    // Keep the most recent one if duplicates exist
    if (!map.has(key) || Date.parse(app.appliedAt) > Date.parse(map.get(key)!.appliedAt)) {
      map.set(key, app)
    }
  }
  return map
}

// ── Window options ────────────────────────────────────────────────────────────

const WINDOW_OPTIONS = [
  { hours: 24 * 7,  label: '7d' },
  { hours: 24 * 14, label: '14d' },
  { hours: 24 * 30, label: '30d' },
] as const

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RecommendationsPage() {
  const [hours, setHours] = useState<number>(24 * 7)
  const { data, isLoading, error } = useRecommendations({ hours, minSavings: 5 })
  const { data: applications } = useRecommendationApplications()
  const markApplied = useMarkApplied()
  const unmarkApplied = useUnmarkApplied()

  // SSR/hydration safe: initialize with empty Set, restore from localStorage after mount
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [isLoaded, setIsLoaded] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const [applyRec, setApplyRec] = useState<ModelRecommendation | null>(null)
  const [simRec, setSimRec] = useState<ModelRecommendation | null>(null)
  const [copiedModel, setCopiedModel] = useState(false)

  const all = data ?? []
  const visible = all.filter((r) => !dismissed.has(dismissKey(r)))
  const appliedMap = buildAppliedMap(applications ?? [])

  const totalOpen = visible.reduce((s, r) => s + r.estimatedMonthlySavingsUsd, 0)
  const totalSpend = visible.reduce((s, r) => s + r.totalCostUsdLastNDays, 0)
  const highConf = visible.filter((r) => getConfidence(r) === 'high')
  const medConf  = visible.filter((r) => getConfidence(r) === 'medium')
  const lowConf  = visible.filter((r) => getConfidence(r) === 'low')

  // Hero tile: show highest available confidence level
  const bestConfLevel = highConf.length > 0 ? 'high' : medConf.length > 0 ? 'medium' : lowConf.length > 0 ? 'low' : null
  const bestConfCount = highConf.length > 0 ? highConf.length : medConf.length > 0 ? medConf.length : lowConf.length
  const bestConfLabel: Record<string, string> = {
    high:   '≥$40/mo + ≥100 samples',
    medium: '≥$10/mo + ≥30 samples',
    low:    'below medium threshold',
  }

  // Mount: restore dismissed set from localStorage
  useEffect(() => {
    setDismissed(loadDismissed())
    setIsLoaded(true)
  }, [])

  // Persist dismissed to localStorage (only after initial restore to avoid wiping it)
  useEffect(() => {
    if (!isLoaded) return
    try {
      localStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify([...dismissed]))
    } catch {
      // Quota-exceeded or private mode — silently ignore
    }
  }, [dismissed, isLoaded])

  function dismiss(r: ModelRecommendation) {
    setDismissed((prev) => new Set([...prev, dismissKey(r)]))
  }

  function unhide(r: ModelRecommendation) {
    setDismissed((prev) => {
      const next = new Set(prev)
      next.delete(dismissKey(r))
      return next
    })
  }

  const windowLabel = WINDOW_OPTIONS.find((o) => o.hours === hours)?.label ?? '7d'

  // ── Row renderer — shared between visible and hidden sections ─────────────

  function RecRow({ r, isHidden = false }: { r: ModelRecommendation; isHidden?: boolean }) {
    const conf    = getConfidence(r)
    const applied = appliedMap.get(appliedKey(r))

    return (
      <div
        className="border-b border-border hover:bg-bg-elev transition-colors"
        style={{
          display: 'grid',
          gridTemplateColumns: '1.7fr 170px 130px 150px 180px',
          gap: 16,
          alignItems: 'center',
          padding: '14px 22px',
          minWidth: '700px',
        }}
      >
        {/* Title + from/to */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={cn(
              'font-mono text-[9px] px-[6px] py-[1px] rounded-[3px] border uppercase tracking-[0.04em]',
              isHidden
                ? 'border-border bg-bg text-text-faint'
                : 'border-accent-border bg-accent-bg text-accent',
            )}>
              SWAP
            </span>
            <span className={cn('text-[13.5px] font-medium truncate', isHidden ? 'text-text-muted' : 'text-text')}>
              {r.currentProvider} / {r.currentModel} → {r.suggestedProvider} / {r.suggestedModel}
            </span>
            {applied && (
              <span suppressHydrationWarning className="flex items-center gap-1 font-mono text-[10px] text-good">
                <CheckCircle2 className="h-3 w-3" />
                Applied {relativeDate(applied.appliedAt)}
              </span>
            )}
          </div>
          <div className="font-mono text-[11.5px] text-text-muted flex items-center gap-2 flex-wrap">
            <span className="text-text-faint line-through">{r.currentProvider} / {r.currentModel}</span>
            <span className="text-text-faint">→</span>
            <span className={cn(isHidden ? 'text-text-faint' : 'text-text')}>{r.suggestedProvider} / {r.suggestedModel}</span>
          </div>
          <p className="text-[12px] text-text-faint mt-1 leading-relaxed">{r.reason}</p>
        </div>

        {/* Savings */}
        <div>
          <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.03em] mb-[3px]">SAVE / MO</div>
          <div className={cn('font-mono text-[18px] font-medium tracking-[-0.3px]', isHidden ? 'text-text-muted' : 'text-accent')}>
            {fmtUsd(r.estimatedMonthlySavingsUsd)}
          </div>
          <div className="font-mono text-[10.5px] text-text-faint mt-0.5">
            was {fmtUsd(r.totalCostUsdLastNDays)} /{windowLabel}
          </div>
        </div>

        {/* Samples */}
        <div>
          <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.03em] mb-[3px]">SAMPLES</div>
          <div className={cn('text-[12.5px]', isHidden ? 'text-text-muted' : 'text-text')}>{r.sampleCount.toLocaleString()}</div>
          <div className="font-mono text-[10.5px] text-text-faint mt-0.5">~{Math.round(r.avgCompletionTokens)} output tk</div>
        </div>

        {/* Confidence */}
        <div>
          <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.03em] mb-[5px]">CONFIDENCE</div>
          <ConfidenceBar level={conf} />
          <div className="font-mono text-[10.5px] text-text-faint mt-1" title={CONFIDENCE_CRITERIA[conf]}>
            {conf === 'high' ? '≥$40/mo · ≥100 req' : conf === 'medium' ? '≥$10/mo · ≥30 req' : `${r.sampleCount} req · <30 or <$10/mo`}
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
          {isHidden ? (
            <button
              type="button"
              onClick={() => unhide(r)}
              className="font-mono text-[10.5px] text-text-muted px-[10px] py-[4px] border border-border rounded-[5px] hover:text-text transition-colors"
            >
              Unhide
            </button>
          ) : (
            <button
              type="button"
              onClick={() => dismiss(r)}
              className="font-mono text-[10.5px] text-text-muted px-[10px] py-[4px] border border-border rounded-[5px] hover:text-text transition-colors"
            >
              Hide
            </button>
          )}
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
  }

  // Apply dialog helpers
  const applyRec_applied = applyRec ? appliedMap.get(appliedKey(applyRec)) : undefined

  function handleMarkApplied() {
    if (!applyRec) return
    markApplied.mutate({
      provider: applyRec.currentProvider,
      model: applyRec.currentModel,
      suggestedProvider: applyRec.suggestedProvider,
      suggestedModel: applyRec.suggestedModel,
    })
  }

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col h-screen overflow-hidden bg-bg">
      <Topbar
        crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Savings' }]}
        right={
          <div className="flex items-center gap-1">
            {WINDOW_OPTIONS.map((opt) => (
              <button
                key={opt.hours}
                type="button"
                onClick={() => setHours(opt.hours)}
                className={cn(
                  'font-mono text-[11px] px-[8px] py-[3px] rounded-[4px] transition-colors',
                  hours === opt.hours
                    ? 'bg-bg-elev text-text border border-border-strong'
                    : 'text-text-faint hover:text-text',
                )}
              >
                {opt.label}
              </button>
            ))}
            <span className="hidden sm:inline font-mono text-[11px] text-text-muted ml-1.5">Analysis window</span>
          </div>
        }
      />

      {/* Hero strip */}
      <div className="overflow-x-auto shrink-0 border-b border-border">
      <div className="grid min-w-[700px]" style={{ gridTemplateColumns: '1.25fr 1fr 1fr 1fr' }}>
        {/* Hero tile */}
        <div className="px-[16px] py-[16px] bg-bg-elev border-r border-border">
          <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">
            Potential savings · next 30d
          </div>
          <div className="flex items-baseline gap-2 mb-1.5">
            <span className={cn('font-medium leading-none tracking-[-1.6px]', totalOpen > 0 ? 'text-[40px] text-accent' : 'text-[30px] text-text-faint')}>
              {totalOpen > 0 ? fmtUsd(totalOpen) : '—'}
            </span>
            <span className="font-mono text-[10px] text-text-muted">/ mo</span>
          </div>
          <div className="font-mono text-[10px] text-text-muted mb-2">
            across <span className="text-text">{visible.length}</span> recommendations
            {bestConfLevel !== null && (
              <>
                {' '}·{' '}
                <span className={cn(bestConfLevel === 'high' ? 'text-good' : bestConfLevel === 'medium' ? 'text-text' : 'text-text-faint')}>
                  {bestConfCount}
                </span>{' '}
                <span className="text-text-faint">{bestConfLevel}-confidence</span>
              </>
            )}
          </div>
          {highConf.length > 0 && (
            <div className="font-mono text-[10px] text-good">
              {fmtUsd(highConf.reduce((s, r) => s + r.estimatedMonthlySavingsUsd, 0))} / mo high-conf
            </div>
          )}
        </div>

        {[
          {
            label: `Spend · ${windowLabel}`,
            value: totalSpend > 0 ? fmtUsd(totalSpend) : '—',
            delta: 'analyzed models',
            good: false,
          },
          {
            label: 'Opportunities',
            value: String(visible.length),
            delta: 'model swaps',
            good: false,
          },
          {
            label: bestConfLevel ? `${bestConfLevel.charAt(0).toUpperCase() + bestConfLevel.slice(1)} conf.` : 'Confidence',
            value: bestConfLevel !== null ? String(bestConfCount) : '—',
            delta: bestConfLevel ? bestConfLabel[bestConfLevel] : 'no recommendations yet',
            good: bestConfLevel === 'high',
          },
        ].map((s, i) => (
          <div key={i} className={cn('px-[16px] py-[16px]', i < 2 && 'border-r border-border')}>
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">{s.label}</div>
            <div className={cn('text-[28px] font-medium leading-none tracking-[-0.8px]', s.good ? 'text-good' : 'text-text')}>
              {s.value}
            </div>
            <div className="font-mono text-[10px] text-text-muted mt-1.5 whitespace-nowrap">{s.delta}</div>
          </div>
        ))}
      </div>
      </div>

      {/* Scope / filter row */}
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
                : 'border-border text-text-faint hover:text-text hover:border-border-strong',
            )}
          >
            {showHidden ? 'Hide hidden' : `Show hidden · ${dismissed.size}`}
          </button>
        )}
        <span className="flex-1" />
        <span className="hidden sm:inline font-mono text-[10px] text-text-faint whitespace-nowrap shrink-0">
          Sorted by estimated monthly savings · desc
        </span>
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
          <div className="m-6 p-4 rounded border border-border bg-bg-elev text-[13px] text-bad">
            Failed to load recommendations.
          </div>
        ) : (
          <>
            {/* Empty state — context-aware */}
            {visible.length === 0 && (
              dismissed.size > 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3 text-text-muted">
                  <p className="text-[13px]">All recommendations are hidden.</p>
                  <p className="font-mono text-[12px]">
                    Use{' '}
                    <button
                      type="button"
                      className="text-text underline underline-offset-2 hover:no-underline"
                      onClick={() => setShowHidden(true)}
                    >
                      Show hidden
                    </button>{' '}
                    to review them.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 gap-3 text-text-muted">
                  <p className="text-[13px]">No cost-saving opportunities right now.</p>
                  <p className="font-mono text-[12px]">
                    Need more traffic (min 30 requests per model) or already optimal.
                  </p>
                  {hours < 24 * 30 && (
                    <p className="font-mono text-[11.5px] text-text-faint">
                      Try a longer window{' '}
                      <button
                        type="button"
                        className="text-text underline underline-offset-2 hover:no-underline"
                        onClick={() => setHours(24 * 30)}
                      >
                        30d
                      </button>
                      {' '}to capture more data.
                    </p>
                  )}
                </div>
              )
            )}

            {/* Open recommendations */}
            {visible.length > 0 && (
              <div className="flex items-center gap-2.5 px-[22px] py-[10px] bg-bg-muted border-b border-border border-t border-t-border">
                <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-accent">
                  Open · {visible.length} · {fmtUsd(totalOpen)} / mo
                </span>
              </div>
            )}
            {visible.map((r, i) => (
              <RecRow key={`${r.currentProvider}-${r.currentModel}-${i}`} r={r} />
            ))}

            {/* Hidden recommendations */}
            {showHidden && dismissed.size > 0 && (
              <>
                <div className="flex items-center gap-2.5 px-[22px] py-[10px] bg-bg-muted border-b border-border border-t border-t-border">
                  <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint">
                    Hidden · {dismissed.size}
                  </span>
                </div>
                {all
                  .filter((r) => dismissed.has(dismissKey(r)))
                  .map((r) => (
                    <RecRow
                      key={`${r.currentProvider}-${r.currentModel}-hidden`}
                      r={r}
                      isHidden
                    />
                  ))}
              </>
            )}
          </>
        )}
      </div>

      {/* Simulate dialog */}
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
                    <div className="text-text-faint uppercase text-[10px] tracking-[0.05em] mb-1">
                      Last {windowLabel}
                    </div>
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
                  Projection = spend in window × (30 ÷ {windowLabel.replace('d', '')}) × (1 − cost_ratio).
                  cost_ratio is the blended price ratio of the two models at typical token mix.
                  Assumes similar token counts; real savings shift with traffic volume.
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

      {/* Apply dialog */}
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

              {/* Mark as applied */}
              <div className="border-t border-border pt-4">
                {applyRec_applied ? (
                  <div className="flex items-center justify-between p-3 rounded-lg border border-good/30 bg-good/5">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-good" />
                      <span suppressHydrationWarning className="text-[12px] text-good font-medium">
                        Applied {relativeDate(applyRec_applied.appliedAt)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => unmarkApplied.mutate(applyRec_applied.id)}
                      disabled={unmarkApplied.isPending}
                      className="font-mono text-[11px] text-text-muted hover:text-text transition-colors disabled:opacity-50"
                    >
                      Undo
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleMarkApplied}
                    disabled={markApplied.isPending}
                    className="w-full font-mono text-[12px] text-text-muted px-4 py-2.5 border border-border rounded-lg hover:bg-bg-elev hover:text-text transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {markApplied.isPending ? 'Saving…' : 'Mark as applied'}
                  </button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
