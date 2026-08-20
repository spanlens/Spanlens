'use client'
import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { DEMO_ANOMALIES, DEMO_ANOMALY_HISTORY } from '@/lib/demo-data'
import type {
  Anomaly,
  AnomalyConfidence,
  AnomalyHistoryEntry,
  AnomalyKind,
} from '@/lib/queries/use-anomalies'
import { Topbar } from '@/components/layout/topbar'
import { DemoExportButton } from '@/components/ui/demo-export-button'
import { useHydrationSafeNow } from '@/lib/hydration-safe-now'
import {
  investigateRangeForObservationHours,
  type InvestigateRange,
} from '@/lib/anomaly-investigate'
import { cn, formatDate } from '@/lib/utils'

type KindFilter = 'all' | AnomalyKind
type ConfidenceFilter = 'all' | 'high' | 'medium_plus'
type WindowPreset = '1h-7d' | '24h-30d' | '7d-30d'
type HistoryDays = '7' | '30' | '90'

// ── Demo-only confidence assignments ──────────────────────────────────────────
// The shared DEMO_* fixtures do not carry a `confidence` field, so we assign a
// spread of confidence levels here (module-level, page-local) purely so the demo
// confidence filter has something to filter. Keyed by the anomaly natural key.
const DEMO_ANOM_CONFIDENCE: Record<string, AnomalyConfidence> = {
  'anthropic-claude-sonnet-4-5-latency': 'high',
  'openai-gpt-4o-cost': 'high',
  'openai-gpt-4o-mini-error_rate': 'medium',
  'anthropic-claude-haiku-4-5-cost': 'low',
}
const DEMO_HISTORY_CONFIDENCE: Record<string, AnomalyConfidence> = {
  'anh-001': 'high',
  'anh-002': 'medium',
  'anh-003': 'high',
  'anh-004': 'low',
  'anh-005': 'high',
}

const KIND_FILTERS: { v: KindFilter; l: string }[] = [
  { v: 'all', l: 'All' },
  { v: 'latency', l: 'latency' },
  { v: 'cost', l: 'cost' },
  { v: 'error_rate', l: 'errors' },
]

const WINDOW_PRESETS: Record<WindowPreset, { obs: number; ref: number; label: string }> = {
  '1h-7d': { obs: 1, ref: 24 * 7, label: '1h vs 7d' },
  '24h-30d': { obs: 24, ref: 24 * 30, label: '24h vs 30d' },
  '7d-30d': { obs: 24 * 7, ref: 24 * 30, label: '7d vs 30d' },
}

const HISTORY_OPTS: HistoryDays[] = ['7', '30', '90']

// Point Investigate links at the demo requests page. Mirrors the shape of
// lib/anomaly-investigate.ts `buildInvestigateHref`, but with the /demo prefix.
function buildDemoInvestigateHref(
  provider: string,
  model: string,
  range: InvestigateRange,
): string {
  return `/demo/requests?provider=${encodeURIComponent(provider)}&model=${encodeURIComponent(
    model,
  )}&timeRange=${range}`
}

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

// Stable display ID derived from the anomaly's natural key (provider/model/kind),
// mirroring the real client so the label does not shift on filter/sort changes.
function anomDisplayId(provider: string, model: string, kind: AnomalyKind): string {
  const s = `${provider}|${model}|${kind}`
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) & 0xffffffff
  return `AN-${(h >>> 0).toString(16).slice(0, 4).toUpperCase()}`
}

function confidenceRank(c: AnomalyConfidence | undefined | null): number {
  if (c === 'high') return 3
  if (c === 'medium') return 2
  if (c === 'low') return 1
  return 0
}

interface AnomalyTitleFields {
  kind: AnomalyKind
  currentValue: number
  baselineMean: number
  deviations: number
}

/**
 * The card splits what used to be one sentence across two ramp steps: the
 * metric name rides the header line at card-title weight, the deviation
 * statement below it carries the display face. `anomMetricLabel` and
 * `anomStatement` are the two halves of the old single-line title, matching the
 * real client so no wording is lost, it just lands on two lines instead of one.
 */
function anomMetricLabel(k: AnomalyKind): string {
  return { latency: 'p95 latency', cost: 'Spend', error_rate: 'Error rate' }[k] ?? k
}

