'use client'
import { useMemo, useRef } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  useAnomalies,
  useAnomalyHistory,
  useAckAnomaly,
  useUnackAnomaly,
  type Anomaly,
  type AnomalyConfidence,
  type AnomalyContributingFactors,
  type AnomalyHistoryEntry,
  type AnomalyKind,
} from '@/lib/queries/use-anomalies'
import { Topbar, LiveDot } from '@/components/layout/topbar'
import { PermissionGate } from '@/components/permission-gate'
import { ExportDropdown } from '@/components/ui/export-dropdown'
import {
  buildInvestigateHref,
  investigateRangeForObservationHours,
  type InvestigateRange,
} from '@/lib/anomaly-investigate'
import { cn } from '@/lib/utils'

type KindFilter = 'all' | AnomalyKind
type ConfidenceFilter = 'all' | 'high' | 'medium_plus'
type WindowPreset = '1h-7d' | '24h-30d' | '7d-30d'
type HistoryDays = '7' | '30' | '90'

const KIND_FILTERS: { v: KindFilter; l: string }[] = [
  { v: 'all',        l: 'All' },
  { v: 'latency',    l: 'latency' },
  { v: 'cost',       l: 'cost' },
  { v: 'error_rate', l: 'errors' },
]

const WINDOW_PRESETS: Record<WindowPreset, { obs: number; ref: number; label: string }> = {
  '1h-7d':   { obs: 1,      ref: 24 * 7,  label: '1h vs 7d' },
  '24h-30d': { obs: 24,     ref: 24 * 30, label: '24h vs 30d' },
  '7d-30d':  { obs: 24 * 7, ref: 24 * 30, label: '7d vs 30d' },
}

const HISTORY_OPTS: HistoryDays[] = ['7', '30', '90']

function fmtValue(kind: AnomalyKind, v: number): string {
  if (kind === 'latency') return `${Math.round(v)}ms`
  if (kind === 'cost') return `$${v.toFixed(5)}`
  return `${(v * 100).toFixed(1)}%`
}

