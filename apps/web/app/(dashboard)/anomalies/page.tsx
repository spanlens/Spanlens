'use client'

import { Activity, AlertTriangle } from 'lucide-react'
import { useAnomalies, type Anomaly } from '@/lib/queries/use-anomalies'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'

function formatDelta(kind: Anomaly['kind'], current: number, baseline: number): string {
  const pct = baseline > 0 ? ((current - baseline) / baseline) * 100 : 0
  const direction = pct >= 0 ? '+' : ''
  const unit = kind === 'latency' ? 'ms' : '$'
  const fmt = (v: number) =>
    kind === 'cost' ? `$${v.toFixed(5)}` : `${Math.round(v)}${unit}`
  return `${fmt(current)} (${direction}${pct.toFixed(0)}% vs ${fmt(baseline)} baseline)`
}

export default function AnomaliesPage() {
  const { data, isLoading, error } = useAnomalies({
    observationHours: 1,
    referenceHours: 24 * 7,
    sigma: 3,
  })
  const anomalies = data?.data ?? []
  const meta = data?.meta

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex items-center gap-3">
        <Activity className="h-6 w-6 text-orange-500" />
        <div>
          <h1 className="text-2xl font-bold">Anomalies</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Recent buckets whose latency or cost deviates ≥ 3σ from the{' '}
            {meta ? `${Math.round(meta.referenceHours / 24)}-day` : '7-day'} baseline.
          </p>
        </div>
      </div>

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive bg-red-50 p-4 text-sm text-red-800">
          Failed to load anomalies.
        </div>
      )}

      {!isLoading && !error && anomalies.length === 0 && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-6 text-sm text-green-900">
          🎉 No anomalies in the last hour. Baselines look healthy.
        </div>
      )}

      {anomalies.length > 0 && (
        <div className="space-y-3">
          {anomalies.map((a, i) => (
            <div
              key={`${a.provider}-${a.model}-${a.kind}-${i}`}
              className="rounded-lg border bg-white p-4 flex items-start gap-4"
            >
              <AlertTriangle className="h-5 w-5 text-orange-500 mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-sm">
                    {a.provider} / {a.model}
                  </span>
                  <Badge variant={a.kind === 'latency' ? 'secondary' : 'destructive'}>
                    {a.kind}
                  </Badge>
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
          ))}
        </div>
      )}
    </div>
  )
}
