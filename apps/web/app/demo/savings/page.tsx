'use client'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Topbar } from '@/components/layout/topbar'
import { DemoExportButton } from '@/components/ui/demo-export-button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DEMO_RECOMMENDATIONS } from '@/lib/demo-data'
import type { ModelRecommendation } from '@/lib/queries/use-recommendations'

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtUsd(v: number): string {
  if (v >= 100) return `$${Math.round(v)}`
  if (v >= 1) return `$${v.toFixed(2)}`
  return `$${v.toFixed(5)}`
}

function fmtPct(v: number): string {
  return `${Math.round(v * 100)}%`
}

function fmtTokenCount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toLocaleString('en-US')
}

// ── Prompt caching savings (static demo figures) ──────────────────────────────

/**
 * Passive savings already earned this month from prompt caching. Static demo
 * numbers only — the real page derives these from ClickHouse cache-hit logs via
 * useCacheSavings(). Module-level const so there is no runtime clock/random and
 * no hydration mismatch (gotcha #22).
 */
const DEMO_CACHE_SAVINGS = {
  savingsUsd: 46.18,
  cacheReadTokens: 8_420_000,
  cacheHitRequests: 3124,
} as const

/** Occupies a fixed slot in the stat row, same as the live cache-savings tile. */
function DemoCacheSavingsCard() {
  const data = DEMO_CACHE_SAVINGS
  return (
    <div className="rounded-card border border-border bg-bg-elev shadow-card px-5 py-[18px]">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-faint">
        Cache savings
      </div>
      <div className="font-display text-[22px] track-h3 leading-[1.05] text-text mt-[7px]">
        {fmtUsd(data.savingsUsd)}
      </div>
      <div
        className="text-[11.5px] font-medium text-good mt-[7px]"
        title={`Estimated from ${fmtTokenCount(data.cacheReadTokens)} cached input tokens across ${data.cacheHitRequests.toLocaleString('en-US')} requests. Cached tokens are billed at a discounted rate instead of the full input price.`}
      >
        already realised this month
      </div>
    </div>
  )
}

// ── Confidence helpers ────────────────────────────────────────────────────────

function getConfidence(r: ModelRecommendation): 'high' | 'medium' | 'low' {
  if (r.estimatedMonthlySavingsUsd >= 40 && r.sampleCount >= 100) return 'high'
  if (r.estimatedMonthlySavingsUsd >= 10 && r.sampleCount >= 30) return 'medium'
  return 'low'
}

const CONFIDENCE_WEIGHT: Record<'high' | 'medium' | 'low', number> = {
  high: 3, medium: 2, low: 1,
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
      <span className={cn('font-mono text-[11px] capitalize',
        level === 'high' ? 'text-good' : level === 'medium' ? 'text-text' : 'text-text-faint')}>
        {level}
      </span>
    </div>
  )
}

// ── Dismiss helpers ───────────────────────────────────────────────────────────

/** Use sampleCount to disambiguate same-model entries in demo data. */
function dismissKey(r: ModelRecommendation): string {
  return `${r.currentProvider}/${r.currentModel}/${r.sampleCount}`
}

// ── Sort / filter types ───────────────────────────────────────────────────────

type SortKey        = 'savings' | 'confidence' | 'name'
type ProviderFilter = 'all' | 'openai' | 'anthropic' | 'gemini'
type ConfFilter     = 'all' | 'high' | 'medium' | 'low'

interface SortFilterState {
  sortKey: SortKey
  filterProvider: ProviderFilter
  filterConf: ConfFilter
}

const DEFAULT_SORT_FILTER: SortFilterState = {
  sortKey: 'savings',
  filterProvider: 'all',
  filterConf: 'all',
}

function applyFilter(
  list: ModelRecommendation[],
  filterProvider: ProviderFilter,
  filterConf: ConfFilter,
): ModelRecommendation[] {
  return list.filter((r) => {
    if (filterProvider !== 'all' && r.currentProvider !== filterProvider) return false
    if (filterConf !== 'all' && getConfidence(r) !== filterConf) return false
    return true
  })
}

function applySort(list: ModelRecommendation[], sortKey: SortKey): ModelRecommendation[] {
  return [...list].sort((a, b) => {
    if (sortKey === 'confidence') {
      return CONFIDENCE_WEIGHT[getConfidence(b)] - CONFIDENCE_WEIGHT[getConfidence(a)]
    }
    if (sortKey === 'name') {
      return `${a.currentProvider}/${a.currentModel}`.localeCompare(
        `${b.currentProvider}/${b.currentModel}`,
      )
    }
    return b.estimatedMonthlySavingsUsd - a.estimatedMonthlySavingsUsd
  })
}

