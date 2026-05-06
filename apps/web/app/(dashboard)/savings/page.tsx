'use client'
import { useState, useEffect } from 'react'
import { useRecommendations, type ModelRecommendation } from '@/lib/queries/use-recommendations'
import { usePercentiles } from '@/lib/queries/use-recommendation-percentiles'
import { Topbar } from '@/components/layout/topbar'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtUsd(v: number): string {
  if (v >= 100) return `$${Math.round(v)}`
  if (v >= 1) return `$${v.toFixed(2)}`
  return `$${v.toFixed(5)}`
}

function fmtPct(v: number): string {
  return `${Math.round(v * 100)}%`
}

// ── Confidence helpers ────────────────────────────────────────────────────────

function getConfidence(r: ModelRecommendation): 'high' | 'medium' | 'low' {
  if (r.estimatedMonthlySavingsUsd >= 40 && r.sampleCount >= 100) return 'high'
  if (r.estimatedMonthlySavingsUsd >= 10 && r.sampleCount >= 30)  return 'medium'
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

const DISMISS_STORAGE_KEY    = 'spanlens:savings:dismissed'
const SORT_FILTER_STORAGE_KEY = 'spanlens:savings:sort-filter'

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISS_STORAGE_KEY)
    if (!raw) return new Set()
    const arr: unknown = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? (arr as string[]) : [])
  } catch { return new Set() }
}

// ── Sort / filter types ───────────────────────────────────────────────────────

type SortKey         = 'savings' | 'confidence' | 'name'
type ProviderFilter  = 'all' | 'openai' | 'anthropic' | 'gemini'
type ConfFilter      = 'all' | 'high' | 'medium' | 'low'

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