function anomStatement(a: AnomalyTitleFields): string {
  const pct =
    a.baselineMean > 0
      ? (((a.currentValue - a.baselineMean) / a.baselineMean) * 100).toFixed(0)
      : '?'
  if (a.kind === 'latency') return `${a.deviations.toFixed(1)}σ above mean`
  if (a.kind === 'cost') return `${pct}% above baseline`
  return `${fmtValue('error_rate', a.currentValue)} against a ${fmtValue('error_rate', a.baselineMean)} baseline`
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

/** Micro-stat used in the card footer: mono eyebrow over its value. */
function CardStat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-faint mb-1.5">{label}</div>
      {children}
    </div>
  )
}

function AnomRow({
  a,
  dimmed,
  onAck,
  investigateRange,
}: {
  a: Anomaly
  dimmed?: boolean
  onAck: () => void
  investigateRange: InvestigateRange
}) {
  const isHigh = a.deviations >= 5
  const isAcked = Boolean(a.acknowledgedAt)
  const tint = isHigh ? 'text-bad' : 'text-accent'
  const anomId = anomDisplayId(a.provider, a.model, a.kind)
  const investigateHref = buildDemoInvestigateHref(a.provider, a.model, investigateRange)

  return (
    <article
      className={cn(
        'rounded-card border bg-bg-elev shadow-card px-5 py-[18px]',
        isHigh && !isAcked ? 'border-accent-border' : 'border-border',
        dimmed && 'opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 min-w-0">
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-[3px] text-[11px] font-semibold',
              isHigh ? 'bg-bad-bg text-bad' : 'bg-warn-bg text-warn',
            )}
          >
            {isHigh ? 'high' : 'medium'}
          </span>
          <span className="text-[13.5px] font-semibold text-text">{anomMetricLabel(a.kind)}</span>
          <span className="font-mono text-[12px] text-text-faint truncate">
            {a.provider} · {a.model}
          </span>
          <span className="font-mono text-[11px] text-text-faint tracking-[0.03em]">{anomId}</span>
          {a.confidence && (
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-[3px] font-mono text-[10.5px]',
                a.confidence === 'low' ? 'bg-bg-chip text-text-faint' : 'bg-bg-chip text-text-muted',
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
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onAck}
            className="rounded-full border border-border bg-bg-elev px-3.5 py-2 text-[12px] font-medium text-text hover:bg-bg-muted transition-colors"
            title={isAcked ? 'Un-acknowledge' : 'Acknowledge this anomaly'}
          >
            {isAcked ? 'Unacknowledge' : 'Acknowledge'}
          </button>
          <Link
            href={investigateHref}
            className="rounded-full bg-text px-3.5 py-2 text-[12px] font-medium text-bg hover:opacity-90 transition-opacity"
          >
            Open requests
          </Link>
        </div>
      </div>

      <p className="font-display text-[20px] track-h3 leading-[1.45] text-text mt-2.5">
        {anomStatement(a)}
      </p>

      <div className="flex flex-wrap items-end gap-x-10 gap-y-3 mt-4 pt-4 border-t border-border">
        <CardStat label="Now · base">
          <div className="font-mono text-[12px] text-text">
            <span className="font-medium">{fmtValue(a.kind, a.currentValue)}</span>
            <span className="text-text-faint"> · </span>
            <span className="text-text-muted">{fmtValue(a.kind, a.baselineMean)}</span>
            <span className={cn('ml-2', tint)}>{fmtDelta(a.kind, a.currentValue, a.baselineMean)}</span>
          </div>
        </CardStat>
        <CardStat label="Base · now">
          <AnomDeltaBars
            kind={a.kind}
            currentValue={a.currentValue}
            baselineMean={a.baselineMean}
            deviations={a.deviations}
          />
        </CardStat>
        <CardStat label="Impact">
          <div className="font-mono text-[12px] text-text">
            {a.sampleCount} requests
            <span className="text-text-faint"> · {a.deviations.toFixed(1)}σ deviation</span>
          </div>
        </CardStat>
      </div>
    </article>
  )
}

/* Past detections stay tabular: they are read as a scan-down list, so they get
   the table-card treatment rather than the per-anomaly card used above. */
const HISTORY_GRID = 'grid items-center gap-4 grid-cols-[80px_minmax(220px,1fr)_150px_60px_90px_120px]'

function HistoryRow({ e }: { e: AnomalyHistoryEntry }) {
  return (
    <div className={cn(HISTORY_GRID, 'px-[18px] py-3 border-b border-border last:border-b-0')}>
      <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-text-muted">
        {kindLabel(e.kind)}
      </span>
      <div className="min-w-0">
        <div className="font-mono text-[12px] text-text truncate">{e.provider} · {e.model}</div>
        <div className="text-[11.5px] text-text-muted truncate">{anomStatement(e)}</div>
      </div>
      <span className="font-mono text-[12px] text-text-muted">
        {fmtValue(e.kind, e.currentValue)} · {fmtValue(e.kind, e.baselineMean)}
      </span>
      <AnomDeltaBars
        kind={e.kind}
        currentValue={e.currentValue}
        baselineMean={e.baselineMean}
        deviations={e.deviations}
      />
      <span className="font-mono text-[12px] text-text-muted">{e.sampleCount} req</span>
      <div className="text-right">
        <div className="font-mono text-[12px] text-text-muted">{formatDate(e.detectedOn)}</div>
        <div className="font-mono text-[10.5px] text-text-faint mt-0.5">
          {e.deviations.toFixed(1)}σ
        </div>
      </div>
    </div>
  )
}

/** Eyebrow that titles a group of anomaly cards. */
function SectionEyebrow({
  children,
  tone = 'faint',
}: {
  children: React.ReactNode
  tone?: 'faint' | 'accent'
}) {
  return (
    <div
      className={cn(
        'font-mono text-[10px] uppercase tracking-[0.12em] pt-1',
        tone === 'accent' ? 'text-accent' : 'text-text-faint',
      )}
    >
      {children}
    </div>
  )
}

/** Labelled segmented control: eyebrow + pill trough. */
function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-faint">{label}</span>
      <div className="inline-flex items-center gap-0.5 rounded-full bg-bg-chip p-[3px]">{children}</div>
    </div>
  )
}