// ── Window options ────────────────────────────────────────────────────────────

const WINDOW_OPTIONS = [
  { hours: 24 * 7,  label: '7d' },
  { hours: 24 * 14, label: '14d' },
  { hours: 24 * 30, label: '30d' },
] as const

// ── SelectControl — tiny styled native select ─────────────────────────────────

function SelectControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="rounded-md border border-border bg-bg-elev px-3 py-2 text-[12.5px] font-medium text-text hover:bg-bg-muted transition-colors appearance-none cursor-pointer"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

// ── Mock percentile data ──────────────────────────────────────────────────────

interface DemoPercentileEntry {
  p50PromptTokens: number
  p95PromptTokens: number
  p99PromptTokens: number
  p50CompletionTokens: number
  p95CompletionTokens: number
  p99CompletionTokens: number
  sampleCount: number
}

/**
 * Static mock percentile data for demo — keyed by provider:model:sampleCount
 * so the two gpt-4o entries can be disambiguated.
 */
const DEMO_PERCENTILES = new Map<string, DemoPercentileEntry>([
  // gpt-4o code-assistant (1240 samples, maxPromptTokens 500, maxCompletionTokens 150)
  // P95 prompt (620) > envelope (500) → warning in dialog
  ['openai:gpt-4o:1240', {
    p50PromptTokens: 480, p95PromptTokens: 620, p99PromptTokens: 840,
    p50CompletionTokens: 175, p95CompletionTokens: 220, p99CompletionTokens: 310,
    sampleCount: 1240,
  }],
  // claude-sonnet-4-5 data extraction (624 samples, maxPromptTokens 800, maxCompletionTokens 250)
  ['anthropic:claude-sonnet-4-5:624', {
    p50PromptTokens: 680, p95PromptTokens: 740, p99PromptTokens: 920,
    p50CompletionTokens: 240, p95CompletionTokens: 265, p99CompletionTokens: 390,
    sampleCount: 624,
  }],
  // gpt-4o sentiment scoring (210 samples, maxPromptTokens 500, maxCompletionTokens 150)
  // P95s comfortably within envelope → all-clear in dialog
  ['openai:gpt-4o:210', {
    p50PromptTokens: 180, p95PromptTokens: 340, p99PromptTokens: 480,
    p50CompletionTokens: 42, p95CompletionTokens: 88, p99CompletionTokens: 130,
    sampleCount: 210,
  }],
])

function demoPercentileKey(r: ModelRecommendation): string {
  return `${r.currentProvider}:${r.currentModel}:${r.sampleCount}`
}

// ── DemoPercentileGrid ────────────────────────────────────────────────────────

function DemoPercentileGrid({
  data,
  maxPromptTokens,
  maxCompletionTokens,
  windowLabel,
}: {
  data: DemoPercentileEntry
  maxPromptTokens: number
  maxCompletionTokens: number
  windowLabel: string
}) {
  const promptWarn = data.p95PromptTokens > maxPromptTokens
  const complWarn  = data.p95CompletionTokens > maxCompletionTokens
  const hasWarning = promptWarn || complWarn

  return (
    <div className="rounded-lg border border-border bg-bg-elev p-4 space-y-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
        Token distribution · last {windowLabel}
      </div>

      {/* Header */}
      <div
        className="font-mono text-[10.5px]"
        style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr 1fr 80px', gap: 8, alignItems: 'center' }}
      >
        <span className="text-text-faint" />
        <span className="text-text-faint text-center">P50</span>
        <span className="text-text-faint text-center">P95</span>
        <span className="text-text-faint text-center">P99</span>
        <span className="text-text-faint text-right">Envelope</span>
      </div>

      {/* Prompt row */}
      <div
        className="font-mono text-[11px]"
        style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr 1fr 80px', gap: 8, alignItems: 'center' }}
      >
        <span className="text-text-faint">Prompt</span>
        <span className="text-text text-center">{data.p50PromptTokens.toLocaleString('en-US')}</span>
        <span className={cn('text-center font-medium', promptWarn ? 'text-warn' : 'text-text')}>
          {data.p95PromptTokens.toLocaleString('en-US')}
        </span>
        <span className="text-text-muted text-center">{data.p99PromptTokens.toLocaleString('en-US')}</span>
        <span className={cn('text-right', promptWarn ? 'text-warn' : 'text-text-faint')}>
          ≤ {maxPromptTokens.toLocaleString('en-US')}
          {promptWarn ? ' ⚠' : ' ✓'}
        </span>
      </div>

      {/* Completion row */}
      <div
        className="font-mono text-[11px]"
        style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr 1fr 80px', gap: 8, alignItems: 'center' }}
      >
        <span className="text-text-faint">Completion</span>
        <span className="text-text text-center">{data.p50CompletionTokens.toLocaleString('en-US')}</span>
        <span className={cn('text-center font-medium', complWarn ? 'text-warn' : 'text-text')}>
          {data.p95CompletionTokens.toLocaleString('en-US')}
        </span>
        <span className="text-text-muted text-center">{data.p99CompletionTokens.toLocaleString('en-US')}</span>
        <span className={cn('text-right', complWarn ? 'text-warn' : 'text-text-faint')}>
          ≤ {maxCompletionTokens.toLocaleString('en-US')}
          {complWarn ? ' ⚠' : ' ✓'}
        </span>
      </div>

      {hasWarning && (
        <div className="border border-warn/30 bg-warn/5 rounded-[5px] px-3 py-2 font-mono text-[10.5px] text-warn leading-relaxed">
          P95 exceeds the substitute envelope
          {promptWarn && complWarn ? ' for both prompt and completion' : promptWarn ? ' for prompt tokens' : ' for completion tokens'}.
          {' '}Some requests may degrade in quality, run a shadow comparison first.
        </div>
      )}
    </div>
  )
}

