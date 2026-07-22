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

function anomTitle(a: AnomalyTitleFields): string {
  const pct =
    a.baselineMean > 0
      ? (((a.currentValue - a.baselineMean) / a.baselineMean) * 100).toFixed(0)
      : '?'
  if (a.kind === 'latency') return `p95 latency · ${a.deviations.toFixed(1)}σ above mean`
  if (a.kind === 'cost') return `Spend · ${pct}% above baseline`
  return `Error rate · ${fmtValue('error_rate', a.currentValue)} (baseline ${fmtValue('error_rate', a.baselineMean)})`
}

function AnomDeltaBars({
  currentValue,
  baselineMean,
  deviations,
}: {
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
        title={`baseline ${baselineMean.toFixed(3)}`}
        style={{ height: `${basePct}%`, width: 8 }}
        className="rounded-[1px] bg-border-strong opacity-70"
      />
      <div
        title={`now ${currentValue.toFixed(3)}`}
        style={{ height: `${nowPct}%`, width: 8 }}
        className={cn('rounded-[1px]', isHigh ? 'bg-bad' : 'bg-accent')}
      />
    </div>
  )
}

function AnomRow({
  a,
  last,
  dimmed,
  onAck,
  investigateRange,
}: {
  a: Anomaly
  last: boolean
  dimmed?: boolean
  onAck: () => void
  investigateRange: InvestigateRange
}) {
  const isHigh = a.deviations >= 5
  const isAcked = Boolean(a.acknowledgedAt)
  const tint = isHigh ? 'text-bad' : 'text-accent'
  const dotBg = isHigh ? 'bg-bad' : 'bg-accent'
  const anomId = anomDisplayId(a.provider, a.model, a.kind)
  const investigateHref = buildDemoInvestigateHref(a.provider, a.model, investigateRange)

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
      {/* sev dot */}
      <div className="flex items-center justify-center">
        <span
          className={cn(
            'w-2 h-2 rounded-full',
            dotBg,
            isHigh && !isAcked && 'shadow-[0_0_0_3px_var(--accent-bg)]',
          )}
        />
      </div>

      {/* title + target */}
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
      </div>

      {/* now vs baseline */}
      <div>
        <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.03em] mb-[3px]">
          NOW · BASE
        </div>
        <div className="font-mono text-[12px] text-text">
          <span className="font-medium">{fmtValue(a.kind, a.currentValue)}</span>
          <span className="text-text-faint"> · </span>
          <span className="text-text-muted">{fmtValue(a.kind, a.baselineMean)}</span>
        </div>
        <div className={cn('font-mono text-[10.5px] mt-0.5', tint)}>
          {fmtDelta(a.kind, a.currentValue, a.baselineMean)}
        </div>
      </div>

      {/* bars */}
      <div>
        <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.03em] mb-1">
          BASE · NOW
        </div>
        <AnomDeltaBars
          currentValue={a.currentValue}
          baselineMean={a.baselineMean}
          deviations={a.deviations}
        />
      </div>

      {/* impact */}
      <div>
        <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.03em] mb-[3px]">
          IMPACT
        </div>
        <div className="text-[12px] text-text">{a.sampleCount} requests</div>
        <div className="font-mono text-[10.5px] text-text-faint mt-0.5">
          {a.deviations.toFixed(1)}σ deviation
        </div>
      </div>

      {/* actions */}
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          onClick={onAck}
          className={cn(
            'font-mono text-[10.5px] px-2 py-[3px] border rounded-[4px] transition-colors',
            isAcked
              ? 'text-text-muted border-border hover:text-text'
              : 'text-text-muted border-border hover:text-text hover:border-border-strong',
          )}
          title={isAcked ? 'Un-acknowledge' : 'Acknowledge this anomaly'}
        >
          {isAcked ? 'Unack' : 'Ack'}
        </button>
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
        <div className="font-mono text-[11px] text-text-faint">
          {e.provider} / {e.model}
        </div>
      </div>
      <div>
        <div className="font-mono text-[12px] text-text-muted">
          {fmtValue(e.kind, e.currentValue)} · {fmtValue(e.kind, e.baselineMean)}
        </div>
      </div>
      <div>
        <AnomDeltaBars
          currentValue={e.currentValue}
          baselineMean={e.baselineMean}
          deviations={e.deviations}
        />
      </div>
      <div className="font-mono text-[11px] text-text-faint">{e.sampleCount} req</div>
      <div className="text-right">
        <div className="font-mono text-[11px] text-text-muted">{formatDate(e.detectedOn)}</div>
        <div className="font-mono text-[10.5px] text-text-faint mt-0.5">
          {e.deviations.toFixed(1)}σ
        </div>
      </div>
    </div>
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
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col min-h-screen">
      <div className="sticky top-0 z-20 bg-bg">
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
      </div>

      {/* Stat strip — enabled tiles scroll to their matching section */}
      <div className="overflow-x-auto shrink-0 border-b border-border">
        <div className="grid grid-cols-5 min-w-[480px]">
          {[
            { label: 'Open · high', value: String(unackedHigh.length), warn: unackedHigh.length > 0, ref: highRef, enabled: unackedHigh.length > 0 },
            { label: 'Open · medium', value: String(unackedMedium.length), warn: false, ref: mediumRef, enabled: unackedMedium.length > 0 },
            { label: 'Acknowledged', value: String(acked.length), warn: false, ref: ackedRef, enabled: acked.length > 0 },
            { label: `History · ${historyDays}d`, value: String(historyFiltered.length), warn: false, ref: historyRef, enabled: historyFiltered.length > 0 },
            { label: 'Baseline', value: win.label.split(' vs ')[1] ?? win.label, warn: false, ref: null, enabled: false },
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
                <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">
                  {s.label}
                </div>
                <span
                  className={cn(
                    'text-[24px] font-medium leading-none tracking-[-0.6px]',
                    s.warn ? 'text-accent' : 'text-text',
                  )}
                >
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
            onClick={() => setKindFilter(v)}
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

        <span className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] ml-2">
          Confidence
        </span>
        {(['all', 'medium_plus', 'high'] as ConfidenceFilter[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setConfFilter(v)}
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

        <span className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] ml-2">
          Window
        </span>
        {(Object.keys(WINDOW_PRESETS) as WindowPreset[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setWindowPreset(v)}
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

        <span className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] ml-2">
          History
        </span>
        {HISTORY_OPTS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setHistoryDays(d)}
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
        <span className="font-mono text-[10px] text-text-faint">Sorted by severity · σ desc</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <>
          {/* Open, high severity */}
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
                  onAck={() => toggleAck(a)}
                  investigateRange={investigateRange}
                />
              ))}
            </div>
          )}

          {/* Open, medium severity */}
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
                  onAck={() => toggleAck(a)}
                  investigateRange={investigateRange}
                />
              ))}
            </div>
          )}

          {/* Acknowledged */}
          {acked.length > 0 && (
            <div ref={ackedRef}>
              <div className="flex items-center gap-2.5 px-[22px] py-[10px] bg-bg-muted border-b border-border border-t border-t-border">
                <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint">
                  Acknowledged · {acked.length}
                </span>
              </div>
              <div className="opacity-60">
                {acked.map((a, i) => (
                  <AnomRow
                    key={`${a.provider}-${a.model}-${a.kind}-ack`}
                    a={a}
                    last={i === acked.length - 1}
                    onAck={() => toggleAck(a)}
                    dimmed
                    investigateRange={investigateRange}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {unackedHigh.length === 0 && unackedMedium.length === 0 && (
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
            </div>
          )}

          {/* Past detections */}
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
      </div>
    </div>
  )
}
