'use client'
import { useState, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRecommendations, type ModelRecommendation } from '@/lib/queries/use-recommendations'
import { usePercentiles } from '@/lib/queries/use-recommendation-percentiles'
import { usePrompts, usePlaygroundRun, type PlaygroundResult } from '@/lib/queries/use-prompts'
import { useProviderKeys } from '@/lib/queries/use-provider-keys'
import { useModels } from '@/lib/queries/use-models'
import { Topbar, LiveDot } from '@/components/layout/topbar'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

// Hydration-safe mounted gate, same pattern as the other overhauled pages.
const subscribeNoop = () => () => {}
const getTrue = () => true
const getFalse = () => false
function useMounted(): boolean {
  return useSyncExternalStore(subscribeNoop, getTrue, getFalse)
}

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

function loadDismissed(): Set<string> {
  if (typeof window === 'undefined') return new Set()
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

// ── SelectControl ─────────────────────────────────────────────────────────────

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
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-auto h-auto py-[3px] text-[10.5px] text-text-muted rounded-[4px] hover:border-border-strong transition-colors">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// ── PercentileGrid ────────────────────────────────────────────────────────────

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
          {' '}Some requests may degrade in quality on {model.split('/').pop() ?? 'the suggested model'}, run a shadow comparison first.
        </div>
      )}
    </div>
  )
}

// ── Playground compare dialog ─────────────────────────────────────────────────

function ResultPanel({
  data,
  error,
  isPending,
  compareTo,
}: {
  data: PlaygroundResult | undefined
  error: Error | null
  isPending: boolean
  compareTo?: PlaygroundResult | undefined
}) {
  if (isPending) {
    return (
      <div className="space-y-2 animate-pulse pt-3">
        <div className="h-3 w-28 bg-border rounded" />
        <div className="h-16 bg-border rounded" />
        <div className="h-24 bg-border rounded" />
      </div>
    )
  }
  if (error) {
    return (
      <div className="mt-3 rounded-[5px] border border-bad/30 bg-bad/5 px-3 py-2 overflow-hidden">
        <p className="font-mono text-[11px] text-bad leading-relaxed break-all">{error.message}</p>
      </div>
    )
  }
  if (!data) return null

  const costDelta = compareTo?.costUsd != null && data.costUsd != null
    ? data.costUsd - compareTo.costUsd
    : null
  const latDelta = compareTo != null ? data.latencyMs - compareTo.latencyMs : null

  return (
    <div className="pt-3 space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {[
          {
            label: 'Cost',
            value: data.costUsd != null ? `$${data.costUsd.toFixed(5)}` : '—',
            delta: costDelta != null
              ? costDelta < 0 ? `↓ $${Math.abs(costDelta).toFixed(5)}` : costDelta > 0 ? `↑ $${costDelta.toFixed(5)}` : null
              : null,
            deltaGood: costDelta != null && costDelta < 0,
          },
          {
            label: 'Latency',
            value: `${data.latencyMs}ms`,
            delta: latDelta != null
              ? latDelta < 0 ? `↓ ${Math.abs(latDelta)}ms` : latDelta > 0 ? `↑ ${latDelta}ms` : null
              : null,
            deltaGood: latDelta != null && latDelta < 0,
          },
          {
            label: 'Tokens',
            value: data.totalTokens.toLocaleString(),
            delta: null,
            deltaGood: false,
          },
        ].map((m) => (
          <div key={m.label}>
            <div className="font-mono text-[10px] text-text-faint mb-0.5">{m.label}</div>
            <div className="font-mono text-[12px] font-medium text-text">{m.value}</div>
            {m.delta && (
              <div className={cn('font-mono text-[10px] mt-0.5', m.deltaGood ? 'text-good' : 'text-warn')}>
                {m.delta}
              </div>
            )}
          </div>
        ))}
      </div>
      <div>
        <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.04em] mb-1.5">Response</div>
        <pre className="font-mono text-[11px] text-text bg-bg rounded-[5px] p-2.5 max-h-44 overflow-y-auto whitespace-pre-wrap border border-border leading-relaxed">
          {data.responseText || '(empty)'}
        </pre>
      </div>
    </div>
  )
}

