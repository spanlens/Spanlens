'use client'

import { useState } from 'react'
import {
  useAnomalies,
  useAnomalyHistory,
  type Anomaly,
  type AnomalyHistoryEntry,
  type AnomalyKind,
} from '@/lib/queries/use-anomalies'
import { Topbar } from '@/components/layout/topbar'
import { MicroLabel } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'

function fmtValue(kind: AnomalyKind, v: number): string {
  if (kind === 'latency') return `${Math.round(v)}ms`
  if (kind === 'cost') return `$${v.toFixed(5)}`
  return `${(v * 100).toFixed(1)}%`
}

function fmtDelta(kind: AnomalyKind, current: number, baseline: number): string {
  const pct = baseline > 0 ? ((current - baseline) / baseline) * 100 : 0
  const sign = pct >= 0 ? '+' : ''
  return `${fmtValue(kind, current)} (${sign}${pct.toFixed(0)}% vs ${fmtValue(kind, baseline)} baseline)`
}

function SevDot({ deviations }: { deviations: number }) {
  return (
    <span
      className={cn(
        'w-2 h-2 rounded-full shrink-0',
        deviations >= 5 ? 'bg-bad' : 'bg-accent',
      )}
    />
  )
}

function KindBadge({ kind }: { kind: AnomalyKind }) {
  return (
    <span className="font-mono text-[10.5px] uppercase tracking-[0.04em] bg-bg-elev border border-border px-1.5 py-0.5 rounded text-text-muted">
      {kind}
    </span>
  )
}

function KpiTile({
  label,
  value,
  sub,
  bad,
  accent,
}: {
  label: string
  value: string
  sub?: string
  bad?: boolean
  accent?: boolean
}) {
  return (
    <div className="flex flex-col gap-1 px-6 py-4 border-r border-border last:border-r-0">
      <MicroLabel>{label}</MicroLabel>
      <span
        className={cn(
          'text-[22px] font-semibold leading-none',
          bad ? 'text-bad' : accent ? 'text-accent' : 'text-text',
        )}
      >
        {value}
      </span>
      {sub && <span className="text-[11px] text-text-muted font-mono">{sub}</span>}
    </div>
  )
}

type TabType = 'current' | 'history'

export default function AnomaliesPage() {
  const [tab, setTab] = useState<TabType>('current')

  const {
    data: anomalyResult,
    isLoading: loadingCurrent,
    error: errorCurrent,
  } = useAnomalies({
    observationHours: 1,
    referenceHours: 24 * 7,
    sigma: 3,
  })

  const {
    data: history,
    isLoading: loadingHistory,
    error: errorHistory,
  } = useAnomalyHistory(30)

  const current = anomalyResult?.data ?? []
  const high = current.filter((a) => a.deviations >= 5)
  const medium = current.filter((a) => a.deviations >= 3 && a.deviations < 5)
  const historyCount = history?.length ?? 0

  return (
    <div className="-m-7 flex flex-col h-screen overflow-hidden bg-bg">
      {/* Topbar */}
      <Topbar
        crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Anomalies' }]}
      />

      {/* Stat strip */}
      <div className="grid grid-cols-5 border-b border-border shrink-0">
        <KpiTile
          label="Open now"
          value={String(current.length)}
          bad={current.length > 0}
        />
        <KpiTile
          label="High (≥5σ)"
          value={String(high.length)}
          bad={high.length > 0}
        />
        <KpiTile
          label="Medium (3–5σ)"
          value={String(medium.length)}
          accent={medium.length > 0}
        />
        <KpiTile label="History 30d" value={String(historyCount)} />
        <KpiTile label="Sigma threshold" value="3σ" sub="1h obs · 7d reference" />
      </div>

      {/* Tab bar */}
      <div className="flex items-center px-6 border-b border-border shrink-0">
        {(['current', 'history'] as TabType[]).map((t) => (
          <button
            type="button"
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-3 text-[13px] transition-colors border-b-2 -mb-px',
              tab === t
                ? 'border-accent text-text font-medium'
                : 'border-transparent text-text-muted hover:text-text',
            )}
          >
            {t === 'current' ? 'Right now' : 'History (30d)'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {tab === 'current' ? (
          <CurrentTab anomalies={current} isLoading={loadingCurrent} hasError={!!errorCurrent} />
        ) : (
          <HistoryTab
            history={history ?? []}
            isLoading={loadingHistory}
            hasError={!!errorHistory}
          />
        )}
      </div>
    </div>
  )
}

function CurrentTab({
  anomalies,
  isLoading,
  hasError,
}: {
  anomalies: Anomaly[]
  isLoading: boolean
  hasError: boolean
}) {
  if (isLoading) {
    return (
      <div className="p-6 space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-14 bg-bg-elev rounded animate-pulse" />
        ))}
      </div>
    )
  }

  if (hasError) {
    return (
      <div className="m-6 p-4 rounded border border-bad/20 bg-bad-bg text-[13px] text-bad">
        Failed to load anomalies.
      </div>
    )
  }

  if (anomalies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-text-muted">
        <span className="text-[32px] leading-none">✓</span>
        <p className="text-[13px]">No anomalies in the last hour.</p>
        <p className="text-[12px]">Baselines look healthy.</p>
      </div>
    )
  }

  const high = anomalies.filter((a) => a.deviations >= 5)
  const medium = anomalies.filter((a) => a.deviations >= 3 && a.deviations < 5)

  return (
    <div>
      {high.length > 0 && (
        <AnomalyGroup title="High severity (≥5σ)" anomalies={high} variant="bad" />
      )}
      {medium.length > 0 && (
        <AnomalyGroup title="Medium severity (3–5σ)" anomalies={medium} variant="accent" />
      )}
    </div>
  )
}