// ── Compare-in-playground dialog (static demo) ────────────────────────────────

/**
 * Static replica of the real ComparePlaygroundDialog. The live version wires up
 * prompt-version / API-key selectors and runs both models side by side; in the
 * demo everything is read-only and the run button is disabled behind a sign-up
 * notice. No data fetching, no mutations.
 */
function DemoComparePlaygroundDialog({
  rec,
  onClose,
}: {
  rec: ModelRecommendation
  onClose: () => void
}) {
  const dynamicSavings = rec.estimatedMonthlySavingsUsd
  const savingsPositive = dynamicSavings > 0

  const selectClass =
    'w-full font-mono text-[11.5px] text-text-faint px-3 py-2 border border-border rounded-[5px] bg-bg-elev appearance-none cursor-not-allowed opacity-60'

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Compare in playground</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 mt-1">
          {/* Context strip */}
          <div className={cn(
            'flex items-center gap-3 rounded-lg border px-4 py-3',
            savingsPositive ? 'border-good/25 bg-good/5' : 'border-bad/25 bg-bad/5',
          )}>
            <span className={cn('text-base leading-none', savingsPositive ? 'text-good' : 'text-bad')}>
              {savingsPositive ? '↓' : '↑'}
            </span>
            <div className="font-mono text-[12px] text-text leading-snug">
              Switching{' '}
              <span className="text-text-muted">{rec.currentModel}</span>
              {' → '}
              <span className="font-medium text-text">{rec.suggestedModel}</span>
              {' '}
              {savingsPositive
                ? <>could save <span className="font-medium text-good">${dynamicSavings.toFixed(0)}/mo</span></>
                : <>would cost <span className="font-medium text-bad">${Math.abs(dynamicSavings).toFixed(0)}/mo more</span></>
              }
            </div>
          </div>

          {/* Prompt version — shared, full-width (read-only in demo) */}
          <div>
            <label className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] mb-1.5 block">
              Prompt version
            </label>
            <div className={selectClass} aria-disabled>
              Sign up to select a prompt version
            </div>
          </div>

          {/* Two-column model cards */}
          <div className="grid grid-cols-2 gap-3">
            {/* Current model card */}
            <div className="rounded-lg border border-border bg-bg-elev p-4 space-y-3">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.05em] font-medium text-text-faint mb-1">
                  Current
                </div>
                <div className="font-mono text-[12px] text-text leading-tight">{rec.currentModel}</div>
                <div className="font-mono text-[10.5px] text-text-muted mt-0.5">{rec.currentProvider}</div>
              </div>
              <div>
                <label className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] mb-1.5 block">
                  API Key
                </label>
                <div className={selectClass} aria-disabled>Connect a key</div>
              </div>
            </div>

            {/* Suggested model card */}
            <div className={cn(
              'rounded-lg border p-4 space-y-3',
              savingsPositive ? 'border-good/30 bg-good/[0.03]' : 'border-bad/30 bg-bad/[0.03]',
            )}>
              <div className="flex items-start justify-between gap-2">
                <div className={cn(
                  'font-mono text-[10px] uppercase tracking-[0.05em] font-medium',
                  savingsPositive ? 'text-good' : 'text-bad',
                )}>
                  Suggested
                </div>
                <span className={cn(
                  'font-mono text-[10px] border px-1.5 py-0.5 rounded-[4px] whitespace-nowrap',
                  savingsPositive
                    ? 'text-good border-good/30 bg-good/10'
                    : 'text-bad border-bad/30 bg-bad/10',
                )}>
                  {savingsPositive ? `$${dynamicSavings.toFixed(0)}/mo saved` : `$${Math.abs(dynamicSavings).toFixed(0)}/mo more`}
                </span>
              </div>
              <div>
                <div className="font-mono text-[12px] text-text leading-tight">{rec.suggestedModel}</div>
                <div className="font-mono text-[10.5px] text-text-muted mt-0.5">{rec.suggestedProvider}</div>
              </div>
              <div>
                <label className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] mb-1.5 block">
                  API Key
                </label>
                <div className={selectClass} aria-disabled>Connect a key</div>
              </div>
            </div>
          </div>

          {/* Run button — disabled in demo */}
          <button
            type="button"
            disabled
            className="w-full font-mono text-[12.5px] px-4 py-3 rounded-[6px] bg-border text-text-faint cursor-not-allowed opacity-60 font-medium"
          >
            Run comparison
          </button>

          {/* Sign-up CTA */}
          <div className="pt-1 border-t border-border text-center">
            <a
              href="/signup"
              className="font-mono text-[11.5px] text-accent hover:underline underline-offset-2"
            >
              Sign up free to run side-by-side model comparisons →
            </a>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Row renderer ─────────────────────────────────────────────────────────────

