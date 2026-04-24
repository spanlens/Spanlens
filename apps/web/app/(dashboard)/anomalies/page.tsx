'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  useAnomalies,
  useAnomalyHistory,
  useAckAnomaly,
  useUnackAnomaly,
  type Anomaly,
  type AnomalyHistoryEntry,
  type AnomalyKind,
} from '@/lib/queries/use-anomalies'
import { Topbar } from '@/components/layout/topbar'
import { cn } from '@/lib/utils'

type KindFilter = 'all' | AnomalyKind

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

/**
 * "Baseline vs now" visual. Two bars side-by-side whose heights reflect
 * the real baseline mean and the current observed value. Honest: no
 * fabricated time-series — only the two values we actually have.
 */
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

function anomTitle(a: Anomaly): string {
  const pct = a.baselineMean > 0 ? ((a.currentValue - a.baselineMean) / a.baselineMean * 100).toFixed(0) : '?'
  if (a.kind === 'latency') return `p95 latency · ${a.deviations.toFixed(1)}σ above mean`
  if (a.kind === 'cost') return `Spend · ${pct}% above baseline`
  return `Error rate · ${fmtValue('error_rate', a.currentValue)} (baseline ${fmtValue('error_rate', a.baselineMean)})`
}

interface AnomRowProps {
  a: Anomaly
  idx: number
  last: boolean
  onAck: () => void
  onUnack: () => void
  ackPending: boolean
}

function AnomRow({ a, idx, last, onAck, onUnack, ackPending }: AnomRowProps) {
  const isHigh = a.deviations >= 5
  const isAcked = Boolean(a.acknowledgedAt)
  const tint = isHigh ? 'text-bad' : 'text-accent'
  const dotBg = isHigh ? 'bg-bad' : 'bg-accent'
  const anomId = `AN-${100 + idx}`

  return (
    <div
      className={cn(
        'grid items-center px-[22px] py-[12px]',
        !last && 'border-b border-border',
        isHigh && !isAcked && 'bg-accent-bg',
        isAcked && 'opacity-60',
      )}
      style={{ gridTemplateColumns: '28px 1fr 120px 150px 150px 130px', gap: 14 }}
    >
      {/* sev dot */}
      <div className="flex items-center justify-center">
        <span
          className={cn('w-2 h-2 rounded-full', dotBg, isHigh && 'shadow-[0_0_0_3px_var(--accent-bg)]')}
        />
      </div>

      {/* title + target */}
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-mono text-[10.5px] text-text-faint tracking-[0.03em]">{anomId}</span>
          <span
            className={cn(
              'font-mono text-[9px] px-[6px] py-[1px] rounded-[3px] border uppercase tracking-[0.04em]',
              isHigh
                ? 'text-accent border-accent-border bg-accent-bg'
                : 'text-text-muted border-border',
            )}
          >
            {kindLabel(a.kind)}
          </span>
          <span className="text-[13.5px] text-text font-medium truncate">{anomTitle(a)}</span>
        </div>
        <div className="font-mono text-[11px] text-text-muted tracking-[0.01em]">
          <span className="text-text-faint">target · </span>
          {a.provider} / {a.model}
        </div>
      </div>

      {/* now vs baseline */}
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

      {/* baseline vs now */}
      <div>
        <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.03em] mb-1">BASE · NOW</div>
        <AnomDeltaBars
          currentValue={a.currentValue}
          baselineMean={a.baselineMean}
          deviations={a.deviations}
        />
      </div>

      {/* impact */}
      <div>
        <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.03em] mb-[3px]">IMPACT</div>
        <div className="text-[12px] text-text">{a.sampleCount} requests</div>
        <div className="font-mono text-[10.5px] text-text-faint mt-0.5">{a.deviations.toFixed(1)}σ deviation</div>
      </div>

      {/* actions */}
      <div className="flex justify-end gap-1.5">
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
        <Link
          href={`/requests?provider=${encodeURIComponent(a.provider)}&model=${encodeURIComponent(a.model)}`}
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
        <span className="w-2 h-2 rounded-full bg-good" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-mono text-[9px] px-[6px] py-[1px] rounded-[3px] border border-border text-text-muted uppercase tracking-[0.04em]">
            {kindLabel(e.kind)}
          </span>
          <span className="text-[13px] text-text-muted truncate">{anomTitle(e as unknown as Anomaly)}</span>
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
          currentValue={e.currentValue}
          baselineMean={e.baselineMean}
          deviations={e.deviations}
        />
      </div>
      <div className="font-mono text-[11px] text-text-faint">{e.sampleCount} req</div>
      <div className="text-right font-mono text-[11px] text-good">✓ resolved</div>
    </div>
  )
}

const KIND_FILTERS: { v: KindFilter; l: string }[] = [
  { v: 'all', l: 'All' },
  { v: 'latency', l: 'latency' },
  { v: 'cost', l: 'cost' },
  { v: 'error_rate', l: 'errors' },
]

