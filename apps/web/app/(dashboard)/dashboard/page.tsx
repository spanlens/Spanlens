'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Skeleton } from '@/components/ui/skeleton'
import { KpiCard } from '@/components/dashboard/kpi-card'
import { QuotaBanner } from '@/components/dashboard/quota-banner'
import { Topbar, TimeRangeSelector, LiveDot } from '@/components/layout/topbar'
import { useStatsOverview, useStatsTimeseries, useStatsModels } from '@/lib/queries/use-stats'
import { useAnomalies } from '@/lib/queries/use-anomalies'
import { useAlerts } from '@/lib/queries/use-alerts'
import { useRecommendations, type ModelRecommendation } from '@/lib/queries/use-recommendations'
import { useAuditLogs } from '@/lib/queries/use-audit-logs'
import { usePrompts } from '@/lib/queries/use-prompts'
import { cn } from '@/lib/utils'
import { RequestChart } from '@/components/dashboard/request-chart'

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Morning'
  if (h < 18) return 'Afternoon'
  return 'Evening'
}

function fmtCost(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

interface AttnCardProps {
  kind: 'critical' | 'warning' | 'savings'
  title: string
  meta: string
  hint: string
  cta: string
  href: string
}

function AttnCard({ kind, title, meta, hint, cta, href }: AttnCardProps) {
  const isCritical = kind === 'critical'
  const isSavings = kind === 'savings'
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 p-[14px] rounded-md border',
        isCritical
          ? 'bg-accent-bg border-accent-border'
          : isSavings
            ? 'bg-good-bg border-good/20'
            : 'bg-bg-elev border-border',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'inline-block w-[7px] h-[7px] rounded-full shrink-0',
            isCritical ? 'bg-accent' : isSavings ? 'bg-good' : 'bg-text',
          )}
        />
        <span
          className={cn(
            'font-mono text-[9.5px] uppercase tracking-[0.05em] font-semibold',
            isCritical ? 'text-accent' : isSavings ? 'text-good' : 'text-text',
          )}
        >
          {kind}
        </span>
      </div>
      <div className="text-[14.5px] font-medium text-text leading-snug">{title}</div>
      <div className="font-mono text-[11px] text-text-muted tracking-[0.02em]">{meta}</div>
      <div className="text-[12.5px] text-text-muted leading-relaxed">{hint}</div>
      <div className="flex-1" />
      <Link
        href={href}
        className={cn(
          'font-mono text-[11.5px] font-medium tracking-[0.02em] mt-1',
          isCritical ? 'text-accent' : isSavings ? 'text-good' : 'text-text-muted',
          'hover:opacity-80 transition-opacity',
        )}
      >
        {cta}
      </Link>
    </div>
  )
}