function AnomalyGroup({
  title,
  anomalies,
  variant,
}: {
  title: string
  anomalies: Anomaly[]
  variant: 'bad' | 'accent'
}) {
  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-2 px-6 py-2 border-b border-border',
          variant === 'bad' ? 'bg-bad-bg' : 'bg-accent-bg',
        )}
      >
        <span
          className={cn(
            'font-mono text-[10.5px] uppercase tracking-[0.05em] font-semibold',
            variant === 'bad' ? 'text-bad' : 'text-accent',
          )}
        >
          {title}
        </span>
        <span
          className={cn(
            'font-mono text-[10px]',
            variant === 'bad' ? 'text-bad/70' : 'text-accent/70',
          )}
        >
          {anomalies.length}
        </span>
      </div>
      {anomalies.map((a, i) => (
        <div
          key={`${a.provider}-${a.model}-${a.kind}-${i}`}
          className="flex items-center gap-4 px-6 py-3.5 border-b border-border hover:bg-bg-elev transition-colors"
        >
          <SevDot deviations={a.deviations} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="font-medium text-[13px] text-text">
                {a.provider} / {a.model}
              </span>
              <KindBadge kind={a.kind} />
              <span className="font-mono text-[10.5px] text-text-faint">
                {a.deviations > 0 ? '+' : ''}
                {a.deviations.toFixed(1)}σ
              </span>
            </div>
            <p className="text-[12px] text-text-muted font-mono">
              {fmtDelta(a.kind, a.currentValue, a.baselineMean)}
            </p>
            <p className="text-[11px] text-text-faint mt-0.5">
              Sample: {a.sampleCount} · Reference: {a.referenceCount} requests
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

function HistoryTab({
  history,
  isLoading,
  hasError,
}: {
  history: AnomalyHistoryEntry[]
  isLoading: boolean
  hasError: boolean
}) {
  if (isLoading) {
    return (
      <div className="p-6 space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 bg-bg-elev rounded animate-pulse" />
        ))}
      </div>
    )
  }

  if (hasError) {
    return (
      <div className="m-6 p-4 rounded border border-bad/20 bg-bad-bg text-[13px] text-bad">
        Failed to load history.
      </div>
    )
  }

  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-text-muted">
        <p className="text-[13px]">No anomalies recorded in the last 30 days.</p>
        <p className="text-[12px]">
          History is populated by a daily cron job at 04:00 UTC.
        </p>
      </div>
    )
  }

  const groups = new Map<string, AnomalyHistoryEntry[]>()
  for (const entry of history) {
    const list = groups.get(entry.detectedOn) ?? []
    list.push(entry)
    groups.set(entry.detectedOn, list)
  }
  const sortedDates = [...groups.keys()].sort((a, b) => (a < b ? 1 : -1))

  return (
    <div>
      {sortedDates.map((date) => {
        const entries = groups.get(date) ?? []
        return (
          <div key={date}>
            <div className="flex items-center gap-2 px-6 py-2 bg-bg-elev border-b border-border">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.05em] text-text-faint">
                {new Date(date).toLocaleDateString(undefined, {
                  weekday: 'short',
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
              <span className="font-mono text-[10px] text-text-faint">
                {entries.length} anomal{entries.length === 1 ? 'y' : 'ies'}
              </span>
            </div>
            {entries.map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-4 px-6 py-3 border-b border-border hover:bg-bg-elev transition-colors"
              >
                <SevDot deviations={e.deviations} />
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="font-mono text-[12px] text-text-muted truncate">
                    {e.provider} / {e.model}
                  </span>
                  <KindBadge kind={e.kind} />
                </div>
                <div className="flex items-center gap-3 text-[11.5px] font-mono text-text-muted shrink-0">
                  <span>{fmtValue(e.kind, e.currentValue)}</span>
                  <span className="text-text-faint">vs</span>
                  <span>{fmtValue(e.kind, e.baselineMean)}</span>
                  <span className="text-text-faint">
                    {e.deviations > 0 ? '+' : ''}
                    {e.deviations.toFixed(1)}σ
                  </span>
                </div>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