export default function AnomaliesPage() {
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')

  const { data: anomalyResult, isLoading: loadingCurrent } = useAnomalies({
    observationHours: 1,
    referenceHours: 24 * 7,
    sigma: 3,
  })
  const { data: history, isLoading: loadingHistory } = useAnomalyHistory(30)
  const ackMutation = useAckAnomaly()
  const unackMutation = useUnackAnomaly()

  const ackAnomaly = (a: Anomaly) =>
    ackMutation.mutate({ provider: a.provider, model: a.model, kind: a.kind })
  const unackAnomaly = (a: Anomaly) =>
    unackMutation.mutate({ provider: a.provider, model: a.model, kind: a.kind })
  const ackPending = ackMutation.isPending || unackMutation.isPending

  const current = useMemo(() => {
    const all = anomalyResult?.data ?? []
    return kindFilter === 'all' ? all : all.filter((a) => a.kind === kindFilter)
  }, [anomalyResult, kindFilter])

  const historyFiltered = useMemo(() => {
    const all = history ?? []
    return kindFilter === 'all' ? all : all.filter((a) => a.kind === kindFilter)
  }, [history, kindFilter])

  const high = current.filter((a) => a.deviations >= 5)
  const medium = current.filter((a) => a.deviations < 5)
  const historyCount = history?.length ?? 0
  const totalAll = (anomalyResult?.data ?? []).length

  return (
    <div className="-m-7 flex flex-col h-screen overflow-hidden bg-bg">
      <Topbar
        crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Anomalies' }]}
        right={
          <div className="flex items-center gap-3">
            <span className="text-[12.5px] text-text-muted flex items-center gap-1.5">
              <span className="w-[7px] h-[7px] rounded-full bg-good shrink-0" /> Detector live · 7d baseline
            </span>
            <span className="font-mono text-[11px] text-text-muted px-[9px] py-[4px] border border-border rounded-[5px] cursor-pointer hover:text-text transition-colors">
              Detector settings
            </span>
          </div>
        }
      />

      {/* Stat strip */}
      <div className="grid grid-cols-5 border-b border-border shrink-0">
        {[
          { label: 'Open · high',     value: String(high.length),      warn: high.length > 0 },
          { label: 'Open · medium',   value: String(medium.length),    warn: false },
          { label: 'Resolved · 7d',   value: String(historyCount),     warn: false },
          { label: 'Baseline',        value: '7d',                     warn: false },
          { label: 'Total anomalies', value: String(totalAll),         warn: totalAll > 0 },
        ].map((s, i) => (
          <div key={i} className={cn('px-[18px] py-[14px]', i < 4 && 'border-r border-border')}>
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">{s.label}</div>
            <span className={cn('text-[24px] font-medium leading-none tracking-[-0.6px]', s.warn ? 'text-accent' : 'text-text')}>
              {s.value}
            </span>
          </div>
        ))}
      </div>

      {/* Kind filter toolbar */}
      <div className="flex items-center gap-2 px-[22px] py-[10px] border-b border-border shrink-0">
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
        <span className="flex-1" />
        <span className="font-mono text-[10px] text-text-faint">Sorted by severity · σ desc</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loadingCurrent && loadingHistory ? (
          <div className="p-6 space-y-2">
            {[1, 2, 3].map((i) => <div key={i} className="h-14 bg-bg-elev rounded animate-pulse" />)}
          </div>
        ) : (
          <>
            {/* New — high */}
            {high.length > 0 && (
              <div>
                <div className="flex items-center gap-2.5 px-[22px] py-[10px] bg-bg-muted border-b border-border border-t border-t-border">
                  <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-accent">
                    New · {high.length}
                  </span>
                </div>
                {high.map((a, i) => (
                  <AnomRow
                    key={`${a.provider}-${a.model}-${a.kind}`}
                    a={a}
                    idx={i}
                    last={i === high.length - 1}
                    onAck={() => ackAnomaly(a)}
                    onUnack={() => unackAnomaly(a)}
                    ackPending={ackPending}
                  />
                ))}
              </div>
            )}

            {/* New — medium */}
            {medium.length > 0 && (
              <div>
                <div className="flex items-center gap-2.5 px-[22px] py-[10px] bg-bg-muted border-b border-border border-t border-t-border">
                  <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-accent">
                    New · medium · {medium.length}
                  </span>
                </div>
                {medium.map((a, i) => (
                  <AnomRow
                    key={`${a.provider}-${a.model}-${a.kind}-m`}
                    a={a}
                    idx={high.length + i}
                    last={i === medium.length - 1}
                    onAck={() => ackAnomaly(a)}
                    onUnack={() => unackAnomaly(a)}
                    ackPending={ackPending}
                  />
                ))}
              </div>
            )}

            {/* Empty state for current */}
            {current.length === 0 && !loadingCurrent && (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-text-muted">
                <span className="text-[28px] leading-none">✓</span>
                <p className="text-[13px]">No anomalies in the last hour.</p>
                <p className="font-mono text-[11.5px] text-text-faint">Baselines look healthy.</p>
              </div>
            )}

            {/* Resolved · 7d */}
            {historyFiltered.length > 0 && (
              <div>
                <div className="flex items-center gap-2.5 px-[22px] py-[10px] bg-bg-muted border-b border-border border-t border-t-border">
                  <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint opacity-75">
                    Resolved · 7d · {historyFiltered.length}
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