function SegmentBtn({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        'rounded-full px-[11px] py-[5px] text-[12px] font-medium transition-colors',
        active ? 'bg-bg-elev text-text shadow-card' : 'text-text-faint hover:text-text',
      )}
    >
      {children}
    </button>
  )
}

export default function DemoAnomaliesPage() {
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [confFilter, setConfFilter] = useState<ConfidenceFilter>('all')
  const [windowPreset, setWindowPreset] = useState<WindowPreset>('1h-7d')
  const [historyDays, setHistoryDays] = useState<HistoryDays>('30')
  const [ackedIds, setAckedIds] = useState<Set<string>>(
    // pre-seed the one already acknowledged in demo data
    () =>
      new Set(
        DEMO_ANOMALIES.filter((a) => Boolean(a.acknowledgedAt)).map(
          (a) => `${a.provider}-${a.model}-${a.kind}`,
        ),
      ),
  )

  // Capture "now" once at mount — used only to filter history by day window.
  const now = useHydrationSafeNow()

  const win = WINDOW_PRESETS[windowPreset]
  // Map the observation window to a /requests timeRange, same as the real client.
  const investigateRange = investigateRangeForObservationHours(win.obs)

  // Anchor refs let the stat tiles scroll to the matching section.
  const highRef = useRef<HTMLDivElement>(null)
  const mediumRef = useRef<HTMLDivElement>(null)
  const ackedRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  function scrollTo(ref: React.RefObject<HTMLDivElement | null>) {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function toggleAck(a: Anomaly) {
    const key = `${a.provider}-${a.model}-${a.kind}`
    setAckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const current = useMemo(() => {
    const all: Anomaly[] = DEMO_ANOMALIES.map((a) => {
      const key = `${a.provider}-${a.model}-${a.kind}`
      const conf = DEMO_ANOM_CONFIDENCE[key]
      return {
        ...a,
        ...(conf ? { confidence: conf } : {}),
        acknowledgedAt: ackedIds.has(key)
          ? (a.acknowledgedAt ?? new Date().toISOString())
          : null,
      }
    })
    return all.filter((a) => {
      if (kindFilter !== 'all' && a.kind !== kindFilter) return false
      if (confFilter === 'high' && a.confidence !== 'high') return false
      if (confFilter === 'medium_plus' && confidenceRank(a.confidence) < 2) return false
      return true
    })
  }, [kindFilter, confFilter, ackedIds])

  const historyFiltered = useMemo(() => {
    const days = Number(historyDays)
    // now === 0 during SSR + first client paint, so the cutoff is negative and
    // every entry passes (matching the server HTML). Post-hydration `now`
    // becomes real and the day window applies — the same hydration-safe shape
    // the demo requests page uses for its time-range filter.
    const cutoff = now - days * 24 * 3_600_000
    return DEMO_ANOMALY_HISTORY.filter((a) => {
      if (kindFilter !== 'all' && a.kind !== kindFilter) return false
      const conf = DEMO_HISTORY_CONFIDENCE[a.id]
      if (confFilter === 'high' && conf !== 'high') return false
      if (confFilter === 'medium_plus' && confidenceRank(conf) < 2) return false
      if (new Date(a.detectedOn).getTime() < cutoff) return false
      return true
    })
  }, [kindFilter, confFilter, historyDays, now])

  const unackedHigh = current.filter((a) => a.deviations >= 5 && !a.acknowledgedAt)
  const unackedMedium = current.filter((a) => a.deviations < 5 && !a.acknowledgedAt)
  const acked = current.filter((a) => Boolean(a.acknowledgedAt))

  return (
    <>
      {/* The topbar is the only full-bleed row: it cancels the padding the
          demo layout applies so its hairline spans the whole main column.
          Everything below sits flush inside that padding. */}
      <div className="sticky top-0 z-20 -mx-4 -mt-4 md:-mx-7 md:-mt-5 bg-bg">
        <Topbar
          crumbs={[{ label: 'Demo', href: '/demo/dashboard' }, { label: 'Anomalies' }]}
          right={
            <DemoExportButton
              base="anomalies"
              rows={current}
              columns={[
                { header: 'Provider', value: (a) => a.provider },
                { header: 'Model', value: (a) => a.model },
                { header: 'Kind', value: (a) => a.kind },
                { header: 'Confidence', value: (a) => a.confidence ?? '' },
                { header: 'Deviations', value: (a) => a.deviations.toFixed(1) },
                { header: 'Current', value: (a) => a.currentValue },
                { header: 'Baseline', value: (a) => a.baselineMean },
                { header: 'Acknowledged', value: (a) => (a.acknowledgedAt ? 'yes' : 'no') },
              ]}
            />
          }
        />
        <h1 className="sr-only">Anomalies</h1>
      </div>

      {/* 20px above the first row, 16px between rows, per the Figma content
          frame. Side and bottom gutters come from the demo layout. */}
      <div className="pt-4 md:pt-5 space-y-4">
        {/* Filter row — kind / confidence / observation window / history days.
            Each group is a segmented control; the eyebrow in front of it names
            the axis, since four unlabelled segments in a row read as one
            control. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <FilterGroup label="Kind">
            {KIND_FILTERS.map(({ v, l }) => (
              <SegmentBtn key={v} active={kindFilter === v} onClick={() => setKindFilter(v)}>
                {l}
              </SegmentBtn>
            ))}
          </FilterGroup>

          <FilterGroup label="Confidence">
            {(['all', 'medium_plus', 'high'] as ConfidenceFilter[]).map((v) => (
              <SegmentBtn
                key={v}
                active={confFilter === v}
                onClick={() => setConfFilter(v)}
                title={
                  v === 'high'
                    ? 'Only high-confidence anomalies (100+ baseline samples).'
                    : v === 'medium_plus'
                      ? 'High + medium confidence (30+ baseline samples).'
                      : 'All anomalies including low-confidence directional signal.'
                }
              >
                {v === 'medium_plus' ? 'medium+' : v}
              </SegmentBtn>
            ))}
          </FilterGroup>

          <FilterGroup label="Window">
            {(Object.keys(WINDOW_PRESETS) as WindowPreset[]).map((v) => (
              <SegmentBtn
                key={v}
                active={windowPreset === v}
                onClick={() => setWindowPreset(v)}
                title={`Compare last ${WINDOW_PRESETS[v].obs}h against ${WINDOW_PRESETS[v].ref / 24}d baseline.`}
              >
                {WINDOW_PRESETS[v].label}
              </SegmentBtn>
            ))}
          </FilterGroup>

          <FilterGroup label="History">
            {HISTORY_OPTS.map((d) => (
              <SegmentBtn key={d} active={historyDays === d} onClick={() => setHistoryDays(d)}>
                {d}d
              </SegmentBtn>
            ))}
          </FilterGroup>

          <span className="font-mono text-[11px] text-text-faint ml-auto">
            Sorted by severity · σ desc
          </span>
        </div>

        {/* Stat cards double as jump links into the matching section.
            "Baseline" is purely informational so it stays a static card. */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            { label: 'Open · high',   value: String(unackedHigh.length),   note: unackedHigh.length > 0 ? 'needs a look now' : 'all clear', warn: unackedHigh.length > 0, ref: highRef,    enabled: unackedHigh.length > 0 },
            { label: 'Open · medium', value: String(unackedMedium.length), note: 'watching',       warn: false, ref: mediumRef,  enabled: unackedMedium.length > 0 },
            { label: 'Acknowledged',  value: String(acked.length),         note: 'in this window', warn: false, ref: ackedRef,   enabled: acked.length > 0 },
            { label: `History · ${historyDays}d`, value: String(historyFiltered.length), note: 'past detections', warn: false, ref: historyRef, enabled: historyFiltered.length > 0 },
            { label: 'Baseline',      value: win.label.split(' vs ')[1] ?? win.label, note: 'per model and provider', warn: false, ref: null, enabled: false },
          ].map((s) => {
            const interactive = s.enabled && s.ref
            const Wrap: React.ElementType = interactive ? 'button' : 'div'
            return (
              <Wrap
                key={s.label}
                {...(interactive ? { type: 'button', onClick: () => scrollTo(s.ref!) } : {})}
                className={cn(
                  'rounded-card border border-border bg-bg-elev shadow-card px-5 py-[18px] text-left',
                  interactive && 'hover:bg-bg-muted transition-colors cursor-pointer',
                )}
              >
                <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-faint">
                  {s.label}
                </div>
                <div
                  className={cn(
                    'font-display text-[22px] track-h3 leading-[1.05] mt-[7px]',
                    s.warn ? 'text-accent' : 'text-text',
                  )}
                >
                  {s.value}
                </div>
                <div
                  className={cn(
                    'text-[11.5px] font-medium mt-[7px]',
                    s.warn ? 'text-bad' : 'text-text-faint',
                  )}
                >
                  {s.note}
                </div>
              </Wrap>
            )
          })}
        </div>

        {/* Open, high severity */}
        {unackedHigh.length > 0 && (
          <div ref={highRef} className="space-y-3">
            <SectionEyebrow tone="accent">New · high · {unackedHigh.length}</SectionEyebrow>
            {unackedHigh.map((a) => (
              <AnomRow
                key={`${a.provider}-${a.model}-${a.kind}`}
                a={a}
                onAck={() => toggleAck(a)}
                investigateRange={investigateRange}
              />
            ))}
          </div>
        )}

        {/* Open, medium severity */}
        {unackedMedium.length > 0 && (
          <div ref={mediumRef} className="space-y-3">
            <SectionEyebrow tone="accent">New · medium · {unackedMedium.length}</SectionEyebrow>
            {unackedMedium.map((a) => (
              <AnomRow
                key={`${a.provider}-${a.model}-${a.kind}-m`}
                a={a}
                onAck={() => toggleAck(a)}
                investigateRange={investigateRange}
              />
            ))}
          </div>
        )}

        {/* Acknowledged */}
        {acked.length > 0 && (
          <div ref={ackedRef} className="space-y-3">
            <SectionEyebrow>Acknowledged · {acked.length}</SectionEyebrow>
            {acked.map((a) => (
              <AnomRow
                key={`${a.provider}-${a.model}-${a.kind}-ack`}
                a={a}
                onAck={() => toggleAck(a)}
                dimmed
                investigateRange={investigateRange}
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {unackedHigh.length === 0 && unackedMedium.length === 0 && (
          <div className="rounded-card border border-border bg-bg-elev shadow-card flex flex-col items-center justify-center py-12 gap-2 text-text-muted">
            <span className="text-[28px] leading-none">✓</span>
            <p className="text-[13px]">
              {kindFilter === 'all'
                ? 'No anomalies in the current window.'
                : `No ${kindFilter.replace('_', ' ')} anomalies in the current window.`}
            </p>
            <p className="font-mono text-[11.5px] text-text-faint">
              {acked.length > 0
                ? `${acked.length} acknowledged, Unacknowledge to re-open.`
                : 'Baselines look healthy.'}
            </p>
          </div>
        )}

        {/* Past detections */}
        {historyFiltered.length > 0 && (
          <div ref={historyRef} className="space-y-3">
            <SectionEyebrow>
              Past detections · {historyDays}d · {historyFiltered.length}
            </SectionEyebrow>
            <div className="rounded-card border border-border bg-bg-elev shadow-card overflow-hidden">
              <div className="overflow-x-auto">
                <div className="min-w-[820px]">
                  <div className={cn(HISTORY_GRID, 'bg-bg-muted border-b border-border px-[18px] py-2.5')}>
                    {['Kind', 'Target', 'Now · base', 'Trend', 'Requests', 'Detected'].map((h, i) => (
                      <span
                        key={h}
                        className={cn(
                          'font-mono text-[10px] uppercase tracking-[0.1em] text-text-faint',
                          i === 5 && 'text-right',
                        )}
                      >
                        {h}
                      </span>
                    ))}
                  </div>
                  {historyFiltered.map((e) => (
                    <HistoryRow key={e.id} e={e} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