function fmtDelta(kind: AnomalyKind, current: number, baseline: number): string {
  const pct = baseline > 0 ? ((current - baseline) / baseline) * 100 : 0
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(0)}%`
}

function kindLabel(k: AnomalyKind): string {
  return { latency: 'LATENCY', cost: 'COST', error_rate: 'ERRORS' }[k] ?? k.toUpperCase()
}

// Stable display ID derived from the anomaly's natural key (provider/model/kind).
// Earlier this was `AN-${100 + idx}` which changed every time sort or filter
// shifted — same anomaly got a new ID on each render and shareable references
// became meaningless. djb2 hash → 4-char hex keeps the label short and stable
// across the page lifetime.
function anomDisplayId(provider: string, model: string, kind: AnomalyKind): string {
  const s = `${provider}|${model}|${kind}`
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) & 0xffffffff
  return `AN-${(h >>> 0).toString(16).slice(0, 4).toUpperCase()}`
}

interface AnomalyTitleFields {
  kind: AnomalyKind
  currentValue: number
  baselineMean: number
  deviations: number
}

function anomTitle(a: AnomalyTitleFields): string {
  const pct = a.baselineMean > 0 ? ((a.currentValue - a.baselineMean) / a.baselineMean * 100).toFixed(0) : '?'
  if (a.kind === 'latency') return `p95 latency · ${a.deviations.toFixed(1)}σ above mean`
  if (a.kind === 'cost') return `Spend · ${pct}% above baseline`
  return `Error rate · ${fmtValue('error_rate', a.currentValue)} (baseline ${fmtValue('error_rate', a.baselineMean)})`
}

function FactorHint({ kind, factors }: { kind: AnomalyKind; factors: AnomalyContributingFactors }) {
  if (kind === 'error_rate') {
    const codes = factors.obsStatusDistribution.slice(0, 3)
    if (codes.length === 0) return null
    return (
      <span className="font-mono text-[10px] text-text-faint">
        {codes.map((d) => `${d.code}: ${d.count} req`).join(' · ')}
      </span>
    )
  }

  const obsT = factors.obsTotalTokensMean
  const refT = factors.refTotalTokensMean
  if (!obsT || !refT || refT === 0) return null

  const totalPct = ((obsT - refT) / refT) * 100
  if (Math.abs(totalPct) < 10) return null

  const obsP = factors.obsPromptTokensMean ?? 0
  const refP = factors.refPromptTokensMean ?? 0
  const obsC = factors.obsCompletionTokensMean ?? 0
  const refC = factors.refCompletionTokensMean ?? 0
  const promptPct  = refP > 0 ? ((obsP - refP) / refP) * 100 : 0
  const completionPct = refC > 0 ? ((obsC - refC) / refC) * 100 : 0

  const main =
    Math.abs(promptPct) >= Math.abs(completionPct)
      ? { label: 'Prompt', obs: obsP, ref: refP, pct: promptPct }
      : { label: 'Completion', obs: obsC, ref: refC, pct: completionPct }

  const arrow = main.pct > 0 ? '↑' : '↓'
  const sign  = main.pct > 0 ? '+' : ''
  return (
    <span className="font-mono text-[10px] text-text-faint">
      {main.label} tokens {arrow} {Math.round(main.obs).toLocaleString()}{' '}
      <span className="text-text-faint opacity-70">(was {Math.round(main.ref).toLocaleString()}, {sign}{Math.round(main.pct)}%)</span>
    </span>
  )
}

function AnomDeltaBars({
  kind,
  currentValue,
  baselineMean,
  deviations,
}: {
  kind: AnomalyKind
  currentValue: number
  baselineMean: number
  deviations: number
}) {
  const max = Math.max(currentValue, baselineMean, 1e-9)
  const basePct = Math.max(4, (baselineMean / max) * 100)
  const nowPct = Math.max(4, (currentValue / max) * 100)
  const isHigh = deviations >= 5
  return (
    <div className="flex items-end gap-[4px] h-[18px]">
      <div
        title={`baseline ${fmtValue(kind, baselineMean)}`}
        style={{ height: `${basePct}%`, width: 8 }}
        className="rounded-[1px] bg-border-strong opacity-70"
      />
      <div
        title={`now ${fmtValue(kind, currentValue)}`}
        style={{ height: `${nowPct}%`, width: 8 }}
        className={cn('rounded-[1px]', isHigh ? 'bg-bad' : 'bg-accent')}
      />
    </div>
  )
}

interface AnomRowProps {
  a: Anomaly
  last: boolean
  onAck: () => void
  onUnack: () => void
  ackPending: boolean
  dimmed?: boolean
  /** Investigate link maps the observation window to /requests `timeRange`. */
  investigateRange: InvestigateRange
}

function AnomRow({ a, last, onAck, onUnack, ackPending, dimmed, investigateRange }: AnomRowProps) {
  const isHigh = a.deviations >= 5
  const isAcked = Boolean(a.acknowledgedAt)
  const tint = isHigh ? 'text-bad' : 'text-accent'
  const dotBg = isHigh ? 'bg-bad' : 'bg-accent'
  const anomId = anomDisplayId(a.provider, a.model, a.kind)

  const investigateHref = buildInvestigateHref(a.provider, a.model, investigateRange)

  return (
    <div
      className={cn(
        'grid items-center px-[22px] py-[12px]',
        !last && 'border-b border-border',
        isHigh && !isAcked && 'bg-accent-bg',
        dimmed && 'opacity-60',
      )}
      style={{ gridTemplateColumns: '28px 1fr 120px 150px 150px 130px', gap: 14 }}
    >
      <div className="flex items-center justify-center">
        <span
          className={cn('w-2 h-2 rounded-full', dotBg, isHigh && !isAcked && 'shadow-[0_0_0_3px_var(--accent-bg)]')}
        />
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-mono text-[10.5px] text-text-faint tracking-[0.03em]">{anomId}</span>
          <span
            className={cn(
              'font-mono text-[9px] px-[6px] py-[1px] rounded-[3px] border uppercase tracking-[0.04em]',
              isHigh && !isAcked
                ? 'text-accent border-accent-border bg-accent-bg'
                : 'text-text-muted border-border',
            )}
          >
            {kindLabel(a.kind)}
          </span>
          {a.confidence && (
            <span
              className={cn(
                'font-mono text-[9px] px-[6px] py-[1px] rounded-[3px] border uppercase tracking-[0.04em]',
                a.confidence === 'high' && 'text-text-muted border-border',
                a.confidence === 'medium' && 'text-text-muted border-border opacity-90',
                a.confidence === 'low' && 'text-text-faint border-border opacity-70',
              )}
              title={
                a.confidence === 'low'
                  ? `Low confidence, only ${a.referenceCount} baseline samples (< 30). Treat as directional only.`
                  : a.confidence === 'medium'
                    ? `Medium confidence, ${a.referenceCount} baseline samples.`
                    : `High confidence, ${a.referenceCount} baseline samples.`
              }
            >
              {a.confidence}
            </span>
          )}
          <span className="text-[13.5px] text-text font-medium truncate">{anomTitle(a)}</span>
        </div>
        <div className="font-mono text-[11px] text-text-muted tracking-[0.01em]">
          <span className="text-text-faint">target · </span>
          {a.provider} / {a.model}
        </div>
        {a.factors && (
          <div className="flex items-center gap-1 mt-[3px]">
            <span className="font-mono text-[9px] text-text-faint uppercase tracking-[0.04em] opacity-60">why ·</span>
            <FactorHint kind={a.kind} factors={a.factors} />
          </div>
        )}
      </div>

      <div>
        <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.03em] mb-[3px]">NOW · BASE</div>
        <div className="font-mono text-[12px] text-text">
          <span className="font-medium">{fmtValue(a.kind, a.currentValue)}</span>
          <span className="text-text-faint"> · </span>
          <span className="text-text-muted">{fmtValue(a.kind, a.baselineMean)}</span>
        </div>
        <div className={cn('font-mono text-[10.5px] mt-0.5', tint)}>
          {fmtDelta(a.kind, a.currentValue, a.baselineMean)}
        </div>
      </div>

      <div>
        <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.03em] mb-1">BASE · NOW</div>
        <AnomDeltaBars
          kind={a.kind}
          currentValue={a.currentValue}
          baselineMean={a.baselineMean}
          deviations={a.deviations}
        />
      </div>

      <div>
        <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.03em] mb-[3px]">IMPACT</div>
        <div className="text-[12px] text-text">{a.sampleCount} requests</div>
        <div className="font-mono text-[10.5px] text-text-faint mt-0.5">{a.deviations.toFixed(1)}σ deviation</div>
      </div>

      <div className="flex justify-end gap-1.5">
        <PermissionGate need="edit">
          <button
            type="button"
            disabled={ackPending}
            onClick={isAcked ? onUnack : onAck}
            className={cn(
              'font-mono text-[10.5px] px-2 py-[3px] border rounded-[4px] transition-colors disabled:opacity-50',
              isAcked
                ? 'text-text-muted border-border hover:text-text'
                : 'text-text-muted border-border hover:text-text hover:border-border-strong',
            )}
            title={isAcked ? 'Un-acknowledge' : 'Acknowledge this anomaly'}
          >
            {isAcked ? 'Unack' : 'Ack'}
          </button>
        </PermissionGate>
        <Link
          href={investigateHref}
          className="font-mono text-[10.5px] text-text px-2 py-[3px] border border-border-strong rounded-[4px] bg-bg-elev hover:bg-bg-muted transition-colors"
        >
          Investigate →
        </Link>
      </div>
    </div>
  )
}

function HistoryRow({ e, last }: { e: AnomalyHistoryEntry; last: boolean }) {
  return (
    <div
      className={cn('grid items-center px-[22px] py-[12px]', !last && 'border-b border-border')}
      style={{ gridTemplateColumns: '28px 1fr 120px 150px 150px 130px', gap: 14 }}
    >
      <div className="flex items-center justify-center">
        <span className="w-2 h-2 rounded-full bg-border-strong opacity-70" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-mono text-[9px] px-[6px] py-[1px] rounded-[3px] border border-border text-text-muted uppercase tracking-[0.04em]">
            {kindLabel(e.kind)}
          </span>
          <span className="text-[13px] text-text-muted truncate">{anomTitle(e)}</span>
        </div>
        <div className="font-mono text-[11px] text-text-faint">{e.provider} / {e.model}</div>
      </div>
      <div>
        <div className="font-mono text-[12px] text-text-muted">
          {fmtValue(e.kind, e.currentValue)} · {fmtValue(e.kind, e.baselineMean)}
        </div>
      </div>
      <div>
        <AnomDeltaBars
          kind={e.kind}
          currentValue={e.currentValue}
          baselineMean={e.baselineMean}
          deviations={e.deviations}
        />
      </div>
      <div className="font-mono text-[11px] text-text-faint">{e.sampleCount} req</div>
      <div className="text-right">
        <div className="font-mono text-[11px] text-text-muted">{e.detectedOn}</div>
        <div className="font-mono text-[10.5px] text-text-faint mt-0.5">{e.deviations.toFixed(1)}σ</div>
      </div>
    </div>
  )
}

function confidenceRank(c: AnomalyConfidence | undefined | null): number {
  if (c === 'high') return 3
  if (c === 'medium') return 2
  if (c === 'low') return 1
  return 0
}

export function AnomaliesClient() {
  const router = useRouter()
  const sp = useSearchParams()

  // URL-backed filter state. Lets users share a pre-filtered view and keeps
  // the filters across hard reloads.
  const kindFilter = (sp.get('kind') ?? 'all') as KindFilter
  const confFilter = (sp.get('conf') ?? 'all') as ConfidenceFilter
  const windowPreset = ((sp.get('window') as WindowPreset | null) && WINDOW_PRESETS[sp.get('window') as WindowPreset])
    ? (sp.get('window') as WindowPreset)
    : '1h-7d'
  const historyDays = (HISTORY_OPTS.includes(sp.get('history') as HistoryDays)
    ? sp.get('history')
    : '30') as HistoryDays

  function updateQuery(updates: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString())
    Object.entries(updates).forEach(([k, v]) => {
      if (v == null || v === '') next.delete(k)
      else next.set(k, v)
    })
    router.replace(`/anomalies?${next.toString()}`)
  }

  const win = WINDOW_PRESETS[windowPreset]
  // 1h / 24h obs both fit inside `today` (24h). 7d obs maps to 7d range.
  const investigateRange = investigateRangeForObservationHours(win.obs)

  const {
    data: anomalyResult,
    isLoading: loadingCurrent,
    isFetching: fetchingCurrent,
    error: errorCurrent,
    refetch: refetchCurrent,
  } = useAnomalies({
    observationHours: win.obs,
    referenceHours: win.ref,
    sigma: 3,
  })
  const {
    data: history,
    isLoading: loadingHistory,
    isFetching: fetchingHistory,
    error: errorHistory,
    refetch: refetchHistory,
  } = useAnomalyHistory(Number(historyDays))
  const fetchError = errorCurrent ?? errorHistory
  const ackMutation = useAckAnomaly()
  const unackMutation = useUnackAnomaly()

  const ackAnomaly = (a: Anomaly) =>
    ackMutation.mutate({ provider: a.provider, model: a.model, kind: a.kind })
  const unackAnomaly = (a: Anomaly) =>
    unackMutation.mutate({ provider: a.provider, model: a.model, kind: a.kind })
  const ackPending = ackMutation.isPending || unackMutation.isPending

  const filteredCurrent = useMemo(() => {
    const all = anomalyResult?.data ?? []
    return all.filter((a) => {
      if (kindFilter !== 'all' && a.kind !== kindFilter) return false
      if (confFilter === 'high' && a.confidence !== 'high') return false
      if (confFilter === 'medium_plus' && confidenceRank(a.confidence) < 2) return false
      return true
    })
  }, [anomalyResult, kindFilter, confFilter])

  const historyFiltered = useMemo(() => {
    const all = history ?? []
    return all.filter((a) => {
      if (kindFilter !== 'all' && a.kind !== kindFilter) return false
      if (confFilter === 'high' && a.confidence !== 'high') return false
      if (confFilter === 'medium_plus' && confidenceRank(a.confidence) < 2) return false
      return true
    })
  }, [history, kindFilter, confFilter])

  const unackedHigh   = filteredCurrent.filter((a) => a.deviations >= 5 && !a.acknowledgedAt)
  const unackedMedium = filteredCurrent.filter((a) => a.deviations < 5  && !a.acknowledgedAt)
  const acked         = filteredCurrent.filter((a) => Boolean(a.acknowledgedAt))

  const historyCount = history?.length ?? 0
  const isLoading = loadingCurrent || loadingHistory
  const isFetching = fetchingCurrent || fetchingHistory

  // Anchor refs let the stat-card clicks scroll the user to the matching
  // section in the list instead of forcing them to find it by eye.
  const highRef   = useRef<HTMLDivElement>(null)
  const mediumRef = useRef<HTMLDivElement>(null)
  const ackedRef  = useRef<HTMLDivElement>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  function scrollTo(ref: React.RefObject<HTMLDivElement | null>) {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function refreshAll() {
    void refetchCurrent()
    void refetchHistory()
  }

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col min-h-screen">
      <div className="sticky top-0 z-20 bg-bg">
        <Topbar
          crumbs={[{ label: 'Anomalies' }]}
          right={
            <div className="flex items-center gap-3">
              <LiveDot refetching={isFetching} />
              <button
                type="button"
                onClick={refreshAll}
                disabled={isFetching}
                title="Refresh now"
                className="font-mono text-[11px] text-text-muted hover:text-text border border-border rounded px-2 py-1 transition-colors disabled:opacity-40"
              >
                <span className={cn('inline-block', isFetching && 'animate-spin')}>↻</span>
              </button>
            </div>
          }
        />
        <h1 className="sr-only">Anomalies</h1>
      </div>

      {/* Stat strip — cards are now buttons that scroll to the matching
          section. "Baseline" is purely informational so it stays a static
          card. */}
      <div className="overflow-x-auto shrink-0 border-b border-border">
        <div className="grid grid-cols-5 min-w-[480px]">
          {[
            { label: 'Open · high',   value: String(unackedHigh.length),   warn: unackedHigh.length > 0, ref: highRef,    enabled: unackedHigh.length > 0 },
            { label: 'Open · medium', value: String(unackedMedium.length), warn: false,                  ref: mediumRef,  enabled: unackedMedium.length > 0 },
            { label: 'Acknowledged',  value: String(acked.length),         warn: false,                  ref: ackedRef,   enabled: acked.length > 0 },
            { label: `History · ${historyDays}d`, value: String(historyCount), warn: false, ref: historyRef, enabled: historyCount > 0 },
            { label: 'Baseline',      value: win.label.split(' vs ')[1] ?? win.label, warn: false, ref: null, enabled: false },
          ].map((s, i) => {
            const interactive = s.enabled && s.ref
            const Wrap: React.ElementType = interactive ? 'button' : 'div'
            return (
              <Wrap
                key={s.label}
                {...(interactive ? { type: 'button', onClick: () => scrollTo(s.ref!) } : {})}
                className={cn(
                  'px-[18px] py-[14px] text-left',
                  i < 4 && 'border-r border-border',
                  interactive && 'hover:bg-bg-elev transition-colors cursor-pointer',
                )}
              >
                <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">{s.label}</div>
                <span className={cn('text-[24px] font-medium leading-none tracking-[-0.6px]', s.warn ? 'text-accent' : 'text-text')}>
                  {s.value}
                </span>
              </Wrap>
            )
          })}
        </div>
      </div>

      {/* Filter row — kind / confidence / observation window / history days */}
      <div className="flex items-center gap-2 px-[22px] py-[10px] border-b border-border shrink-0 flex-wrap">
        <span className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em]">Kind</span>
        {KIND_FILTERS.map(({ v, l }) => (
          <button
            key={v}
            type="button"
            onClick={() => updateQuery({ kind: v === 'all' ? null : v })}
            className={cn(
              'font-mono text-[11px] px-[9px] py-[3px] rounded-[4px] border transition-colors',
              kindFilter === v
                ? 'border-border-strong bg-bg-elev text-text'
                : 'border-border text-text-muted hover:text-text',
            )}
          >
            {l}
          </button>
        ))}

        <span className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] ml-2">Confidence</span>
        {(['all', 'medium_plus', 'high'] as ConfidenceFilter[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => updateQuery({ conf: v === 'all' ? null : v })}
            className={cn(
              'font-mono text-[11px] px-[9px] py-[3px] rounded-[4px] border transition-colors',
              confFilter === v
                ? 'border-border-strong bg-bg-elev text-text'
                : 'border-border text-text-muted hover:text-text',
            )}
            title={
              v === 'high'
                ? 'Only high-confidence anomalies (100+ baseline samples).'
                : v === 'medium_plus'
                  ? 'High + medium confidence (30+ baseline samples).'
                  : 'All anomalies including low-confidence directional signal.'
            }
          >
            {v === 'medium_plus' ? 'medium+' : v}
          </button>
        ))}

        <span className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] ml-2">Window</span>
        {(Object.keys(WINDOW_PRESETS) as WindowPreset[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => updateQuery({ window: v === '1h-7d' ? null : v })}
            className={cn(
              'font-mono text-[11px] px-[9px] py-[3px] rounded-[4px] border transition-colors',
              windowPreset === v
                ? 'border-border-strong bg-bg-elev text-text'
                : 'border-border text-text-muted hover:text-text',
            )}
            title={`Compare last ${WINDOW_PRESETS[v].obs}h against ${WINDOW_PRESETS[v].ref / 24}d baseline.`}
          >
            {WINDOW_PRESETS[v].label}
          </button>
        ))}

        <span className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] ml-2">History</span>
        {HISTORY_OPTS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => updateQuery({ history: d === '30' ? null : d })}
            className={cn(
              'font-mono text-[11px] px-[9px] py-[3px] rounded-[4px] border transition-colors',
              historyDays === d
                ? 'border-border-strong bg-bg-elev text-text'
                : 'border-border text-text-muted hover:text-text',
            )}
          >
            {d}d
          </button>
        ))}

        <span className="flex-1" />
        <ExportDropdown
          filename="spanlens-anomalies"
          buildUrl={(fmt) => `/api/v1/exports/anomalies?format=${fmt}`}
        />
        <span className="font-mono text-[10px] text-text-faint">Sorted by severity · σ desc</span>
      </div>

      <div>
        {fetchError ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-text-muted">
            <span className="text-[28px] leading-none">⚠</span>
            <p className="text-[13px] text-bad">Failed to load anomaly data.</p>
            <p className="font-mono text-[11.5px] text-text-faint">
              {fetchError instanceof Error ? fetchError.message : 'Unknown error'}
            </p>
          </div>
        ) : isLoading ? (
          <div className="p-6 space-y-2">
            {[1, 2, 3].map((i) => <div key={i} className="h-14 bg-bg-elev rounded animate-pulse" />)}
          </div>
        ) : (
          <>
            {unackedHigh.length > 0 && (
              <div ref={highRef}>
                <div className="flex items-center gap-2.5 px-[22px] py-[10px] bg-bg-muted border-b border-border border-t border-t-border">
                  <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-accent">
                    New · high · {unackedHigh.length}
                  </span>
                </div>
                {unackedHigh.map((a, i) => (
                  <AnomRow
                    key={`${a.provider}-${a.model}-${a.kind}`}
                    a={a}
                    last={i === unackedHigh.length - 1}
                    onAck={() => ackAnomaly(a)}
                    onUnack={() => unackAnomaly(a)}
                    ackPending={ackPending}
                    investigateRange={investigateRange}
                  />
                ))}
              </div>
            )}

            {unackedMedium.length > 0 && (
              <div ref={mediumRef}>
                <div className="flex items-center gap-2.5 px-[22px] py-[10px] bg-bg-muted border-b border-border border-t border-t-border">
                  <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-accent">
                    New · medium · {unackedMedium.length}
                  </span>
                </div>
                {unackedMedium.map((a, i) => (
                  <AnomRow
                    key={`${a.provider}-${a.model}-${a.kind}-m`}
                    a={a}
                    last={i === unackedMedium.length - 1}
                    onAck={() => ackAnomaly(a)}
                    onUnack={() => unackAnomaly(a)}
                    ackPending={ackPending}
                    investigateRange={investigateRange}
                  />
                ))}
              </div>
            )}

            {acked.length > 0 && (
              <div ref={ackedRef}>
                <div className="flex items-center gap-2.5 px-[22px] py-[10px] bg-bg-muted border-b border-border border-t border-t-border">
                  <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint">
                    Acknowledged · {acked.length}
                  </span>
                </div>
                {acked.map((a, i) => (
                  <AnomRow
                    key={`${a.provider}-${a.model}-${a.kind}-ack`}
                    a={a}
                    last={i === acked.length - 1}
                    onAck={() => ackAnomaly(a)}
                    onUnack={() => unackAnomaly(a)}
                    ackPending={ackPending}
                    dimmed
                    investigateRange={investigateRange}
                  />
                ))}
              </div>
            )}

            {unackedHigh.length === 0 && unackedMedium.length === 0 && !loadingCurrent && (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-text-muted">
                <span className="text-[28px] leading-none">✓</span>
                <p className="text-[13px]">
                  {kindFilter === 'all'
                    ? 'No anomalies in the current window.'
                    : `No ${kindFilter.replace('_', ' ')} anomalies in the current window.`}
                </p>
                <p className="font-mono text-[11.5px] text-text-faint">
                  {acked.length > 0
                    ? `${acked.length} acknowledged, Unack to re-open.`
                    : 'Baselines look healthy.'}
                </p>
                <Link
                  href="/docs/features/anomalies"
                  className="font-mono text-[11px] mt-2 px-2.5 py-1 rounded border border-border text-text-muted hover:text-text hover:border-border-strong transition-colors"
                >
                  How anomaly detection works →
                </Link>
              </div>
            )}

            {historyFiltered.length > 0 && (
              <div ref={historyRef}>
                <div className="flex items-center gap-2.5 px-[22px] py-[10px] bg-bg-muted border-b border-border border-t border-t-border">
                  <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint opacity-75">
                    Past detections · {historyDays}d · {historyFiltered.length}
                  </span>
                </div>
                <div className="opacity-75">
                  {historyFiltered.map((e, i) => (
                    <HistoryRow key={e.id} e={e} last={i === historyFiltered.length - 1} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
