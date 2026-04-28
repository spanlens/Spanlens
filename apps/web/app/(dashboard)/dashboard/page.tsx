'use client'
import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Skeleton } from '@/components/ui/skeleton'
import { KpiCard } from '@/components/dashboard/kpi-card'
import { QuotaBanner } from '@/components/dashboard/quota-banner'
import { Topbar, TimeRangeSelector, LiveDot } from '@/components/layout/topbar'
import { useStatsOverview, useStatsTimeseries, useStatsModels, useSpendForecast } from '@/lib/queries/use-stats'
import { useAnomalies } from '@/lib/queries/use-anomalies'
import { useAlerts } from '@/lib/queries/use-alerts'
import { useRecommendations, type ModelRecommendation } from '@/lib/queries/use-recommendations'
import { useAuditLogs } from '@/lib/queries/use-audit-logs'
import { usePrompts } from '@/lib/queries/use-prompts'
import { useSecuritySummary } from '@/lib/queries/use-security'
import { useDismissals, useDismissCard } from '@/lib/queries/use-dismissals'
import { useCurrentProjectId } from '@/lib/project-context'
import { cn } from '@/lib/utils'
import { RequestChart } from '@/components/dashboard/request-chart'
import { SpendForecastCard } from '@/components/dashboard/spend-forecast'
import { WelcomeBanner } from '@/components/dashboard/welcome-banner'

// ── Helpers ────────────────────────────────────────────────────

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Morning'
  if (h < 18) return 'Afternoon'
  return 'Evening'
}