function loadSortFilter(): SortFilterState {
  try {
    const raw = localStorage.getItem(SORT_FILTER_STORAGE_KEY)
    if (!raw) return DEFAULT_SORT_FILTER
    return { ...DEFAULT_SORT_FILTER, ...(JSON.parse(raw) as Partial<SortFilterState>) }
  } catch { return DEFAULT_SORT_FILTER }
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
    // 'savings' (default)
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
      className="font-mono text-[10.5px] text-text-muted px-[8px] py-[3px] border border-border rounded-[4px] bg-bg hover:border-border-strong transition-colors appearance-none cursor-pointer"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

// ── PercentileGrid — rendered inside the Simulate dialog ──────────────────────

function PercentileGrid({
  provider,
  model,
  hours,
  maxPromptTokens,
  maxCompletionTokens,
  windowLabel,
}: {
  provider: string
  model: string
  hours: number
  maxPromptTokens: number
  maxCompletionTokens: number
  windowLabel: string
}) {
  const { data, isLoading } = usePercentiles({ provider, model, hours, enabled: true })

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-bg-elev p-4 space-y-2 animate-pulse">
        <div className="h-3 w-32 bg-border rounded" />
        <div className="h-16 bg-border rounded" />
      </div>
    )
  }

  if (!data) {
    return (
      <p className="font-mono text-[11px] text-text-faint">
        Not enough data for token distribution.
      </p>
    )
  }

  const promptWarn  = data.p95PromptTokens     > maxPromptTokens
  const complWarn   = data.p95CompletionTokens > maxCompletionTokens
  const hasWarning  = promptWarn || complWarn

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
        <span className="text-text text-center">{data.p50PromptTokens.toLocaleString()}</span>
        <span className={cn('text-center font-medium', promptWarn ? 'text-warn' : 'text-text')}>
          {data.p95PromptTokens.toLocaleString()}
        </span>
        <span className="text-text-muted text-center">{data.p99PromptTokens.toLocaleString()}</span>
        <span className={cn('text-right', promptWarn ? 'text-warn' : 'text-text-faint')}>
          ≤ {maxPromptTokens.toLocaleString()}
          {promptWarn ? ' ⚠' : ' ✓'}
        </span>
      </div>

      {/* Completion row */}
      <div
        className="font-mono text-[11px]"
        style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr 1fr 80px', gap: 8, alignItems: 'center' }}
      >
        <span className="text-text-faint">Completion</span>
        <span className="text-text text-center">{data.p50CompletionTokens.toLocaleString()}</span>
        <span className={cn('text-center font-medium', complWarn ? 'text-warn' : 'text-text')}>
          {data.p95CompletionTokens.toLocaleString()}
        </span>
        <span className="text-text-muted text-center">{data.p99CompletionTokens.toLocaleString()}</span>
        <span className={cn('text-right', complWarn ? 'text-warn' : 'text-text-faint')}>
          ≤ {maxCompletionTokens.toLocaleString()}
          {complWarn ? ' ⚠' : ' ✓'}
        </span>
      </div>

      {hasWarning && (
        <div className="border border-warn/30 bg-warn/5 rounded-[5px] px-3 py-2 font-mono text-[10.5px] text-warn leading-relaxed">
          P95 exceeds the substitute envelope
          {promptWarn && complWarn ? ' for both prompt and completion' : promptWarn ? ' for prompt tokens' : ' for completion tokens'}.
          {' '}Some requests may degrade in quality on {model.split('/').pop() ?? 'the suggested model'} — run a shadow comparison first.
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RecommendationsPage() {
  const [hours, setHours] = useState<number>(24 * 7)
  const { data, isLoading, error } = useRecommendations({ hours, minSavings: 5 })

  // SSR/hydration-safe: initialize with empty / defaults, restore from localStorage after mount
  const [dismissed,      setDismissed]      = useState<Set<string>>(new Set())
  const [sortFilter,     setSortFilter]      = useState<SortFilterState>(DEFAULT_SORT_FILTER)
  const [isLoaded,       setIsLoaded]        = useState(false)
  const [showHidden,     setShowHidden]      = useState(false)
  const [showAchieved,   setShowAchieved]    = useState(false)
  const [simRec,         setSimRec]          = useState<ModelRecommendation | null>(null)

  // Mount: restore persisted state from localStorage
  useEffect(() => {
    setDismissed(loadDismissed())
    setSortFilter(loadSortFilter())
    setIsLoaded(true)
  }, [])

  // Persist dismissed
  useEffect(() => {
    if (!isLoaded) return
    try { localStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify([...dismissed])) } catch { /* quota */ }
  }, [dismissed, isLoaded])

  // Persist sort/filter
  useEffect(() => {
    if (!isLoaded) return
    try { localStorage.setItem(SORT_FILTER_STORAGE_KEY, JSON.stringify(sortFilter)) } catch { /* quota */ }
  }, [sortFilter, isLoaded])

  function dismiss(r: ModelRecommendation) {
    setDismissed((prev) => new Set([...prev, dismissKey(r)]))
  }
  function unhide(r: ModelRecommendation) {
    setDismissed((prev) => { const n = new Set(prev); n.delete(dismissKey(r)); return n })
  }
  function updateSort(sortKey: SortKey)               { setSortFilter((p) => ({ ...p, sortKey })) }
  function updateFilterProvider(v: ProviderFilter)    { setSortFilter((p) => ({ ...p, filterProvider: v })) }
  function updateFilterConf(v: ConfFilter)            { setSortFilter((p) => ({ ...p, filterConf: v })) }

  const all = data ?? []

  // Partition into achieved / open / hidden
  const notDismissed  = all.filter((r) => !dismissed.has(dismissKey(r)))
  const achieved      = notDismissed.filter((r) => r.achieved)
  const openAll       = notDismissed.filter((r) => !r.achieved)

  // Apply sort + filter to the open list only (achieved has its own section)
  const filterActive =
    sortFilter.filterProvider !== 'all' || sortFilter.filterConf !== 'all'
  const openFiltered  = applyFilter(openAll, sortFilter.filterProvider, sortFilter.filterConf)
  const openSorted    = applySort(openFiltered, sortFilter.sortKey)

  // Totals are computed on unfiltered open set so the hero tile isn't misleading
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

  // ── Percentiles hook (always called, enabled only when dialog is open) ────
  const percentiles = usePercentiles({
    provider: simRec?.currentProvider ?? '',
    model:    simRec?.currentModel    ?? '',
    hours,
    enabled:  simRec !== null,
  })

  // ── Row renderer ──────────────────────────────────────────────────────────

  function RecRow({
    r,
    isHidden = false,
    isAchieved = false,
  }: {
    r: ModelRecommendation
    isHidden?: boolean
    isAchieved?: boolean
  }) {
    const conf = getConfidence(r)
    const dropPct = r.priorWindowCostUsd && r.priorWindowCostUsd > 0
      ? (r.priorWindowCostUsd - r.totalCostUsdLastNDays) / r.priorWindowCostUsd
      : null

    return (
      <div
        className="border-b border-border hover:bg-bg-elev transition-colors"
        style={{
          display: 'grid',
          gridTemplateColumns: '1.7fr 170px 130px 150px 120px',
          gap: 16,
          alignItems: 'center',
          padding: '14px 22px',
          minWidth: '700px',
        }}
      >
        {/* Title + from/to */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {isAchieved ? (
              <span className="font-mono text-[9px] px-[6px] py-[1px] rounded-[3px] border uppercase tracking-[0.04em] border-good/40 bg-good/10 text-good">
                ACHIEVED
              </span>
            ) : (
              <span className={cn(
                'font-mono text-[9px] px-[6px] py-[1px] rounded-[3px] border uppercase tracking-[0.04em]',
                isHidden
                  ? 'border-border bg-bg text-text-faint'
                  : 'border-accent-border bg-accent-bg text-accent',
              )}>
                SWAP
              </span>
            )}
            <span className={cn('text-[13.5px] font-medium truncate', isHidden ? 'text-text-muted' : 'text-text')}>
              {r.currentProvider} / {r.currentModel} → {r.suggestedProvider} / {r.suggestedModel}
            </span>
          </div>
          <div className="font-mono text-[11.5px] text-text-muted flex items-center gap-2 flex-wrap">
            <span className="text-text-faint line-through">{r.currentProvider} / {r.currentModel}</span>
            <span className="text-text-faint">→</span>
            <span className={cn(isHidden ? 'text-text-faint' : 'text-text')}>{r.suggestedProvider} / {r.suggestedModel}</span>
          </div>
          <p className="text-[12px] text-text-faint mt-1 leading-relaxed">{r.reason}</p>
          {isAchieved && dropPct !== null && (
            <p className="font-mono text-[10.5px] text-good mt-1">
              usage dropped {fmtPct(dropPct)} vs prior {windowLabel}
            </p>
          )}
        </div>

        {/* Savings */}
        <div>
          {isAchieved ? (
            <>
              <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.03em] mb-[3px]">ACTUAL / MO</div>
              <div className="font-mono text-[18px] font-medium tracking-[-0.3px] text-good">
                {r.actualMonthlySavingsUsd != null ? fmtUsd(r.actualMonthlySavingsUsd) : '—'}
              </div>
              <div className="font-mono text-[10.5px] text-text-faint mt-0.5">
                est. {fmtUsd(r.estimatedMonthlySavingsUsd)} projected
              </div>
            </>
          ) : (
            <>
              <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.03em] mb-[3px]">SAVE / MO</div>
              <div className={cn('font-mono text-[18px] font-medium tracking-[-0.3px]', isHidden ? 'text-text-muted' : 'text-accent')}>
                {fmtUsd(r.estimatedMonthlySavingsUsd)}
              </div>
              <div className="font-mono text-[10.5px] text-text-faint mt-0.5">
                was {fmtUsd(r.totalCostUsdLastNDays)} /{windowLabel}
              </div>
            </>
          )}
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
          {!isAchieved && (
            <button
              type="button"
              onClick={() => setSimRec(r)}
              className="font-mono text-[10.5px] text-text-muted px-[10px] py-[4px] border border-border rounded-[5px] hover:text-text transition-colors"
            >
              Simulate
            </button>
          )}
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
        </div>
      </div>
    )
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
            <div className="font-mono text-[10px] text-text-muted mb-1.5">
              across <span className="text-text">{openAll.length}</span> recommendations
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
              <div className="font-mono text-[10px] text-good mb-0.5">
                {fmtUsd(highConf.reduce((s, r) => s + r.estimatedMonthlySavingsUsd, 0))} / mo high-conf
              </div>
            )}
            {totalAchieved > 0 && (
              <div className="font-mono text-[10px] text-good">
                {fmtUsd(totalAchieved)} / mo achieved ✓
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
              label: 'Open',
              value: String(openAll.length),
              delta: 'model swaps',
              good: false,
            },
            {
              label: achieved.length > 0 ? 'Achieved' : (bestConfLevel ? `${bestConfLevel.charAt(0).toUpperCase() + bestConfLevel.slice(1)} conf.` : 'Confidence'),
              value: achieved.length > 0 ? fmtUsd(totalAchieved) : (bestConfLevel !== null ? String(bestConfCount) : '—'),
              delta: achieved.length > 0 ? `${achieved.length} swap${achieved.length > 1 ? 's' : ''} adopted` : (bestConfLevel ? bestConfLabel[bestConfLevel] : 'no recommendations yet'),
              good: achieved.length > 0 || bestConfLevel === 'high',
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
      <div className="flex items-center gap-2 px-[22px] py-[10px] border-b border-border shrink-0 flex-wrap">
        <span className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em]">Type</span>
        <span className="font-mono text-[11px] text-text px-[9px] py-[3px] border border-border-strong bg-bg-elev rounded-[4px]">
          model swap · {openSorted.length}{filterActive ? ` / ${openAll.length}` : ''}
        </span>

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
          {sortLabel}
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
            {/* Empty state */}
            {openAll.length === 0 && achieved.length === 0 && (
              dismissed.size > 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3 text-text-muted">
                  <p className="text-[13px]">All recommendations are hidden.</p>
                  <p className="font-mono text-[12px]">
                    Use{' '}
                    <button type="button" className="text-text underline underline-offset-2 hover:no-underline" onClick={() => setShowHidden(true)}>
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
                      <button type="button" className="text-text underline underline-offset-2 hover:no-underline" onClick={() => setHours(24 * 30)}>
                        30d
                      </button>
                      {' '}to capture more data.
                    </p>
                  )}
                </div>
              )
            )}

            {/* Filter empty state */}
            {openAll.length > 0 && openSorted.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-text-muted">
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
              <div className="flex items-center gap-2.5 px-[22px] py-[10px] bg-bg-muted border-b border-border border-t border-t-border">
                <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-accent">
                  Open · {openSorted.length}{filterActive && openSorted.length < openAll.length ? ` (${openAll.length} total)` : ''} · {fmtUsd(totalOpen)} / mo
                </span>
              </div>
            )}
            {openSorted.map((r, i) => (
              <RecRow key={`${r.currentProvider}-${r.currentModel}-${i}`} r={r} />
            ))}

            {/* Achieved section */}
            {achieved.length > 0 && (
              <>
                <div className="flex items-center gap-2.5 px-[22px] py-[10px] bg-bg-muted border-b border-border border-t border-t-border">
                  <button
                    type="button"
                    onClick={() => setShowAchieved((v) => !v)}
                    className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.06em] text-good hover:opacity-80 transition-opacity"
                  >
                    <span>Achieved · {achieved.length} · {fmtUsd(totalAchieved)} / mo</span>
                    <span>{showAchieved ? '▲' : '▼'}</span>
                  </button>
                </div>
                {showAchieved && achieved.map((r) => (
                  <RecRow
                    key={`${r.currentProvider}-${r.currentModel}-achieved`}
                    r={r}
                    isAchieved
                  />
                ))}
              </>
            )}

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

              {/* Cost summary */}
              <div className="rounded-lg border border-border bg-bg-elev p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3 font-mono text-[11.5px]">
                  <div>
                    <div className="text-text-faint uppercase text-[10px] tracking-[0.05em] mb-1">Last {windowLabel}</div>
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

              {/* Token distribution */}
              {percentiles.isLoading ? (
                <div className="rounded-lg border border-border bg-bg-elev p-4 space-y-2 animate-pulse">
                  <div className="h-3 w-36 bg-border rounded" />
                  <div className="h-16 bg-border rounded" />
                </div>
              ) : (
                <PercentileGrid
                  provider={simRec.currentProvider}
                  model={simRec.currentModel}
                  hours={hours}
                  maxPromptTokens={simRec.maxPromptTokens}
                  maxCompletionTokens={simRec.maxCompletionTokens}
                  windowLabel={windowLabel}
                />
              )}

              <p className="text-[12px]">
                <span className="text-text font-medium">Caveat:</span> {simRec.reason}. Always run a
                shadow comparison before switching a production model.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
