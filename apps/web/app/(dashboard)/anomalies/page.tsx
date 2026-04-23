'use client'

import { Activity, AlertTriangle } from 'lucide-react'
import {
  useAnomalies,
  useAnomalyHistory,
  type Anomaly,
  type AnomalyHistoryEntry,
  type AnomalyKind,
} from '@/lib/queries/use-anomalies'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DocsLink } from '@/components/layout/docs-link'

function formatValue(kind: AnomalyKind, v: number): string {
  if (kind === 'latency') return `${Math.round(v)}ms`
  if (kind === 'cost') return `$${v.toFixed(5)}`
  return `${(v * 100).toFixed(1)}%` // error_rate as percentage
}

function formatDelta(kind: AnomalyKind, current: number, baseline: number): string {
  const pct = baseline > 0 ? ((current - baseline) / baseline) * 100 : 0
  const direction = pct >= 0 ? '+' : ''
  return `${formatValue(kind, current)} (${direction}${pct.toFixed(0)}% vs ${formatValue(
    kind,
    baseline,
  )} baseline)`
}

function kindBadgeVariant(kind: AnomalyKind): 'secondary' | 'destructive' {
  return kind === 'latency' ? 'secondary' : 'destructive'
}

export default function AnomaliesPage() {
  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Activity className="h-6 w-6 text-orange-500 shrink-0" />
          <div>
            <h1 className="text-2xl font-bold">Anomalies</h1>
            <p className="text-muted-foreground text-sm mt-1">
              3-sigma detection on latency, cost, and error rate per (provider, model) bucket.
            </p>
          </div>
        </div>
        <DocsLink href="/docs/features/anomalies" />
      </div>

      <Tabs defaultValue="current">
        <TabsList>
          <TabsTrigger value="current">Right now (last hour)</TabsTrigger>
          <TabsTrigger value="history">History (30 days)</TabsTrigger>
        </TabsList>

        <TabsContent value="current" className="mt-4">
          <CurrentAnomalies />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <AnomalyHistory />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ── Current anomalies tab ──────────────────────────────────────────────

function CurrentAnomalies() {
  const { data, isLoading, error } = useAnomalies({
    observationHours: 1,
    referenceHours: 24 * 7,
    sigma: 3,
  })
  const anomalies = data?.data ?? []

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive bg-red-50 p-4 text-sm text-red-800">
        Failed to load anomalies.
      </div>
    )
  }

  if (anomalies.length === 0) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-6 text-sm text-green-900">
        🎉 No anomalies in the last hour. Baselines look healthy.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {anomalies.map((a, i) => (
        <AnomalyCard key={`${a.provider}-${a.model}-${a.kind}-${i}`} anomaly={a} />
      ))}
    </div>
  )
}

function AnomalyCard({ anomaly: a }: { anomaly: Anomaly }) {
  return (
    <div className="rounded-lg border bg-white p-4 flex items-start gap-4">
      <AlertTriangle className="h-5 w-5 text-orange-500 mt-0.5 shrink-0" />
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold text-sm">
            {a.provider} / {a.model}
          </span>
          <Badge variant={kindBadgeVariant(a.kind)}>{a.kind}</Badge>
          <Badge variant="outline">
            {a.deviations > 0 ? '+' : ''}
            {a.deviations.toFixed(1)}σ
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {formatDelta(a.kind, a.currentValue, a.baselineMean)}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Sample: {a.sampleCount} / Reference: {a.referenceCount} requests
        </p>
      </div>
    </div>
  )
}

// ── History tab ────────────────────────────────────────────────────────

function AnomalyHistory() {
  const { data: history, isLoading, error } = useAnomalyHistory(30)

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive bg-red-50 p-4 text-sm text-red-800">
        Failed to load history.
      </div>
    )
  }

  if (!history || history.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        <p>No anomalies recorded in the last 30 days.</p>
        <p className="mt-1 text-xs">
          History is populated by a daily cron job at 04:00 UTC. The first run after launch may
          take up to 24 hours to appear here.
        </p>
      </div>
    )
  }

  // Group by detected_on date for a chronological view
  const groups = new Map<string, AnomalyHistoryEntry[]>()
  for (const entry of history) {
    const list = groups.get(entry.detectedOn) ?? []
    list.push(entry)
    groups.set(entry.detectedOn, list)
  }
  const sortedDates = [...groups.keys()].sort((a, b) => (a < b ? 1 : -1))

  return (
    <div className="space-y-6">
      {sortedDates.map((date) => {
        const entries = groups.get(date) ?? []
        return (
          <div key={date}>
            <h3 className="text-sm font-semibold text-muted-foreground mb-2">
              {new Date(date).toLocaleDateString(undefined, {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
              <span className="ml-2 text-xs font-normal">
                ({entries.length} anomal{entries.length === 1 ? 'y' : 'ies'})
              </span>
            </h3>
            <div className="space-y-2">
              {entries.map((e) => (
                <div
                  key={e.id}
                  className="rounded border bg-white px-4 py-2 flex items-center justify-between text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="font-mono text-xs truncate">
                      {e.provider} / {e.model}
                    </span>
                    <Badge variant={kindBadgeVariant(e.kind)} className="shrink-0">
                      {e.kind}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                    <span>{formatValue(e.kind, e.currentValue)}</span>
                    <span className="text-muted-foreground/60">vs</span>
                    <span>{formatValue(e.kind, e.baselineMean)}</span>
                    <Badge variant="outline">
                      {e.deviations > 0 ? '+' : ''}
                      {e.deviations.toFixed(1)}σ
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