function fmtCost(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDelta(delta: number | null | undefined): string | undefined {
  if (delta == null) return undefined
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toFixed(1)}%`
}

function deltaVariantFor(
  delta: number | null | undefined,
  higherIsBetter: boolean,
): 'warn' | 'good' | 'neutral' {
  if (delta == null || delta === 0) return 'neutral'
  const positive = delta > 0
  return positive === higherIsBetter ? 'good' : 'warn'
}

function timeRangeToHours(range: string): number {
  switch (range) {
    case '1h': return 1
    case '7d': return 24 * 7
    case '30d': return 24 * 30
    default: return 24
  }
}

function sinceLabel(range: string): string {
  switch (range) {
    case '1h': return 'Last hour:'
    case '24h': return 'Last 24h:'
    case '7d': return 'Last 7 days:'
    case '30d': return 'Last 30 days:'
    default: return 'Last 24h:'
  }
}

const AUDIT_LABELS: Record<string, string> = {
  'key.created': 'API key created',
  'key.deleted': 'API key deleted',
  'key.updated': 'API key updated',
  'provider_key.created': 'Provider key added',
  'provider_key.deleted': 'Provider key deleted',
  'provider_key.updated': 'Provider key updated',
  'security.stale_key_digest_sent': 'Stale key digest sent',
  'security.leak_scan.completed': 'Leak scan completed',
  'security.leak_detected': 'Key leak detected',
  'billing.subscription.updated': 'Subscription updated',
  'billing.subscription.canceled': 'Subscription canceled',
  'billing.payment.succeeded': 'Payment succeeded',
  'org.updated': 'Organization settings updated',
  'org.member.invited': 'Member invited',
  'org.member.removed': 'Member removed',
  'alert.triggered': 'Alert triggered',
  'anomaly.detected': 'Anomaly detected',
  'anomaly.acknowledged': 'Anomaly acknowledged',
  'prompt.created': 'Prompt created',
  'prompt.deleted': 'Prompt deleted',
}

function formatAuditAction(action: string): string {
  if (AUDIT_LABELS[action]) return AUDIT_LABELS[action]
  return action
    .split('.')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ')
}

// ── Attention card ─────────────────────────────────────────────

interface AttnCardProps {
  kind: 'critical' | 'warning' | 'savings'
  cardKey: string
  title: string
  meta: string
  hint: string
  cta: string
  href: string
  onDismiss?: () => void
}

function AttnCard({ kind, title, meta, hint, cta, href, onDismiss }: AttnCardProps) {
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
        <button
          type="button"
          onClick={onDismiss}
          className="ml-auto text-text-faint hover:text-text-muted transition-colors leading-none"
          aria-label="Dismiss"
        >
          ✕
        </button>
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

// ── Page ───────────────────────────────────────────────────────

const LIVE_REFETCH_MS = 30_000

export default function DashboardPage() {
  const [timeRange, setTimeRange] = useState('24h')
  const hours = timeRangeToHours(timeRange)
  const projectId = useCurrentProjectId()
  const dismissalsQuery = useDismissals()
  const dismissMutation = useDismissCard()
  const dismissedCards = useMemo(
    () => new Set(dismissalsQuery.data ?? []),
    [dismissalsQuery.data],
  )

  // Round `from` to the nearest minute so the query key stays stable between
  // renders and only changes when the user switches the time range.
  const queryDateRange = useMemo(() => {
    const fromMs = Math.floor((Date.now() - hours * 60 * 60 * 1000) / 60_000) * 60_000
    return { from: new Date(fromMs).toISOString() }
  }, [hours])

  const scopeArg = projectId ? { projectId } : {}
  const timeArg = { ...scopeArg, ...queryDateRange }

  const overview = useStatsOverview({ ...timeArg, compare: true }, { refetchInterval: LIVE_REFETCH_MS })
  const timeseries = useStatsTimeseries(timeArg, { refetchInterval: LIVE_REFETCH_MS })
  const anomalies = useAnomalies({ ...scopeArg, observationHours: hours })
  const alerts = useAlerts()
  const recommendations = useRecommendations({ hours })
  const auditLogs = useAuditLogs({ limit: 6 })
  const promptsQuery = usePrompts(projectId ?? undefined)
  const modelsQuery = useStatsModels(hours, projectId ?? undefined, { refetchInterval: LIVE_REFETCH_MS })
  const spendForecast = useSpendForecast(projectId ?? undefined)
  const securitySummary = useSecuritySummary(hours)

  const o = overview.data
  const isLoading = overview.isLoading || timeseries.isLoading
  const isError = overview.isError || timeseries.isError

  const errorRate = o ? (o.errorRate * 100).toFixed(1) + '%' : '0.0%'

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

  const [exportOpen, setExportOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)

  function buildExportData() {
    return {
      summary: o
        ? {
            timeRange,
            totalRequests: o.totalRequests,
            totalSpendUsd: o.totalCostUsd,
            avgLatencyMs: o.avgLatencyMs,
            errorRatePct: parseFloat((o.errorRate * 100).toFixed(2)),
          }
        : null,
      timeseries: (timeseries.data ?? []).map((d) => ({
        date: d.date,
        requests: d.requests,
        spendUsd: d.cost,
        tokens: d.tokens,
        errors: d.errors,
      })),
      models: (modelsQuery.data ?? []).map((m) => ({
        provider: m.provider,
        model: m.model,
        requests: m.requests,
        totalSpendUsd: m.totalCostUsd,
        avgLatencyMs: m.avgLatencyMs,
        errorRatePct: parseFloat((m.errorRate * 100).toFixed(2)),
      })),
    }
  }

  function triggerDownload(content: string, mime: string, ext: string) {
    const blob = new Blob([content], { type: `${mime};charset=utf-8;` })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `spanlens-${timeRange}-${new Date().toISOString().slice(0, 10)}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
    setExportOpen(false)
  }

  function exportCsv() {
    const d = buildExportData()
    const lines: string[] = []
    lines.push(`## Summary · ${timeRange}`)
    lines.push('Total Requests,Total Spend (USD),Avg Latency (ms),Error Rate (%)')
    if (d.summary) {
      lines.push(
        `${d.summary.totalRequests},${d.summary.totalSpendUsd.toFixed(4)},${d.summary.avgLatencyMs},${d.summary.errorRatePct}`,
      )
    }
    lines.push('')
    lines.push('## Timeseries')
    lines.push('Date,Requests,Spend (USD),Tokens,Errors')
    for (const r of d.timeseries) {
      lines.push(`${r.date},${r.requests},${r.spendUsd.toFixed(4)},${r.tokens},${r.errors}`)
    }
    lines.push('')
    lines.push('## Models')
    lines.push('Provider,Model,Requests,Total Spend (USD),Avg Latency (ms),Error Rate (%)')
    for (const m of d.models) {
      lines.push(
        `${m.provider},${m.model},${m.requests},${m.totalSpendUsd.toFixed(4)},${m.avgLatencyMs},${m.errorRatePct}`,
      )
    }
    triggerDownload(lines.join('\n'), 'text/csv', 'csv')
  }

  function exportJson() {
    const d = buildExportData()
    triggerDownload(JSON.stringify(d, null, 2), 'application/json', 'json')
  }

  // ISO timestamps of alerts that fired within the current time range — for chart markers
  const alertFiredAt = useMemo(
    () =>
      (alerts.data ?? [])
        .filter((a) => {
          if (!a.last_triggered_at) return false
          return Date.now() - new Date(a.last_triggered_at).getTime() < hours * 60 * 60 * 1000
        })
        .map((a) => a.last_triggered_at as string),
    [alerts.data, hours],
  )

  // Active alert rules vs recently fired (within the selected time window)
  const activeAlertRules = useMemo(
    () => (alerts.data ?? []).filter((a) => a.is_active),
    [alerts.data],
  )
  const firingAlerts = useMemo(
    () =>
      activeAlertRules.filter(
        (a) =>
          a.last_triggered_at &&
          Date.now() - new Date(a.last_triggered_at).getTime() < hours * 60 * 60 * 1000,
      ),
    [activeAlertRules, hours],
  )

  // Build attention cards — security > anomaly > alert > savings
  const attnCards = useMemo(() => {
    const cards: AttnCardProps[] = []

    const piiHits = (securitySummary.data ?? [])
      .filter((r) => r.type === 'pii')
      .reduce((sum, r) => sum + r.count, 0)
    if (piiHits > 0) {
      cards.push({
        kind: 'critical',
        cardKey: 'pii_leak',
        title: `PII leak · ${piiHits} match${piiHits === 1 ? '' : 'es'} in last ${timeRange}`,
        meta: 'email · phone · card · ssn · passport',
        hint: 'Review flagged requests to identify the source prompt.',
        cta: 'Open security →',
        href: '/security',
      })
    }

    const topAnomaly = (anomalies.data?.data ?? [])[0]
    if (topAnomaly) {
      const qs = new URLSearchParams({
        provider: topAnomaly.provider,
        model: topAnomaly.model,
      }).toString()
      cards.push({
        kind: 'critical',
        cardKey: `anomaly:${topAnomaly.provider}:${topAnomaly.model}:${topAnomaly.kind}`,
        title: `${topAnomaly.kind.replaceAll('_', ' ')} anomaly on ${topAnomaly.model}`,
        meta: `${topAnomaly.deviations.toFixed(1)}σ · ${topAnomaly.provider}`,
        hint: `Current ${topAnomaly.currentValue.toFixed(0)} vs baseline ${topAnomaly.baselineMean.toFixed(0)}`,
        cta: 'Investigate requests →',
        href: `/requests?${qs}`,
      })
    }

    if (firingAlerts[0]) {
      const top = firingAlerts[0]
      const firedMinsAgo = top.last_triggered_at
        ? Math.max(1, Math.round((Date.now() - new Date(top.last_triggered_at).getTime()) / 60_000))
        : null
      const thresholdLabel =
        top.type === 'budget'
          ? `> $${top.threshold}`
          : top.type === 'error_rate'
            ? `> ${(top.threshold * 100).toFixed(1)}%`
            : `> ${top.threshold}ms`
      const kindLabel =
        top.type === 'budget' ? 'budget' : top.type === 'error_rate' ? 'error rate' : 'p95 latency'
      cards.push({
        kind: 'warning',
        cardKey: `alert:${top.id}`,
        title: top.name,
        meta: `${kindLabel} ${thresholdLabel} · ${top.window_minutes}m window`,
        hint: firedMinsAgo != null
          ? `fired ${firedMinsAgo}m ago${firingAlerts.length > 1 ? ` · +${firingAlerts.length - 1} more firing` : ''}`
          : `${firingAlerts.length} alert${firingAlerts.length !== 1 ? 's' : ''} firing`,
        cta: 'Open alert →',
        href: `/alerts/${top.id}`,
      })
    }

    const topRec = (recommendations.data ?? [])[0] as (ModelRecommendation & { id?: string }) | undefined
    if (topRec) {
      cards.push({
        kind: 'savings',
        cardKey: `savings:${topRec.id ?? `${topRec.currentModel}->${topRec.suggestedModel}`}`,
        title: `Switch to ${topRec.suggestedModel}`,
        meta: `${topRec.currentModel} · same quality`,
        hint: `~${fmtCost(topRec.estimatedMonthlySavingsUsd)}/mo estimated savings`,
        cta: 'Review & approve →',
        href: '/recommendations',
      })
    }

    return cards
  }, [anomalies.data, firingAlerts, recommendations.data, securitySummary.data, timeRange])

  return (
    <div className="-m-7 flex flex-col h-screen overflow-hidden">
      <Topbar
        crumbs={[{ label: 'Workspace' }, { label: 'Dashboard' }]}
        right={
          <div className="flex items-center gap-3">
            <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
            <LiveDot refetching={overview.isFetching || timeseries.isFetching} />
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto">
        {/* Greeting */}
        <div className="px-[22px] py-[22px] border-b border-border">
          <div className="flex items-baseline gap-3 mb-1">
            {/* suppressHydrationWarning: greeting() uses new Date() — server UTC ≠ client local time */}
            <span suppressHydrationWarning className="text-[26px] font-medium tracking-[-0.6px]">
              {greeting()}.
            </span>
            <span suppressHydrationWarning className="font-mono text-[11px] text-text-faint tracking-[0.03em]">
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
            <div className="flex items-center gap-2 text-[14px] text-text-muted">
              <span>{sinceLabel(timeRange)}</span>
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
              <div ref={exportRef} className="ml-auto relative shrink-0">
                <button
                  type="button"
                  onClick={() => setExportOpen((v) => !v)}
                  className="font-mono text-[11px] text-text-muted hover:text-text border border-border rounded px-2.5 py-1 transition-colors"
                >
                  Export ↓
                </button>
                {exportOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
                    <div className="absolute right-0 top-full mt-1 z-20 bg-bg-elev border border-border rounded shadow-sm min-w-[100px]">
                      <button
                        type="button"
                        onClick={exportCsv}
                        className="w-full text-left px-3 py-2 font-mono text-[11px] text-text-muted hover:text-text hover:bg-bg transition-colors"
                      >
                        CSV
                      </button>
                      <button
                        type="button"
                        onClick={exportJson}
                        className="w-full text-left px-3 py-2 font-mono text-[11px] text-text-muted hover:text-text hover:bg-bg transition-colors"
                      >
                        JSON
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <WelcomeBanner />

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
        {attnCards.filter((c) => !dismissedCards.has(c.cardKey)).length > 0 && (
          <div className="px-[22px] pt-[18px] pb-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2.5">
              Needs attention
            </div>
            <div className="grid grid-cols-3 gap-3">
              {attnCards.map((c) =>
                dismissedCards.has(c.cardKey) ? null : (
                  <AttnCard
                    key={c.cardKey}
                    {...c}
                    onDismiss={() => dismissMutation.mutate(c.cardKey)}
                  />
                )
              )}
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
                label={`Requests · ${timeRange}`}
                value={o.totalRequests.toLocaleString()}
                delta={fmtDelta(o.requestsDelta)}
                deltaVariant={deltaVariantFor(o.requestsDelta, true)}
                sparkValues={sparkRequests}
                linkLabel="Requests →"
                linkHref="/requests"
              />
              <KpiCard
                label={`Spend · ${timeRange}`}
                value={fmtCost(o.totalCostUsd)}
                delta={fmtDelta(o.costDelta)}
                deltaVariant={deltaVariantFor(o.costDelta, false)}
                sparkValues={sparkCost}
                linkLabel="Savings →"
                linkHref="/recommendations"
              />
              <KpiCard
                label={`Avg latency · ${timeRange}`}
                value={`${o.avgLatencyMs}ms`}
                delta={fmtDelta(o.latencyDelta)}
                deltaVariant={deltaVariantFor(o.latencyDelta, false)}
                sparkValues={[]}
                linkLabel="Traces →"
                linkHref="/traces"
              />
              <KpiCard
                label="Error rate"
                value={errorRate}
                delta={fmtDelta(o.errorRateDelta)}
                deltaVariant={deltaVariantFor(o.errorRateDelta, false)}
                sparkValues={sparkErrors}
                linkLabel="Anomalies →"
                linkHref="/anomalies"
              />
            </>
          )}
        </div>

        {/* Traffic chart */}
        <div className="px-[22px] py-5 border-b border-border">
          <div className="flex items-center mb-3">
            <span className="text-[15px] font-medium">Traffic &amp; spend · last {timeRange}</span>
          </div>
          {isLoading || !timeseries.data ? (
            <Skeleton className="h-[220px] w-full" />
          ) : (
            <RequestChart data={timeseries.data} firedAt={alertFiredAt} />
          )}
        </div>

        {/* Spend forecast — always monthly, independent of time range selector */}
        {spendForecast.data && <SpendForecastCard data={spendForecast.data} />}

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
              <span className="text-[14px] font-medium">Models in use · {timeRange}</span>
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
              <p className="font-mono text-[12px] text-text-faint">No requests in the last {timeRange}.</p>
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
          {/* Active alert rules */}
          <div className="px-[22px] py-[18px] border-r border-border">
            <div className="flex items-center mb-3">
              <span className="text-[14px] font-medium">Active alerts</span>
              <span className="flex-1" />
              <Link
                href="/alerts"
                className={cn(
                  'font-mono text-[10.5px] tracking-[0.03em]',
                  firingAlerts.length > 0 ? 'text-accent' : 'text-text-muted',
                )}
              >
                {firingAlerts.length > 0
                  ? `${firingAlerts.length} firing →`
                  : `${activeAlertRules.length} rule${activeAlertRules.length !== 1 ? 's' : ''} →`}
              </Link>
            </div>
            {activeAlertRules.length === 0 ? (
              <p className="text-[13px] text-text-faint">No active alert rules.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {activeAlertRules.slice(0, 3).map((a) => {
                  const fired = a.last_triggered_at
                    ? Date.now() - new Date(a.last_triggered_at).getTime() < hours * 60 * 60 * 1000
                    : false
                  const minsAgo = a.last_triggered_at
                    ? Math.max(1, Math.round((Date.now() - new Date(a.last_triggered_at).getTime()) / 60_000))
                    : null
                  return (
                    <div
                      key={a.id}
                      className={cn(
                        'flex items-center gap-2.5 px-3 py-2.5 rounded-[5px] border',
                        fired
                          ? 'bg-accent-bg border-accent-border'
                          : 'bg-bg-elev border-border',
                      )}
                    >
                      <span className={cn('w-2 h-2 rounded-full shrink-0', fired ? 'bg-accent' : 'bg-text-faint')} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] text-text truncate">{a.name}</div>
                        <div className="font-mono text-[10px] text-text-faint mt-0.5 uppercase tracking-[0.04em]">
                          {fired && minsAgo != null ? `fired ${minsAgo}m ago` : a.type}
                        </div>
                      </div>
                    </div>
                  )
                })}
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
                {(recommendations.data ?? []).slice(0, 3).map((r) => (
                  <div
                    key={`${r.currentModel}->${r.suggestedModel}`}
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
            <Link
              href="/settings?tab=audit-log"
              className="font-mono text-[10.5px] text-text-muted tracking-[0.03em] hover:text-text transition-colors"
            >
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
                  <div className="text-[12.5px] text-text leading-snug">
                    {formatAuditAction(e.action)}
                    {e.resource_id && (
                      <span className="font-mono text-[10.5px] text-text-faint ml-1.5">
                        · {e.resource_id.slice(0, 8)}
                      </span>
                    )}
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