export default function DashboardPage() {
  const [timeRange, setTimeRange] = useState('24h')
  const overview = useStatsOverview()
  const timeseries = useStatsTimeseries()
  const anomalies = useAnomalies()
  const alerts = useAlerts()
  const recommendations = useRecommendations()
  const auditLogs = useAuditLogs({ limit: 6 })
  const promptsQuery = usePrompts()
  const modelsQuery = useStatsModels(24)

  const o = overview.data
  const isLoading = overview.isLoading || timeseries.isLoading
  const isError = overview.isError || timeseries.isError

  const errorRate =
    o && o.totalRequests > 0
      ? ((o.errorRequests / o.totalRequests) * 100).toFixed(1) + '%'
      : '0.0%'

  // Derive sparklines from timeseries (last N points)
  const sparkRequests = useMemo(
    () => (timeseries.data ?? []).slice(-10).map((d) => d.requests),
    [timeseries.data],
  )
  const sparkCost = useMemo(
    () => (timeseries.data ?? []).slice(-10).map((d) => d.cost),
    [timeseries.data],
  )
  const sparkErrors = useMemo(
    () => (timeseries.data ?? []).slice(-10).map((d) => d.errors),
    [timeseries.data],
  )

  // Build attention cards from live data
  const attnCards = useMemo(() => {
    const cards: AttnCardProps[] = []

    // Top anomaly
    const topAnomaly = (anomalies.data?.data ?? [])[0]
    if (topAnomaly) {
      cards.push({
        kind: 'critical',
        title: `${topAnomaly.kind.replace('_', ' ')} anomaly on ${topAnomaly.model}`,
        meta: `${topAnomaly.deviations.toFixed(1)}σ · ${topAnomaly.provider}`,
        hint: `Current ${topAnomaly.currentValue.toFixed(0)} vs baseline ${topAnomaly.baselineMean.toFixed(0)}`,
        cta: 'Open anomalies →',
        href: '/anomalies',
      })
    }

    // Top alert — only cards for rules that actually fired in the last hour,
    // not every active rule. Matches the Firing group on the Alerts page.
    const firingAlerts = (alerts.data ?? []).filter(
      (a) =>
        a.is_active &&
        a.last_triggered_at &&
        Date.now() - new Date(a.last_triggered_at).getTime() < 60 * 60 * 1000,
    )
    if (firingAlerts[0]) {
      cards.push({
        kind: 'warning',
        title: firingAlerts[0].name,
        meta: `${firingAlerts.length} alert${firingAlerts.length !== 1 ? 's' : ''} firing`,
        hint: `${String(firingAlerts[0].type).replace('_', ' ')} threshold`,
        cta: 'Open alerts →',
        href: '/alerts',
      })
    }

    // Top recommendation / saving
    const topRec = (recommendations.data ?? [])[0] as ModelRecommendation | undefined
    if (topRec) {
      cards.push({
        kind: 'savings',
        title: `Switch to ${topRec.suggestedModel}`,
        meta: `${topRec.currentModel} · same quality`,
        hint: `~${fmtCost(topRec.estimatedMonthlySavingsUsd)}/mo estimated savings`,
        cta: 'Review & approve →',
        href: '/recommendations',
      })
    }

    return cards
  }, [anomalies.data, alerts.data, recommendations.data])

  return (
    <div className="-m-7 flex flex-col h-screen overflow-hidden">
      <Topbar
        crumbs={[{ label: 'Workspace' }, { label: 'Dashboard' }]}
        right={
          <div className="flex items-center gap-3">
            <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
            <LiveDot />
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto">
        {/* Greeting */}
        <div className="px-[22px] py-[22px] border-b border-border">
          <div className="flex items-baseline gap-3 mb-1">
            <span className="text-[26px] font-medium tracking-[-0.6px]">
              {greeting()}.
            </span>
            <span className="font-mono text-[11px] text-text-faint tracking-[0.03em]">
              {new Date().toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
          {o && (
            <div className="flex items-center gap-2 text-[14px] text-text-muted flex-wrap">
              <span>Since yesterday:</span>
              <b className="text-text font-medium">{o.totalRequests.toLocaleString()} requests</b>
              <span className="text-text-faint">·</span>
              <b className="text-text font-medium">{fmtCost(o.totalCostUsd)} spent</b>
              {(anomalies.data?.data ?? []).length > 0 && (
                <>
                  <span className="text-text-faint">·</span>
                  <span className="text-accent font-medium">
                    {anomalies.data!.data.length} anomal{anomalies.data!.data.length === 1 ? 'y' : 'ies'}
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        <QuotaBanner />

        {isError && (
          <div className="mx-[22px] mt-4 rounded-md border border-bad/30 bg-bad-bg px-4 py-3 flex items-center justify-between">
            <p className="text-[13px] text-bad">Failed to load dashboard data.</p>
            <button
              type="button"
              onClick={() => { void overview.refetch(); void timeseries.refetch() }}
              className="font-mono text-[11px] px-2.5 py-1 border border-border rounded text-text-muted hover:border-border-strong transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Needs attention */}
        {attnCards.length > 0 && (
          <div className="px-[22px] pt-[18px] pb-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2.5">
              Needs attention
            </div>
            <div className="grid grid-cols-3 gap-3">
              {attnCards.map((c, i) => (
                <AttnCard key={i} {...c} />
              ))}
            </div>
          </div>
        )}

        {/* KPI row */}
        <div className="grid grid-cols-4 border-y border-border mt-[18px]">
          {isLoading || !o ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="p-[18px] border-r border-border last:border-r-0">
                <Skeleton className="h-3 w-28 mb-3" />
                <Skeleton className="h-8 w-36 mb-3" />
                <Skeleton className="h-5 w-full" />
              </div>
            ))
          ) : (
            <>
              <KpiCard
                label="Requests · 30d"
                value={o.totalRequests.toLocaleString()}
                sparkValues={sparkRequests}
                linkLabel="Requests →"
                linkHref="/requests"
              />
              <KpiCard
                label="Spend · 30d"
                value={fmtCost(o.totalCostUsd)}
                sparkValues={sparkCost}
                deltaVariant="good"
                linkLabel="Savings →"
                linkHref="/recommendations"
              />
              <KpiCard
                label="Avg latency"
                value={`${o.avgLatencyMs}ms`}
                sparkValues={[]}
                linkLabel="Traces →"
                linkHref="/traces"
              />
              <KpiCard
                label="Error rate"
                value={errorRate}
                sparkValues={sparkErrors}
                deltaVariant={
                  parseFloat(errorRate) > 1 ? 'warn' : 'neutral'
                }
                linkLabel="Anomalies →"
                linkHref="/anomalies"
              />
            </>
          )}
        </div>

        {/* Traffic chart */}
        <div className="px-[22px] py-5 border-b border-border">
          <div className="flex items-center mb-3">
            <span className="text-[15px] font-medium">Traffic · last 30d</span>
          </div>
          {isLoading || !timeseries.data ? (
            <Skeleton className="h-[220px] w-full" />
          ) : (
            <RequestChart data={timeseries.data} />
          )}
        </div>

        {/* 2-col: Top prompts + Models in use */}
        <div className="grid grid-cols-2 border-b border-border">
          <div className="px-[22px] py-[18px] border-r border-border">
            <div className="flex items-center mb-3">
              <span className="text-[14px] font-medium">Top prompts · 24h spend</span>
              <span className="flex-1" />
              <Link href="/prompts" className="font-mono text-[10.5px] text-text-muted tracking-[0.03em] hover:text-text transition-colors">
                All prompts →
              </Link>
            </div>
            {(() => {
              const active = (promptsQuery.data ?? [])
                .filter((p) => (p.stats?.calls ?? 0) > 0)
                .sort((a, b) => (b.stats?.totalCostUsd ?? 0) - (a.stats?.totalCostUsd ?? 0))
                .slice(0, 5)
              const topMax = active[0]?.stats?.totalCostUsd ?? 0

              if (promptsQuery.isLoading) {
                return (
                  <div className="space-y-2.5">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-2.5 py-2.5 border-b border-border last:border-0">
                        <Skeleton className="h-3 w-4" />
                        <div className="flex-1 space-y-1.5">
                          <Skeleton className="h-3 w-32" />
                          <Skeleton className="h-1.5 w-full" />
                        </div>
                        <Skeleton className="h-3 w-12" />
                      </div>
                    ))}
                  </div>
                )
              }

              if (active.length === 0) {
                return (
                  <p className="font-mono text-[12px] text-text-faint">
                    No prompt calls in the last 24h. Use the <code className="text-text">X-Spanlens-Prompt-Version</code> header to tag requests.
                  </p>
                )
              }

              return (
                <div className="space-y-0">
                  {active.map((p, i) => {
                    const cost = p.stats?.totalCostUsd ?? 0
                    const pct = topMax > 0 ? (cost / topMax) * 100 : 0
                    return (
                      <div key={p.id} className="flex items-center gap-3 py-2.5 border-b border-border last:border-0">
                        <span className="font-mono text-[10.5px] text-text-faint w-4">#{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12.5px] text-text truncate">{p.name}</div>
                          <div className="h-1 bg-bg-muted rounded-full overflow-hidden mt-1">
                            <div className="h-full bg-text rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-mono text-[12px] text-text font-medium">{fmtCost(cost)}</div>
                          <div className="font-mono text-[10px] text-text-faint">{(p.stats?.calls ?? 0).toLocaleString()} calls</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
          <div className="px-[22px] py-[18px]">
            <div className="flex items-center mb-3">
              <span className="text-[14px] font-medium">Models in use · 24h</span>
              <span className="flex-1" />
              <Link href="/requests" className="font-mono text-[10.5px] text-text-muted tracking-[0.03em] hover:text-text transition-colors">
                All requests →
              </Link>
            </div>
            {modelsQuery.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="grid py-2.5 border-b border-border last:border-0" style={{ gridTemplateColumns: '1fr 80px 90px 70px', gap: 10 }}>
                    <Skeleton className="h-3 w-28" />
                    <Skeleton className="h-3 w-12 ml-auto" />
                    <Skeleton className="h-3 w-14 ml-auto" />
                    <Skeleton className="h-3 w-10 ml-auto" />
                  </div>
                ))}
              </div>
            ) : (modelsQuery.data ?? []).length === 0 ? (
              <p className="font-mono text-[12px] text-text-faint">No requests in the last 24 hours.</p>
            ) : (
              <div>
                <div className="grid font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint pb-2 border-b border-border" style={{ gridTemplateColumns: '1fr 80px 90px 70px', gap: 10 }}>
                  <span>Model</span>
                  <span className="text-right">Requests</span>
                  <span className="text-right">Cost · total</span>
                  <span className="text-right">Avg lat</span>
                </div>
                {(modelsQuery.data ?? []).slice(0, 6).map((m) => (
                  <div
                    key={`${m.provider}/${m.model}`}
                    className="py-2 border-b border-border last:border-0 grid items-center font-mono"
                    style={{ gridTemplateColumns: '1fr 80px 90px 70px', gap: 10 }}
                  >
                    <span className="text-[12.5px] text-text truncate">
                      <span className="text-text-faint text-[10.5px] uppercase tracking-[0.04em] mr-1.5">{m.provider}</span>
                      {m.model}
                    </span>
                    <span className="text-[12px] text-text-muted text-right">{m.requests.toLocaleString()}</span>
                    <span className="text-[12px] text-text font-medium text-right">{fmtCost(m.totalCostUsd)}</span>
                    <span className={cn('text-[12px] text-right', m.errorRate > 0.05 ? 'text-bad' : 'text-text-muted')}>
                      {m.avgLatencyMs}ms
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Bottom 2-col: Alerts + Recommendations */}
        <div className="grid grid-cols-2 border-b border-border">
          {/* Active alerts */}
          <div className="px-[22px] py-[18px] border-r border-border">
            <div className="flex items-center mb-3">
              <span className="text-[14px] font-medium">Active alerts</span>
              <span className="flex-1" />
              <Link
                href="/alerts"
                className={cn(
                  'font-mono text-[10.5px] tracking-[0.03em]',
                  (alerts.data ?? []).filter((a) => a.is_active).length > 0
                    ? 'text-accent'
                    : 'text-text-muted',
                )}
              >
                {(alerts.data ?? []).filter((a) => a.is_active).length} firing →
              </Link>
            </div>
            {(alerts.data ?? []).filter((a) => a.is_active).length === 0 ? (
              <p className="text-[13px] text-text-faint">No active alerts.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {(alerts.data ?? [])
                  .filter((a) => a.is_active)
                  .slice(0, 3)
                  .map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center gap-2.5 px-3 py-2.5 rounded-[5px] bg-accent-bg border border-accent-border"
                    >
                      <span className="w-2 h-2 rounded-full bg-accent shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] text-text truncate">{a.name}</div>
                        <div className="font-mono text-[10px] text-text-faint mt-0.5 uppercase tracking-[0.04em]">
                          {a.type}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Recommendations */}
          <div className="px-[22px] py-[18px]">
            <div className="flex items-center mb-3">
              <span className="text-[14px] font-medium">Savings queued</span>
              <span className="flex-1" />
              <Link href="/recommendations" className="font-mono text-[10.5px] text-good tracking-[0.03em]">
                View all →
              </Link>
            </div>
            {(recommendations.data ?? []).length === 0 ? (
              <p className="text-[13px] text-text-faint">No recommendations yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {(recommendations.data ?? []).slice(0, 3).map((r, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-[5px] bg-bg-elev border border-border"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-[12px] text-text font-medium truncate">
                        {r.currentModel}
                      </div>
                      <div className="font-mono text-[10.5px] text-text-muted mt-0.5">
                        {r.currentModel} → <span className="text-good">{r.suggestedModel}</span>
                      </div>
                    </div>
                    <span className="font-mono text-[13px] text-good font-medium shrink-0">
                      −{fmtCost(r.estimatedMonthlySavingsUsd)}/mo
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Activity feed */}
        <div className="px-[22px] py-[18px]">
          <div className="flex items-center mb-3">
            <span className="text-[14px] font-medium">Recent activity</span>
            <span className="flex-1" />
            <Link href="/settings" className="font-mono text-[10.5px] text-text-muted tracking-[0.03em] hover:text-text transition-colors">
              Audit log →
            </Link>
          </div>
          {auditLogs.isLoading ? (
            <div className="space-y-2 py-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : (auditLogs.data ?? []).length === 0 ? (
            <div className="py-4 text-[12.5px] text-text-faint">
              No recent activity. Audit events appear when you create keys, deploy prompts, change billing, etc.
            </div>
          ) : (
            (auditLogs.data ?? []).map((e, i, arr) => {
              const kind = e.action.split('.')[0] ?? 'event'
              const isAccent = kind === 'alert' || kind === 'anomaly' || kind === 'billing'
              return (
                <div
                  key={e.id}
                  className={cn('grid items-baseline py-2', i < arr.length - 1 && 'border-b border-border')}
                  style={{ gridTemplateColumns: '56px 80px 1fr', gap: 14 }}
                >
                  <span className="font-mono text-[10.5px] text-text-faint">
                    {new Date(e.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                  </span>
                  <span className={cn(
                    'font-mono text-[9px] uppercase tracking-[0.04em] px-[5px] py-[1px] rounded-[3px] border self-center',
                    isAccent ? 'text-accent border-accent-border' : 'text-text-faint border-border',
                  )}>{kind}</span>
                  <div className="text-[12.5px] text-text leading-snug font-mono">
                    {e.action}
                    {e.resource_type && <span className="text-text-muted"> · {e.resource_type}</span>}
                    {e.resource_id && <span className="text-text-faint"> · {e.resource_id.slice(0, 12)}</span>}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