interface RecRowProps {
  r: ModelRecommendation
  isHidden?: boolean
  isAchieved?: boolean
  windowLabel: string
  onSimulate: (r: ModelRecommendation) => void
  onCompare: (r: ModelRecommendation) => void
  onDismiss: (r: ModelRecommendation) => void
  onUnhide: (r: ModelRecommendation) => void
}

function RecRow({
  r,
  isHidden = false,
  isAchieved = false,
  windowLabel,
  onSimulate,
  onCompare,
  onDismiss,
  onUnhide,
}: RecRowProps) {
  const conf = getConfidence(r)
  const dropPct = r.priorWindowCostUsd && r.priorWindowCostUsd > 0
    ? (r.priorWindowCostUsd - r.totalCostUsdLastNDays) / r.priorWindowCostUsd
    : null

  return (
    <article
      className={cn(
        'rounded-card border bg-bg-elev shadow-card px-5 py-[18px] transition-colors',
        // Low-confidence rows keep the faint left rule so the visual signal
        // matches the badge state without yelling at the user.
        !isAchieved && conf === 'low' ? 'border-l-2 border-l-track border-border' : 'border-border',
        isHidden && 'opacity-70',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span className={cn('text-[13.5px] font-semibold truncate', isHidden ? 'text-text-muted' : 'text-text')}>
              {r.suggestedProvider} / {r.suggestedModel}
            </span>
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-[3px] font-mono text-[10.5px]',
                isAchieved
                  ? 'bg-good-bg text-good'
                  : conf === 'high'
                    ? 'bg-good-bg text-good'
                    : conf === 'medium'
                      ? 'bg-bg-chip text-text-muted'
                      : 'bg-bg-chip text-text-faint',
              )}
              title={CONFIDENCE_CRITERIA[conf]}
            >
              {isAchieved ? 'achieved' : `${conf} confidence`}
            </span>
            {isHidden && (
              <span className="inline-flex items-center rounded-full bg-bg-chip px-2 py-[3px] font-mono text-[10.5px] text-text-faint">
                hidden
              </span>
            )}
          </div>
          <div className="font-mono text-[12px] text-text-faint flex flex-wrap items-center gap-2 mt-1.5">
            <span className="line-through">{r.currentProvider} / {r.currentModel}</span>
            <span>→</span>
            <span className={cn(isHidden ? 'text-text-faint' : 'text-text-muted')}>
              {r.suggestedProvider} / {r.suggestedModel}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {isAchieved ? (
            <div className="text-right">
              <div className="font-display text-[20px] track-h3 leading-[1.05] text-good">
                {r.actualMonthlySavingsUsd != null ? fmtUsd(r.actualMonthlySavingsUsd) : '—'} / month
              </div>
              <div className="font-mono text-[11px] text-text-faint mt-1">
                est. {fmtUsd(r.estimatedMonthlySavingsUsd)} projected
              </div>
            </div>
          ) : (
            <div className="text-right">
              <div className={cn('font-display text-[20px] track-h3 leading-[1.05]', isHidden ? 'text-text-muted' : 'text-good')}>
                {fmtUsd(r.estimatedMonthlySavingsUsd)} / month
              </div>
              <div className="font-mono text-[11px] text-text-faint mt-1">
                was {fmtUsd(r.totalCostUsdLastNDays)} /{windowLabel}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap justify-end">
            {!isAchieved && (
              <>
                <button
                  type="button"
                  onClick={() => onCompare(r)}
                  className="rounded-full border border-border bg-bg-elev px-3.5 py-2 text-[12px] font-medium text-text hover:bg-bg-muted transition-colors"
                >
                  Compare
                </button>
                <button
                  type="button"
                  onClick={() => onSimulate(r)}
                  className="rounded-full bg-text px-3.5 py-2 text-[12px] font-medium text-bg hover:opacity-90 transition-opacity"
                >
                  Simulate
                </button>
              </>
            )}
            {isHidden ? (
              <button
                type="button"
                onClick={() => onUnhide(r)}
                className="rounded-full border border-border bg-bg-elev px-3.5 py-2 text-[12px] font-medium text-text hover:bg-bg-muted transition-colors"
              >
                Unhide
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onDismiss(r)}
                className="rounded-full border border-border bg-bg-elev px-3.5 py-2 text-[12px] font-medium text-text hover:bg-bg-muted transition-colors"
              >
                Hide
              </button>
            )}
          </div>
        </div>
      </div>

      <p className="text-[12.5px] text-text-muted leading-relaxed mt-2.5">{r.reason}</p>
      {isAchieved && dropPct !== null && (
        <p className="font-mono text-[11.5px] text-good mt-1.5">
          usage dropped {fmtPct(dropPct)} vs prior {windowLabel}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-x-10 gap-y-3 mt-4 pt-4 border-t border-border">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-faint mb-1.5">Samples</div>
          <div className="font-mono text-[12px] text-text">
            {r.sampleCount.toLocaleString('en-US')}
            <span className="text-text-faint"> · ~{Math.round(r.avgCompletionTokens)} output tk</span>
          </div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-faint mb-1.5">Confidence</div>
          <ConfidenceBar level={conf} />
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-faint mb-1.5">Threshold</div>
          <div className="font-mono text-[12px] text-text-muted" title={CONFIDENCE_CRITERIA[conf]}>
            {conf === 'high' ? '≥$40/mo · ≥100 req' : conf === 'medium' ? '≥$10/mo · ≥30 req' : `${r.sampleCount} req · <30 or <$10/mo`}
          </div>
        </div>
      </div>
    </article>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DemoSavingsPage() {
  const [hours,        setHours]       = useState<number>(24 * 7)
  const [dismissed,    setDismissed]   = useState<Set<string>>(new Set())
  const [sortFilter,   setSortFilter]  = useState<SortFilterState>(DEFAULT_SORT_FILTER)
  const [showHidden,   setShowHidden]  = useState(false)
  const [showAchieved, setShowAchieved] = useState(false)
  const [simRec,       setSimRec]      = useState<ModelRecommendation | null>(null)
  const [compareRec,   setCompareRec]  = useState<ModelRecommendation | null>(null)

  function dismiss(r: ModelRecommendation) {
    setDismissed((prev) => new Set([...prev, dismissKey(r)]))
  }
  function unhide(r: ModelRecommendation) {
    setDismissed((prev) => { const n = new Set(prev); n.delete(dismissKey(r)); return n })
  }
  function updateSort(sortKey: SortKey)            { setSortFilter((p) => ({ ...p, sortKey })) }
  function updateFilterProvider(v: ProviderFilter) { setSortFilter((p) => ({ ...p, filterProvider: v })) }
  function updateFilterConf(v: ConfFilter)         { setSortFilter((p) => ({ ...p, filterConf: v })) }

  const notDismissed = DEMO_RECOMMENDATIONS.filter((r) => !dismissed.has(dismissKey(r)))
  const achieved     = notDismissed.filter((r) => r.achieved)
  const openAll      = notDismissed.filter((r) => !r.achieved)

  const filterActive = sortFilter.filterProvider !== 'all' || sortFilter.filterConf !== 'all'
  const openFiltered = applyFilter(openAll, sortFilter.filterProvider, sortFilter.filterConf)
  const openSorted   = applySort(openFiltered, sortFilter.sortKey)

  const totalOpen     = openAll.reduce((s, r) => s + r.estimatedMonthlySavingsUsd, 0)
  const totalSpend    = openAll.reduce((s, r) => s + r.totalCostUsdLastNDays, 0)
  const totalAchieved = achieved.reduce((s, r) => s + (r.actualMonthlySavingsUsd ?? 0), 0)

  const highConf = openAll.filter((r) => getConfidence(r) === 'high')
  const medConf  = openAll.filter((r) => getConfidence(r) === 'medium')
  const lowConf  = openAll.filter((r) => getConfidence(r) === 'low')

  const bestConfLevel = highConf.length > 0 ? 'high' : medConf.length > 0 ? 'medium' : lowConf.length > 0 ? 'low' : null
  const bestConfCount = highConf.length || medConf.length || lowConf.length
  const bestConfLabel: Record<string, string> = {
    high: '≥$40/mo + ≥100 samples', medium: '≥$10/mo + ≥30 samples', low: 'below medium threshold',
  }

  const windowLabel = WINDOW_OPTIONS.find((o) => o.hours === hours)?.label ?? '7d'
  const sortLabel   = sortFilter.sortKey === 'savings' ? 'savings desc' : sortFilter.sortKey === 'confidence' ? 'confidence desc' : 'name asc'

  const simPercentileData = simRec ? (DEMO_PERCENTILES.get(demoPercentileKey(simRec)) ?? null) : null

  return (
    <>
      {/* The topbar is the only full-bleed row: it cancels the padding the
          demo layout applies so its hairline spans the whole main column.
          Everything below sits flush inside that padding. */}
      <div className="sticky top-0 z-20 -mx-4 -mt-4 md:-mx-7 md:-mt-5 bg-bg">
        <Topbar
          crumbs={[{ label: 'Demo', href: '/demo/dashboard' }, { label: 'Savings' }]}
          right={
            <div className="flex items-center gap-2">
              <DemoExportButton
                base="savings"
                rows={notDismissed}
                columns={[
                  { header: 'Current model', value: (r: ModelRecommendation) => `${r.currentProvider}/${r.currentModel}` },
                  { header: 'Suggested model', value: (r: ModelRecommendation) => `${r.suggestedProvider}/${r.suggestedModel}` },
                  { header: 'Est. monthly savings USD', value: (r: ModelRecommendation) => r.estimatedMonthlySavingsUsd.toFixed(2) },
                  { header: 'Sample count', value: (r: ModelRecommendation) => r.sampleCount },
                  { header: 'Cost last N days USD', value: (r: ModelRecommendation) => r.totalCostUsdLastNDays.toFixed(2) },
                ]}
              />
              <a
                href="/signup"
                className="hidden sm:inline rounded-full bg-text px-3.5 py-2 text-[12px] font-medium text-bg hover:opacity-90 transition-opacity"
              >
                Start free →
              </a>
            </div>
          }
        />
        <h1 className="sr-only">Savings</h1>
      </div>

      {/* 20px above the first row, 16px between rows, per the Figma content
          frame. Side and bottom gutters come from the demo layout. */}
      <div className="pt-4 md:pt-5 space-y-4">
        {/* Filter bar: analysis window as a segmented control, then the sort
            and filter selects, matching D9. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-0.5 rounded-full bg-bg-chip p-[3px]">
            {WINDOW_OPTIONS.map((opt) => (
              <button
                key={opt.hours}
                type="button"
                aria-pressed={hours === opt.hours}
                title={`Analysis window: last ${opt.label}`}
                onClick={() => setHours(opt.hours)}
                className={cn(
                  'rounded-full px-[11px] py-[5px] text-[12px] font-medium transition-colors',
                  hours === opt.hours ? 'bg-bg-elev text-text shadow-card' : 'text-text-faint hover:text-text',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <SelectControl<SortKey>
            value={sortFilter.sortKey}
            onChange={updateSort}
            options={[
              { value: 'savings',    label: 'Sort: Savings' },
              { value: 'confidence', label: 'Sort: Confidence' },
              { value: 'name',       label: 'Sort: Name' },
            ]}
          />
          <SelectControl<ProviderFilter>
            value={sortFilter.filterProvider}
            onChange={updateFilterProvider}
            options={[
              { value: 'all',       label: 'Provider: All' },
              { value: 'openai',    label: 'OpenAI' },
              { value: 'anthropic', label: 'Anthropic' },
              { value: 'gemini',    label: 'Gemini' },
            ]}
          />
          <SelectControl<ConfFilter>
            value={sortFilter.filterConf}
            onChange={updateFilterConf}
            options={[
              { value: 'all',    label: 'Conf: All' },
              { value: 'high',   label: 'High' },
              { value: 'medium', label: 'Medium' },
              { value: 'low',    label: 'Low' },
            ]}
          />

          {dismissed.size > 0 && (
            <button
              type="button"
              aria-pressed={showHidden}
              onClick={() => setShowHidden((v) => !v)}
              className={cn(
                'rounded-full border px-3.5 py-2 text-[12px] font-medium transition-colors',
                showHidden
                  ? 'border-border-strong bg-bg-muted text-text'
                  : 'border-border bg-bg-elev text-text hover:bg-bg-muted',
              )}
            >
              {showHidden ? 'Hide hidden' : `Show hidden · ${dismissed.size}`}
            </button>
          )}

          <span className="ml-auto hidden sm:inline font-mono text-[11px] text-text-faint whitespace-nowrap">
            {sortLabel}
          </span>
        </div>

        {/* Stat cards: found savings, passive cache savings, analysed spend,
            then the open / applied counters. */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="rounded-card border border-border bg-bg-elev shadow-card px-5 py-[18px]">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-faint">
              Monthly savings found
            </div>
            <div className={cn('font-display text-[22px] track-h3 leading-[1.05] mt-[7px]', totalOpen > 0 ? 'text-text' : 'text-text-faint')}>
              {totalOpen > 0 ? fmtUsd(totalOpen) : '—'}
            </div>
            <div className={cn('text-[11.5px] font-medium mt-[7px]', totalOpen > 0 ? 'text-accent' : 'text-text-faint')}>
              across {openAll.length} open recommendation{openAll.length === 1 ? '' : 's'}
              {highConf.length > 0 && ` · ${fmtUsd(highConf.reduce((sum, r) => sum + r.estimatedMonthlySavingsUsd, 0))} high confidence`}
            </div>
          </div>

          <DemoCacheSavingsCard />

          <div className="rounded-card border border-border bg-bg-elev shadow-card px-5 py-[18px]">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-faint">
              Spend · {windowLabel}
            </div>
            <div className="font-display text-[22px] track-h3 leading-[1.05] text-text mt-[7px]">
              {totalSpend > 0 ? fmtUsd(totalSpend) : '—'}
            </div>
            <div className="text-[11.5px] font-medium text-text-faint mt-[7px]">analysed models</div>
          </div>

          {[
            {
              label: 'Open',
              value: String(openAll.length),
              note: 'model swaps',
              good: false,
            },
            {
              label: achieved.length > 0 ? 'Applied' : (bestConfLevel ? `${bestConfLevel.charAt(0).toUpperCase() + bestConfLevel.slice(1)} conf.` : 'Confidence'),
              value: achieved.length > 0 ? fmtUsd(totalAchieved) : (bestConfLevel !== null ? String(bestConfCount) : '—'),
              note: achieved.length > 0 ? `${achieved.length} swap${achieved.length > 1 ? 's' : ''} adopted` : (bestConfLevel ? bestConfLabel[bestConfLevel] : 'no recommendations yet'),
              good: achieved.length > 0 || bestConfLevel === 'high',
            },
          ].map((s) => (
            <div key={s.label} className="rounded-card border border-border bg-bg-elev shadow-card px-5 py-[18px]">
              <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-faint">{s.label}</div>
              <div className={cn('font-display text-[22px] track-h3 leading-[1.05] mt-[7px]', s.good ? 'text-good' : 'text-text')}>
                {s.value}
              </div>
              <div className={cn('text-[11.5px] font-medium mt-[7px]', s.good ? 'text-good' : 'text-text-faint')}>
                {s.note}
              </div>
            </div>
          ))}
        </div>

        {/* Filter empty state */}
        {openAll.length > 0 && openSorted.length === 0 && (
          <div className="rounded-card border border-border bg-bg-elev shadow-card flex flex-col items-center justify-center py-16 gap-3 text-text-muted">
            <p className="text-[13px]">No recommendations match the current filters.</p>
            <button
              type="button"
              className="font-mono text-[11.5px] text-text underline underline-offset-2 hover:no-underline"
              onClick={() => setSortFilter(DEFAULT_SORT_FILTER)}
            >
              Clear filters
            </button>
          </div>
        )}

        {/* Open recommendations */}
        {openSorted.length > 0 && (
          <div className="space-y-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-accent pt-1">
              Open · {openSorted.length}{filterActive && openSorted.length < openAll.length ? ` (${openAll.length} total)` : ''} · {fmtUsd(totalOpen)} / mo
            </div>
            {openSorted.map((r, i) => (
              <RecRow
                key={`${dismissKey(r)}-${i}`}
                r={r}
                windowLabel={windowLabel}
                onSimulate={setSimRec}
                onCompare={setCompareRec}
                onDismiss={dismiss}
                onUnhide={unhide}
              />
            ))}
          </div>
        )}

        {/* Applied section */}
        {achieved.length > 0 && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setShowAchieved((v) => !v)}
              aria-expanded={showAchieved}
              className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-good hover:opacity-80 transition-opacity pt-1"
            >
              <span>Applied · {achieved.length} · {fmtUsd(totalAchieved)} / mo</span>
              <span>{showAchieved ? '▲' : '▼'}</span>
            </button>
            {showAchieved && achieved.map((r) => (
              <RecRow
                key={`${dismissKey(r)}-achieved`}
                r={r}
                isAchieved
                windowLabel={windowLabel}
                onSimulate={setSimRec}
                onCompare={setCompareRec}
                onDismiss={dismiss}
                onUnhide={unhide}
              />
            ))}
          </div>
        )}

        {/* Hidden recommendations */}
        {showHidden && dismissed.size > 0 && (
          <div className="space-y-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-faint pt-1">
              Hidden · {dismissed.size}
            </div>
            {DEMO_RECOMMENDATIONS
              .filter((r) => dismissed.has(dismissKey(r)))
              .map((r) => (
                <RecRow
                  key={`${dismissKey(r)}-hidden`}
                  r={r}
                  isHidden
                  windowLabel={windowLabel}
                  onSimulate={setSimRec}
                  onCompare={setCompareRec}
                  onDismiss={dismiss}
                  onUnhide={unhide}
                />
              ))}
          </div>
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
              {/* Context strip — matches Compare dialog style */}
              <div className="flex items-center gap-3 rounded-lg border border-good/25 bg-good/5 px-4 py-3">
                <span className="text-good text-base leading-none">↓</span>
                <div className="font-mono text-[12px] text-text leading-snug">
                  Switching{' '}
                  <span className="text-text-muted">{simRec.currentModel}</span>
                  {' → '}
                  <span className="font-medium text-text">{simRec.suggestedModel}</span>
                  {' '}could save{' '}
                  <span className="font-medium text-good">{fmtUsd(simRec.estimatedMonthlySavingsUsd)}/mo</span>
                </div>
              </div>

              {/* Cost summary */}
              <div className="rounded-lg border border-border bg-bg-elev p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3 font-mono text-[11.5px]">
                  <div>
                    <div className="text-text-faint uppercase text-[10px] tracking-[0.05em] mb-1">Last {windowLabel}</div>
                    <div className="text-text font-medium">{fmtUsd(simRec.totalCostUsdLastNDays)}</div>
                    <div className="text-text-muted text-[10.5px]">{simRec.sampleCount.toLocaleString('en-US')} requests</div>
                  </div>
                  <div>
                    <div className="text-text-faint uppercase text-[10px] tracking-[0.05em] mb-1">Projected monthly save</div>
                    <div className="text-good font-medium text-[14px]">{fmtUsd(simRec.estimatedMonthlySavingsUsd)}</div>
                    <div className="text-text-muted text-[10.5px]">/mo at current volume</div>
                  </div>
                </div>
                <div className="border-t border-border pt-3 font-mono text-[10.5px] text-text-faint leading-relaxed">
                  Projection = spend in window × (30 ÷ {windowLabel.replace('d', '')}) × (1 − cost_ratio).
                  cost_ratio is the blended price ratio of the two models at typical token mix.
                </div>
              </div>

              {/* Token distribution */}
              {simPercentileData ? (
                <DemoPercentileGrid
                  data={simPercentileData}
                  maxPromptTokens={simRec.maxPromptTokens}
                  maxCompletionTokens={simRec.maxCompletionTokens}
                  windowLabel={windowLabel}
                />
              ) : (
                <p className="font-mono text-[11px] text-text-faint">
                  Not enough data for token distribution.
                </p>
              )}

              <p className="text-[12px]">
                <span className="text-text font-medium">Caveat:</span> {simRec.reason}. Always run a
                shadow comparison before switching a production model.
              </p>

              {/* Sign-up CTA */}
              <div className="pt-1 border-t border-border text-center">
                <a
                  href="/signup"
                  className="font-mono text-[11.5px] text-accent hover:underline underline-offset-2"
                >
                  Sign up free to analyze your real usage →
                </a>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Compare-in-playground dialog (static demo) */}
      {compareRec && (
        <DemoComparePlaygroundDialog
          rec={compareRec}
          onClose={() => setCompareRec(null)}
        />
      )}
    </>
  )
}