function ComparePlaygroundDialog({
  rec,
  hours,
  onClose,
}: {
  rec: ModelRecommendation
  hours: number
  onClose: () => void
}) {
  const { data: prompts = [], isLoading: promptsLoading } = usePrompts()
  const { data: allKeys = [], isLoading: keysLoading }    = useProviderKeys()
  const { data: modelsCatalog, isLoading: modelsLoading } = useModels()

  const [versionId, setVersionId]           = useState('')
  const [currentKeyId, setCurrentKeyId]     = useState('')
  const [suggestedKeyId, setSuggestedKeyId] = useState('')
  const [suggestedProvider, setSuggestedProvider] = useState(rec.suggestedProvider)
  const [suggestedModel, setSuggestedModel]       = useState(rec.suggestedModel)

  const currentMutation   = usePlaygroundRun()
  const suggestedMutation = usePlaygroundRun()

  const currentKeys = allKeys.filter((k) => k.provider === rec.currentProvider && k.is_active)

  // Flat list of all models except the current one, preserving provider info.
  const allModelOptions = useMemo(() => {
    if (!modelsCatalog) return []
    return (
      Object.entries(modelsCatalog) as [string, typeof modelsCatalog.openai][]
    ).flatMap(([provider, entries]) =>
      entries
        .filter((e) => !(provider === rec.currentProvider && e.model === rec.currentModel))
        .map((e) => ({ provider, model: e.model, promptPricePer1m: e.promptPricePer1m, completionPricePer1m: e.completionPricePer1m })),
    )
  }, [modelsCatalog, rec.currentProvider, rec.currentModel])

  // If the recommendation's suggestedModel is no longer in the list (deprecated),
  // fall back to the first available option without useEffect + setState.
  const { provider: effectiveSuggestedProvider, model: effectiveSuggestedModel } = useMemo(() => {
    if (allModelOptions.length === 0) return { provider: suggestedProvider, model: suggestedModel }
    const isInList = allModelOptions.some(
      (e) => e.provider === suggestedProvider && e.model === suggestedModel,
    )
    if (!isInList) {
      const first = allModelOptions[0]!
      return { provider: first.provider, model: first.model }
    }
    return { provider: suggestedProvider, model: suggestedModel }
  }, [allModelOptions, suggestedProvider, suggestedModel])

  const suggestedKeys = allKeys.filter((k) => k.provider === effectiveSuggestedProvider && k.is_active)

  // Derived auto-selections: avoid useEffect + setState for initialization.
  const effectiveVersionId      = versionId      !== '' ? versionId      : (prompts[0]?.id    ?? '')
  const effectiveCurrentKeyId   = currentKeyId   !== '' ? currentKeyId   : (currentKeys[0]?.id ?? '')
  const effectiveSuggestedKeyId = suggestedKeyId !== '' ? suggestedKeyId : (suggestedKeys[0]?.id ?? '')

  // Grouped for <optgroup> rendering.
  const modelOptionsByProvider = useMemo(() => {
    const map: Record<string, typeof allModelOptions> = {}
    for (const entry of allModelOptions) {
      ;(map[entry.provider] ??= []).push(entry)
    }
    return map
  }, [allModelOptions])

  // Dynamic savings: recalculate whenever the user picks a different suggested model.
  const dynamicSavings = useMemo(() => {
    const currentEntry = modelsCatalog?.[rec.currentProvider as keyof typeof modelsCatalog]
      ?.find((e) => e.model === rec.currentModel)
    const suggestedEntry = modelsCatalog?.[effectiveSuggestedProvider as keyof typeof modelsCatalog]
      ?.find((e) => e.model === effectiveSuggestedModel)

    if (!currentEntry || !suggestedEntry) return rec.estimatedMonthlySavingsUsd

    const avgPrompt     = rec.avgPromptTokens
    const avgCompletion = rec.avgCompletionTokens

    const currentCost   = (currentEntry.promptPricePer1m   * avgPrompt + currentEntry.completionPricePer1m   * avgCompletion) / 1_000_000
    const suggestedCost = (suggestedEntry.promptPricePer1m * avgPrompt + suggestedEntry.completionPricePer1m * avgCompletion) / 1_000_000

    if (currentCost === 0) return 0

    const monthFactor = (24 * 30) / hours
    return rec.totalCostUsdLastNDays * monthFactor * (1 - suggestedCost / currentCost)
  }, [modelsCatalog, rec, effectiveSuggestedProvider, effectiveSuggestedModel, hours])

  function handleModelSelect(value: string) {
    const sep = value.indexOf(':')
    const newProvider = value.slice(0, sep)
    const newModel    = value.slice(sep + 1)
    setSuggestedProvider(newProvider)
    setSuggestedModel(newModel)
    if (newProvider !== effectiveSuggestedProvider) setSuggestedKeyId('')
  }

  const isRunning  = currentMutation.isPending || suggestedMutation.isPending
  const hasResults = currentMutation.data !== undefined || suggestedMutation.data !== undefined
  const canRun     = !!effectiveVersionId && !!effectiveCurrentKeyId && !!effectiveSuggestedKeyId && !isRunning

  function handleRun() {
    if (!canRun) return
    void Promise.all([
      currentMutation.mutateAsync({
        promptVersionId: effectiveVersionId,
        providerKeyId:   effectiveCurrentKeyId,
        model:           rec.currentModel,
      }),
      suggestedMutation.mutateAsync({
        promptVersionId: effectiveVersionId,
        providerKeyId:   effectiveSuggestedKeyId,
        model:           effectiveSuggestedModel,
      }),
    ])
  }

  const selectClass =
    'w-full font-mono text-[11.5px] text-text px-3 py-2 border border-border rounded-[5px] bg-bg focus:outline-none focus:border-border-strong appearance-none cursor-pointer disabled:opacity-50'

  const savingsPositive = dynamicSavings > 0

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
              <span className="font-medium text-text">{effectiveSuggestedModel}</span>
              {' '}
              {savingsPositive
                ? <>could save <span className="font-medium text-good">${dynamicSavings.toFixed(0)}/mo</span></>
                : <>would cost <span className="font-medium text-bad">${Math.abs(dynamicSavings).toFixed(0)}/mo more</span></>
              }
            </div>
          </div>

          {/* Prompt version — shared, full-width */}
          <div>
            <label className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] mb-1.5 block">
              Prompt version
            </label>
            <Select {...(effectiveVersionId ? { value: effectiveVersionId } : {})} onValueChange={setVersionId} disabled={promptsLoading}>
              <SelectTrigger className={selectClass}><SelectValue placeholder={promptsLoading ? 'Loading…' : prompts.length === 0 ? 'No prompts — create one first' : 'Select a prompt version…'} /></SelectTrigger>
              <SelectContent>
                {prompts.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name} · v{p.version}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Two-column model cards */}
          <div className="grid grid-cols-2 gap-3">

            {/* ── Current model card (read-only) ── */}
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
                <Select {...(effectiveCurrentKeyId ? { value: effectiveCurrentKeyId } : {})} onValueChange={setCurrentKeyId} disabled={keysLoading}>
                  <SelectTrigger className={selectClass}><SelectValue placeholder={keysLoading ? 'Loading…' : currentKeys.length === 0 ? 'No active keys' : 'Select key…'} /></SelectTrigger>
                  <SelectContent>
                    {currentKeys.map((k) => (
                      <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!keysLoading && currentKeys.length === 0 && (
                  <p className="font-mono text-[10.5px] text-bad mt-1">
                    No active {rec.currentProvider} keys found.
                  </p>
                )}
              </div>
              {(currentMutation.data !== undefined || currentMutation.error || currentMutation.isPending) && (
                <ResultPanel
                  data={currentMutation.data}
                  error={currentMutation.error}
                  isPending={currentMutation.isPending}
                />
              )}
            </div>

            {/* ── Suggested model card (editable) ── */}
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

              {/* Model selector */}
              <div>
                <label className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] mb-1.5 block">
                  Model
                </label>
                <Select value={`${effectiveSuggestedProvider}:${effectiveSuggestedModel}`} onValueChange={handleModelSelect} disabled={modelsLoading}>
                  <SelectTrigger className={selectClass}><SelectValue placeholder={modelsLoading ? 'Loading models…' : undefined} /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(modelOptionsByProvider).map(([provider, entries]) => (
                      <SelectGroup key={provider}>
                        <SelectLabel>{provider}</SelectLabel>
                        {entries.map((e) => (
                          <SelectItem key={`${provider}:${e.model}`} value={`${provider}:${e.model}`}>{e.model}</SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* API Key */}
              <div>
                <label className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] mb-1.5 block">
                  API Key
                </label>
                <Select {...(effectiveSuggestedKeyId ? { value: effectiveSuggestedKeyId } : {})} onValueChange={setSuggestedKeyId} disabled={keysLoading}>
                  <SelectTrigger className={selectClass}><SelectValue placeholder={keysLoading ? 'Loading…' : suggestedKeys.length === 0 ? 'No active keys' : 'Select key…'} /></SelectTrigger>
                  <SelectContent>
                    {suggestedKeys.map((k) => (
                      <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!keysLoading && suggestedKeys.length === 0 && (
                  <p className="font-mono text-[10.5px] text-bad mt-1">
                    No active {effectiveSuggestedProvider} keys found.
                  </p>
                )}
              </div>

              {(suggestedMutation.data !== undefined || suggestedMutation.error || suggestedMutation.isPending) && (
                <ResultPanel
                  data={suggestedMutation.data}
                  error={suggestedMutation.error}
                  isPending={suggestedMutation.isPending}
                  compareTo={currentMutation.data}
                />
              )}
            </div>
          </div>

          {/* Run button */}
          <button
            type="button"
            onClick={handleRun}
            disabled={!canRun}
            className={cn(
              'w-full font-mono text-[12.5px] px-4 py-3 rounded-[6px] transition-colors font-medium',
              canRun
                ? 'bg-text text-bg hover:bg-text/90 cursor-pointer'
                : 'bg-border text-text-faint cursor-not-allowed opacity-60',
            )}
          >
            {isRunning ? 'Running…' : hasResults ? 'Run again' : 'Run comparison'}
          </button>

          {hasResults && (
            <p className="font-mono text-[10.5px] text-text-faint text-center -mt-2">
              Single sample · run multiple times for statistical significance
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Page Client ───────────────────────────────────────────────────────────────

export function SavingsClient() {
  const router = useRouter()
  const sp = useSearchParams()
  const mounted = useMounted()

  // URL-backed window + sort + filter state. Shareable view + survives reload.
  const windowParam = sp.get('window')
  const hours = (windowParam === '14d' ? 24 * 14 : windowParam === '30d' ? 24 * 30 : 24 * 7)
  const sortFilter: SortFilterState = {
    sortKey:       (sp.get('sort') as SortKey)         ?? DEFAULT_SORT_FILTER.sortKey,
    filterProvider:(sp.get('provider') as ProviderFilter) ?? DEFAULT_SORT_FILTER.filterProvider,
    filterConf:    (sp.get('conf') as ConfFilter)      ?? DEFAULT_SORT_FILTER.filterConf,
  }

  function updateQuery(updates: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString())
    Object.entries(updates).forEach(([k, v]) => {
      if (v == null || v === '') next.delete(k)
      else next.set(k, v)
    })
    router.replace(`/savings?${next.toString()}`)
  }
  function setHoursUrl(h: number) {
    const label = h === 24 * 14 ? '14d' : h === 24 * 30 ? '30d' : null
    updateQuery({ window: label })
  }
  function updateSort(sortKey: SortKey)            { updateQuery({ sort: sortKey === 'savings' ? null : sortKey }) }
  function updateFilterProvider(v: ProviderFilter) { updateQuery({ provider: v === 'all' ? null : v }) }
  function updateFilterConf(v: ConfFilter)         { updateQuery({ conf: v === 'all' ? null : v }) }

  const { data, isLoading, isFetching, error, refetch } = useRecommendations({ hours, minSavings: 5 })

  // dismissed stays in localStorage — it's per-user/per-browser preference and
  // there's no value in encoding it in a shareable URL.
  const [dismissed,    setDismissed]    = useState<Set<string>>(() => new Set())
  const [showHidden,   setShowHidden]   = useState(false)
  const [showAchieved, setShowAchieved] = useState(false)
  const [simRec,       setSimRec]       = useState<ModelRecommendation | null>(null)
  const [compareRec,   setCompareRec]   = useState<ModelRecommendation | null>(null)
  // Inline undo affordance after Hide — auto-clears after 5s so it doesn't
  // accumulate. Cleaner than introducing a toast lib for one action.
  const [lastDismissed, setLastDismissed] = useState<ModelRecommendation | null>(null)

  // Load persisted state after mount to avoid SSR/client mismatch (React #418).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time mount hydration from localStorage, no derived-state path
    setDismissed(loadDismissed())
  }, [])

  // Persist changes back to localStorage.
  useEffect(() => {
    if (!mounted) return  // skip the SSR/first-paint defaults write
    try { localStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify([...dismissed])) } catch { /* quota */ }
  }, [dismissed, mounted])

  // Auto-dismiss the undo affordance after 5 seconds.
  useEffect(() => {
    if (!lastDismissed) return
    const id = setTimeout(() => setLastDismissed(null), 5000)
    return () => clearTimeout(id)
  }, [lastDismissed])

  function dismiss(r: ModelRecommendation) {
    setDismissed((prev) => new Set([...prev, dismissKey(r)]))
    setLastDismissed(r)
  }
  function unhide(r: ModelRecommendation) {
    setDismissed((prev) => { const n = new Set(prev); n.delete(dismissKey(r)); return n })
    if (lastDismissed && dismissKey(lastDismissed) === dismissKey(r)) setLastDismissed(null)
  }

  const all = data ?? []

  const notDismissed  = all.filter((r) => !dismissed.has(dismissKey(r)))
  const achieved      = notDismissed.filter((r) => r.achieved)
  const openAll       = notDismissed.filter((r) => !r.achieved)

  const filterActive =
    sortFilter.filterProvider !== 'all' || sortFilter.filterConf !== 'all'
  const openFiltered  = applyFilter(openAll, sortFilter.filterProvider, sortFilter.filterConf)
  const openSorted    = applySort(openFiltered, sortFilter.sortKey)

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

  const percentiles = usePercentiles({
    provider: simRec?.currentProvider ?? '',
    model:    simRec?.currentModel    ?? '',
    hours,
    enabled:  simRec !== null,
  })

  // Section anchors for the clickable hero strip — hovering hero card
  // scrolls to the matching section instead of forcing the user to find it
  // by eye. Same pattern as anomalies / security.
  const openRef     = useRef<HTMLDivElement>(null)
  const achievedRef = useRef<HTMLDivElement>(null)
  const hiddenRef   = useRef<HTMLDivElement>(null)
  function scrollTo(ref: React.RefObject<HTMLDivElement | null>) {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // CSV / JSON export — finance reconciliation use case. Client-side build
  // matches the dashboard pattern (RFC 4180 escaping).
  function csvField(v: string | number): string {
    const s = String(v)
    return /["\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  function csvRow(cells: (string | number)[]): string {
    return cells.map(csvField).join(',')
  }
  function downloadFile(content: string, mime: string, ext: string) {
    const blob = new Blob([content], { type: `${mime};charset=utf-8;` })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `spanlens-savings-${windowLabel}-${new Date().toISOString().slice(0, 10)}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }
  function exportCsv() {
    const lines: string[] = []
    lines.push(csvRow([`Savings (${windowLabel})`]))
    lines.push(csvRow(['Status', 'Current Provider', 'Current Model', 'Suggested Provider', 'Suggested Model', 'Est. $/mo', 'Actual $/mo', 'Samples', 'Confidence', 'Reason']))
    for (const r of openSorted) {
      lines.push(csvRow([
        'open', r.currentProvider, r.currentModel, r.suggestedProvider, r.suggestedModel,
        r.estimatedMonthlySavingsUsd.toFixed(2), '', r.sampleCount, getConfidence(r), r.reason,
      ]))
    }
    for (const r of achieved) {
      lines.push(csvRow([
        'achieved', r.currentProvider, r.currentModel, r.suggestedProvider, r.suggestedModel,
        r.estimatedMonthlySavingsUsd.toFixed(2), (r.actualMonthlySavingsUsd ?? 0).toFixed(2), r.sampleCount, getConfidence(r), r.reason,
      ]))
    }
    downloadFile(lines.join('\n'), 'text/csv', 'csv')
  }
  function exportJson() {
    const payload = {
      window: windowLabel,
      open:     openSorted.map((r) => ({ ...r, confidence: getConfidence(r) })),
      achieved: achieved.map((r)   => ({ ...r, confidence: getConfidence(r) })),
    }
    downloadFile(JSON.stringify(payload, null, 2), 'application/json', 'json')
  }
  const [exportOpen, setExportOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!exportOpen) return
    function onDown(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setExportOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [exportOpen])

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
        className={cn(
          'border-b border-border hover:bg-bg-elev transition-colors',
          // Low-confidence rows get a faint left rule so the visual signal
          // matches the badge state without yelling at the user.
          !isAchieved && conf === 'low' && 'border-l-2 border-l-text-faint/40',
        )}
        style={{
          display: 'grid',
          gridTemplateColumns: '1.7fr 170px 130px 150px 120px',
          gap: 16,
          alignItems: 'center',
          padding: '14px 22px',
          minWidth: '700px',
        }}
      >
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

        <div>
          <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.03em] mb-[3px]">SAMPLES</div>
          <div className={cn('text-[12.5px]', isHidden ? 'text-text-muted' : 'text-text')}>{r.sampleCount.toLocaleString()}</div>
          <div className="font-mono text-[10.5px] text-text-faint mt-0.5">~{Math.round(r.avgCompletionTokens)} output tk</div>
        </div>

        <div>
          <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.03em] mb-[5px]">CONFIDENCE</div>
          <ConfidenceBar level={conf} />
          <div className="font-mono text-[10.5px] text-text-faint mt-1" title={CONFIDENCE_CRITERIA[conf]}>
            {conf === 'high' ? '≥$40/mo · ≥100 req' : conf === 'medium' ? '≥$10/mo · ≥30 req' : `${r.sampleCount} req · <30 or <$10/mo`}
          </div>
        </div>

        <div className="flex justify-end gap-1.5 flex-wrap">
          {!isAchieved && (
            <>
              <button
                type="button"
                onClick={() => setCompareRec(r)}
                className="font-mono text-[10.5px] text-text-muted px-[10px] py-[4px] border border-border rounded-[5px] hover:text-text transition-colors"
              >
                Compare
              </button>
              <button
                type="button"
                onClick={() => setSimRec(r)}
                className="font-mono text-[10.5px] text-text-muted px-[10px] py-[4px] border border-border rounded-[5px] hover:text-text transition-colors"
              >
                Simulate
              </button>
            </>
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
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col min-h-screen">
      <div className="sticky top-0 z-20 bg-bg">
        <Topbar
          crumbs={[{ label: 'Savings' }]}
          right={
            <div className="flex items-center gap-3">
              <LiveDot refetching={isFetching} />
              <div className="flex items-center gap-1">
                {WINDOW_OPTIONS.map((opt) => (
                  <button
                    key={opt.hours}
                    type="button"
                    onClick={() => setHoursUrl(opt.hours)}
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
              <button
                type="button"
                onClick={() => void refetch()}
                disabled={isFetching}
                title="Refresh now"
                className="font-mono text-[11px] text-text-muted hover:text-text border border-border rounded px-2 py-1 transition-colors disabled:opacity-40"
              >
                <span className={cn('inline-block', isFetching && 'animate-spin')}>↻</span>
              </button>
            </div>
          }
        />
        <h1 className="sr-only">Savings</h1>
      </div>

      {/* Hero strip — Open / Achieved cards are buttons that scroll to the
          matching section when populated. Same pattern as anomalies / security. */}
      <div className="overflow-x-auto shrink-0 border-b border-border">
        <div className="grid min-w-[700px]" style={{ gridTemplateColumns: '1.25fr 1fr 1fr 1fr' }}>
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
              ref: null,
              onClick: null,
            },
            {
              label: 'Open',
              value: String(openAll.length),
              delta: 'model swaps',
              good: false,
              ref: openRef,
              onClick: openAll.length > 0 ? () => scrollTo(openRef) : null,
            },
            {
              label: achieved.length > 0 ? 'Achieved' : (bestConfLevel ? `${bestConfLevel.charAt(0).toUpperCase() + bestConfLevel.slice(1)} conf.` : 'Confidence'),
              value: achieved.length > 0 ? fmtUsd(totalAchieved) : (bestConfLevel !== null ? String(bestConfCount) : '—'),
              delta: achieved.length > 0 ? `${achieved.length} swap${achieved.length > 1 ? 's' : ''} adopted` : (bestConfLevel ? bestConfLabel[bestConfLevel] : 'no recommendations yet'),
              good: achieved.length > 0 || bestConfLevel === 'high',
              ref: achievedRef,
              onClick: achieved.length > 0 ? () => { setShowAchieved(true); setTimeout(() => scrollTo(achievedRef), 60) } : null,
            },
          ].map((s, i) => {
            const Wrap: React.ElementType = s.onClick ? 'button' : 'div'
            return (
              <Wrap
                key={i}
                {...(s.onClick ? { type: 'button', onClick: s.onClick } : {})}
                className={cn(
                  'px-[16px] py-[16px] text-left',
                  i < 2 && 'border-r border-border',
                  s.onClick && 'hover:bg-bg-elev transition-colors cursor-pointer',
                )}
              >
                <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">{s.label}</div>
                <div className={cn('text-[28px] font-medium leading-none tracking-[-0.8px]', s.good ? 'text-good' : 'text-text')}>
                  {s.value}
                </div>
                <div className="font-mono text-[10px] text-text-muted mt-1.5 whitespace-nowrap">{s.delta}</div>
              </Wrap>
            )
          })}
        </div>
      </div>

      {/* Filter row — "Type · model swap" chip dropped (single value, no filter
          purpose). Open count moves into the section header below. */}
      <div className="flex items-center gap-2 px-[22px] py-[10px] border-b border-border shrink-0 flex-wrap">
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

        <div ref={exportRef} className="relative">
          <button
            type="button"
            onClick={() => setExportOpen((v) => !v)}
            disabled={openSorted.length === 0 && achieved.length === 0}
            className="font-mono text-[11px] text-text-muted hover:text-text border border-border rounded px-2.5 py-1 transition-colors disabled:opacity-40"
          >
            Export ▾
          </button>
          {exportOpen && (
            <div className="absolute right-0 top-full mt-1 z-30 bg-bg-elev border border-border rounded-md shadow-lg py-1 min-w-[110px]">
              <button
                type="button"
                onClick={() => { setExportOpen(false); exportCsv() }}
                className="block w-full px-3 py-1.5 text-left font-mono text-[11px] uppercase tracking-[0.04em] text-text-muted hover:text-text hover:bg-bg transition-colors"
              >CSV</button>
              <button
                type="button"
                onClick={() => { setExportOpen(false); exportJson() }}
                className="block w-full px-3 py-1.5 text-left font-mono text-[11px] uppercase tracking-[0.04em] text-text-muted hover:text-text hover:bg-bg transition-colors"
              >JSON</button>
            </div>
          )}
        </div>

        <span className="hidden sm:inline font-mono text-[10px] text-text-faint whitespace-nowrap shrink-0">
          {sortLabel}
        </span>
      </div>

      {/* Inline undo affordance for the most recent Hide. Auto-clears in 5s. */}
      {mounted && lastDismissed && (
        <div className="flex items-center gap-3 px-[22px] py-[8px] bg-bg-muted border-b border-border font-mono text-[11px]">
          <span className="text-text-faint">
            Hidden <span className="text-text">{lastDismissed.currentProvider} / {lastDismissed.currentModel}</span>.
          </span>
          <button
            type="button"
            onClick={() => { unhide(lastDismissed); }}
            className="text-accent hover:underline"
          >
            Undo
          </button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => setLastDismissed(null)}
            className="text-text-faint hover:text-text-muted"
            aria-label="Dismiss undo"
          >
            ✕
          </button>
        </div>
      )}

      {/* Content */}
      <div>
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
                      <button type="button" className="text-text underline underline-offset-2 hover:no-underline" onClick={() => setHoursUrl(24 * 30)}>
                        30d
                      </button>
                      {' '}to capture more data.
                    </p>
                  )}
                  <Link
                    href="/docs/features/savings"
                    className="font-mono text-[11px] mt-2 px-2.5 py-1 rounded border border-border text-text-muted hover:text-text hover:border-border-strong transition-colors"
                  >
                    How recommendations work →
                  </Link>
                </div>
              )
            )}

            {openAll.length > 0 && openSorted.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-text-muted">
                <p className="text-[13px]">No recommendations match the current filters.</p>
                <button
                  type="button"
                  className="font-mono text-[11.5px] text-text underline underline-offset-2 hover:no-underline"
                  onClick={() => updateQuery({ sort: null, provider: null, conf: null })}
                >
                  Clear filters
                </button>
              </div>
            )}

            {openSorted.length > 0 && (
              <div ref={openRef} className="flex items-center gap-2.5 px-[22px] py-[10px] bg-bg-muted border-b border-border border-t border-t-border">
                <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-accent">
                  Open · {openSorted.length}{filterActive && openSorted.length < openAll.length ? ` (${openAll.length} total)` : ''} · {fmtUsd(totalOpen)} / mo
                </span>
              </div>
            )}
            {openSorted.map((r, i) => (
              <RecRow key={`${r.currentProvider}-${r.currentModel}-${i}`} r={r} />
            ))}

            {achieved.length > 0 && (
              <>
                <div ref={achievedRef} className="flex items-center gap-2.5 px-[22px] py-[10px] bg-bg-muted border-b border-border border-t border-t-border">
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

            {showHidden && dismissed.size > 0 && (
              <>
                <div ref={hiddenRef} className="flex items-center gap-2.5 px-[22px] py-[10px] bg-bg-muted border-b border-border border-t border-t-border">
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

      {/* Compare in playground dialog */}
      {compareRec && (
        <ComparePlaygroundDialog rec={compareRec} hours={hours} onClose={() => setCompareRec(null)} />
      )}

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

              <div className="rounded-lg border border-border bg-bg-elev p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3 font-mono text-[11.5px]">
                  <div>
                    <div className="text-text-faint uppercase text-[10px] tracking-[0.05em] mb-1">Last {windowLabel}</div>
                    <div className="text-text font-medium">{fmtUsd(simRec.totalCostUsdLastNDays)}</div>
                    <div className="text-text-muted text-[10.5px]">{simRec.sampleCount.toLocaleString()} requests</div>
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
                  Assumes similar token counts; real savings shift with traffic volume.
                </div>
              </div>

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
