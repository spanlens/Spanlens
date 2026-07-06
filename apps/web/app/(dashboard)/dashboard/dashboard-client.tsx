'use client'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { Skeleton } from '@/components/ui/skeleton'
import { KpiCard } from '@/components/dashboard/kpi-card'
import { QuotaBanner } from '@/components/dashboard/quota-banner'
import { UpsellModal } from '@/components/dashboard/upsell-modal'
import { Topbar, TimeRangeSelector, type CustomRange } from '@/components/layout/topbar'
import { useStatsOverview, useStatsTimeseries, useStatsModels, useSpendForecast } from '@/lib/queries/use-stats'
import { useAnomalies } from '@/lib/queries/use-anomalies'
import { useAlerts } from '@/lib/queries/use-alerts'
import { useRecommendations, type ModelRecommendation } from '@/lib/queries/use-recommendations'
import { useStaleKeyCounts } from '@/lib/queries/use-stale-keys'
import { useAuditLogs } from '@/lib/queries/use-audit-logs'
import { usePrompts } from '@/lib/queries/use-prompts'
import { useSecuritySummary } from '@/lib/queries/use-security'
import { useDismissals, useDismissCard } from '@/lib/queries/use-dismissals'
import { buildInvestigateHref, investigateRangeForObservationHours } from '@/lib/anomaly-investigate'
import { cn, formatTime } from '@/lib/utils'
import { linkPrefetchFor } from '@/lib/heavy-pages'
import dynamic from 'next/dynamic'
import { WelcomeBanner } from '@/components/dashboard/welcome-banner'
import { ErrorBoundary } from '@/components/error-boundary'
import { LIVE_REFETCH_MS_ACTIVE as LIVE_REFETCH_MS } from '@/lib/queries/live-polling'

// Lazy-load recharts-heavy components. They render below the fold and are
// not needed for the initial KPI row / greeting paint.
const RequestChart = dynamic(
  () => import('@/components/dashboard/request-chart').then((m) => m.RequestChart),
  { ssr: false, loading: () => <Skeleton className="h-[220px] w-full" /> },
)
const SpendForecastCard = dynamic(
  () => import('@/components/dashboard/spend-forecast').then((m) => m.SpendForecastCard),
  { ssr: false, loading: () => <Skeleton className="h-[320px] w-full" /> },
)
// New breakdown cards. Same SSR-off treatment as the existing charts —
// recharts measures its own width via ResizeObserver, which isn't available
// on the server (CLAUDE.md gotcha #22 D).
const CostBreakdownCard = dynamic(
  () => import('@/components/dashboard/cost-breakdown').then((m) => m.CostBreakdownCard),
  { ssr: false, loading: () => <Skeleton className="h-[290px] w-full" /> },
)
const TokenTrendsCard = dynamic(
  () => import('@/components/dashboard/token-trends').then((m) => m.TokenTrendsCard),
  { ssr: false, loading: () => <Skeleton className="h-[260px] w-full" /> },
)
const ErrorDistributionCard = dynamic(
  () => import('@/components/dashboard/error-distribution').then((m) => m.ErrorDistributionCard),
  { ssr: false, loading: () => <Skeleton className="h-[260px] w-full" /> },
)

// ── Helpers ────────────────────────────────────────────────────

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Morning'
  if (h < 18) return 'Afternoon'
  return 'Evening'
}

import { fmtCostKpi as fmtCost } from '@/lib/format'

// `hasBaseline` lets us distinguish "no prior data" (suppress delta) from
// a real -100% drop. When the previous period had zero traffic the API may
// still return -100 — that number is mathematically correct but useless,
// so we hide it.
function fmtDelta(
  delta: number | null | undefined,
  hasBaseline: boolean,
): string | undefined {
  if (delta == null) return undefined
  if (!hasBaseline) return undefined
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toFixed(1)}%`
}

function deltaVariantFor(
  delta: number | null | undefined,
  higherIsBetter: boolean,
  hasBaseline: boolean,
): 'warn' | 'good' | 'neutral' {
  if (!hasBaseline) return 'neutral'
  if (delta == null || delta === 0) return 'neutral'
  const positive = delta > 0
  return positive === higherIsBetter ? 'good' : 'warn'
}

// Stable refs for useSyncExternalStore — return true on the client snapshot
// and false on the SSR snapshot, with no subscription needed.
const subscribeNoop = () => () => {}
const getTrue = () => true
const getFalse = () => false

function tzShort(): string {
  try {
    const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(new Date())
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
  } catch {
    return ''
  }
}

function timeRangeToHours(range: string): number {
  switch (range) {
    case '1h': return 1
    case '7d': return 24 * 7
    case '30d': return 24 * 30
    default: return 24
  }
}

function sinceLabel(range: string, custom: CustomRange | null): string {
  if (range === 'custom' && custom) {
    const f = new Date(custom.from).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const t = new Date(custom.to).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    return `${f} – ${t}:`
  }
  switch (range) {
    case '1h': return 'Last hour:'
    case '24h': return 'Last 24h:'
    case '7d': return 'Last 7 days:'
    case '30d': return 'Last 30 days:'
    default: return 'Last 24h:'
  }
}

// A short label suitable for inline section titles ("Models in use · 24h"
// or "Models in use · custom"). For custom we use the duration in days so
// the label stays compact and readable.
function shortRangeLabel(range: string, custom: CustomRange | null): string {
  if (range === 'custom' && custom) {
    const days = Math.max(1, Math.round((new Date(custom.to).getTime() - new Date(custom.from).getTime()) / 86_400_000))
    return `${days}d range`
  }
  return range
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
  /** Optional secondary action — e.g. "View anomaly →" next to the primary "Investigate requests →". */
  secondary?: { label: string; href: string }
  onDismiss?: () => void
}

function AttnCard({ kind, title, meta, hint, cta, href, secondary, onDismiss }: AttnCardProps) {
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
      <div suppressHydrationWarning className="text-[12.5px] text-text-muted leading-relaxed">{hint}</div>
      <div className="flex-1" />
      <div className="flex items-center gap-3 mt-1 flex-wrap">
        <Link
          href={href}
          className={cn(
            'font-mono text-[11.5px] font-medium tracking-[0.02em]',
            isCritical ? 'text-accent' : isSavings ? 'text-good' : 'text-text-muted',
            'hover:opacity-80 transition-opacity',
          )}
        >
          {cta}
        </Link>
        {secondary && (
          <Link
            href={secondary.href}
            className="font-mono text-[11.5px] text-text-faint tracking-[0.02em] hover:text-text-muted transition-colors"
          >
            {secondary.label}
          </Link>
        )}
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────

// P3.9 (2026-05-19): polling interval set to 30s (LIVE_REFETCH_MS_ACTIVE).
// The previous comment claimed a realtime WebSocket handled instant
// updates and polling was a "safety-net fallback" — but the realtime
// subscription pointed at the Supabase `public.requests` table, which was
// dropped in the ClickHouse migration (20260516000000). With the dead
// subscription removed, the 30-second interval imported from
// `lib/queries/live-polling` is now the primary freshness mechanism;
// combined with the global `refetchOnWindowFocus` default it gives ~30s
// while visible + instant on tab focus. The interval is paused when the
// tab is hidden (TanStack default).

export function DashboardClient() {
  const [timeRange, setTimeRange] = useState('24h')
  const [customRange, setCustomRange] = useState<CustomRange | null>(null)
  const isCustom = timeRange === 'custom' && !!customRange
  // For models / anomalies / etc that still expect an `hours` integer, derive
  // it from the custom range so server-side caching keys keep working. The
  // server clamps to 30 days; longer custom ranges get truncated for those
  // hooks, but the chart/overview hooks use the explicit from/to.
  const hours = isCustom && customRange
    ? Math.max(1, Math.round((new Date(customRange.to).getTime() - new Date(customRange.from).getTime()) / 3_600_000))
    : timeRangeToHours(timeRange)
  // Capture "now" once at mount — fresh data drives the dashboard via
  // react-query refetches, so a stable comparison anchor is correct.
  const [mountNow] = useState(() => Date.now())
  // Note (P3.9, 2026-05-19): the previous Supabase Realtime subscription on
  // `public.requests` was removed — that table was dropped in the ClickHouse
  // migration (20260516000000), so the subscription had been silently
  // delivering zero events. Live updates now come from polling intervals
  // (`LIVE_REFETCH_MS` below) plus TanStack's `refetchOnWindowFocus: true`
  // global default in `lib/query-client.ts`, which gives instant refresh
  // whenever the user returns to the tab.
  const dismissalsQuery = useDismissals()
  const dismissMutation = useDismissCard()
  const dismissedCards = useMemo(
    () => new Set(dismissalsQuery.data ?? []),
    [dismissalsQuery.data],
  )

  const overview = useStatsOverview(
    isCustom && customRange
      ? { from: customRange.from, to: customRange.to, compare: true }
      : { hours, compare: true },
    { refetchInterval: LIVE_REFETCH_MS },
  )
  const timeseries = useStatsTimeseries(
    isCustom && customRange ? { from: customRange.from, to: customRange.to } : { hours },
    { refetchInterval: LIVE_REFETCH_MS },
  )
  const anomalies = useAnomalies({ observationHours: hours })
  const alerts = useAlerts()
  const recommendations = useRecommendations({ hours })
  const staleKeys = useStaleKeyCounts()
  const auditLogs = useAuditLogs({ limit: 6 })
  const promptsQuery = usePrompts()
  const modelsQuery = useStatsModels(hours, undefined, { refetchInterval: LIVE_REFETCH_MS })
  const spendForecast = useSpendForecast()
  const securitySummary = useSecuritySummary(hours)

  const o = overview.data
  const isLoading = overview.isLoading || timeseries.isLoading
  const isError = overview.isError || timeseries.isError

  // "Baseline available" means the comparison period had non-zero data.
  // Without a baseline, the API still returns -100% when current is zero,
  // which is mathematically true but operationally noise.
  const hasBaseline = !!o && o.totalRequests > 0

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

  // Close the export dropdown on Escape — outside-click is already handled
  // by the fixed inset clickaway overlay.
  useEffect(() => {
    if (!exportOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setExportOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [exportOpen])

  // `mounted` defers the locale/time-dependent header to the client paint —
  // server SSR uses UTC for `new Date()`, client uses the user's timezone,
  // and the resulting text mismatch was triggering React hydration errors
  // even with `suppressHydrationWarning`. See gotcha #22 in CLAUDE.md.
  // Using useSyncExternalStore avoids the lint rule against setState-in-effect.
  const mounted = useSyncExternalStore(subscribeNoop, getTrue, getFalse)

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
    // Filename uses the short range slug so a custom range produces
    // `spanlens-8d-range-2026-05-28.csv` instead of `spanlens-custom-...`.
    const rangeSlug = shortRangeLabel(timeRange, customRange).replace(/\s+/g, '-').toLowerCase()
    a.download = `spanlens-${rangeSlug}-${new Date().toISOString().slice(0, 10)}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
    setExportOpen(false)
  }

  // RFC 4180-compliant field escape: wrap in quotes if the value contains
  // quote, comma, CR or LF; double any embedded quotes.
  function csvField(v: string | number): string {
    const s = String(v)
    return /["\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  function csvRow(cells: (string | number)[]): string {
    return cells.map(csvField).join(',')
  }

  function exportCsv() {
    const d = buildExportData()
    const lines: string[] = []
    // Section markers live in column A so Excel/Sheets renders them as
    // ordinary cells rather than misinterpreting markdown-style ## headers.
    lines.push(csvRow([`Summary (${shortRangeLabel(timeRange, customRange)})`]))
    lines.push(csvRow(['Total Requests', 'Total Spend (USD)', 'Avg Latency (ms)', 'Error Rate (%)']))
    if (d.summary) {
      lines.push(csvRow([
        d.summary.totalRequests,
        d.summary.totalSpendUsd.toFixed(2),
        d.summary.avgLatencyMs,
        d.summary.errorRatePct,
      ]))
    }
    lines.push('')
    lines.push(csvRow(['Timeseries']))
    lines.push(csvRow(['Date', 'Requests', 'Spend (USD)', 'Tokens', 'Errors']))
    for (const r of d.timeseries) {
      lines.push(csvRow([r.date, r.requests, r.spendUsd.toFixed(2), r.tokens, r.errors]))
    }
    lines.push('')
    lines.push(csvRow([`Models (last ${shortRangeLabel(timeRange, customRange)})`]))
    lines.push(csvRow(['Provider', 'Model', 'Requests', 'Total Spend (USD)', 'Avg Latency (ms)', 'Error Rate (%)']))
    for (const m of d.models) {
      lines.push(csvRow([
        m.provider,
        m.model,
        m.requests,
        m.totalSpendUsd.toFixed(2),
        m.avgLatencyMs,
        m.errorRatePct,
      ]))
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
          return mountNow - new Date(a.last_triggered_at).getTime() < hours * 60 * 60 * 1000
        })
        .map((a) => a.last_triggered_at as string),
    [alerts.data, hours, mountNow],
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
          mountNow - new Date(a.last_triggered_at).getTime() < hours * 60 * 60 * 1000,
      ),
    [activeAlertRules, hours, mountNow],
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
        title: `PII leak · ${piiHits} match${piiHits === 1 ? '' : 'es'} in last ${shortRangeLabel(timeRange, customRange)}`,
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
        // Same prefilled /requests filters as the "Investigate" link on
        // /anomalies — the dashboard anomalies query observes `hours`, so
        // the drill-down time range is derived from the same window.
        href: buildInvestigateHref(
          topAnomaly.provider,
          topAnomaly.model,
          investigateRangeForObservationHours(hours),
        ),
        secondary: { label: 'View anomaly →', href: `/anomalies?${qs}` },
      })
    }

    if (firingAlerts[0]) {
      const top = firingAlerts[0]
      const firedMinsAgo = top.last_triggered_at
        ? Math.max(1, Math.round((mountNow - new Date(top.last_triggered_at).getTime()) / 60_000))
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

    // Stale API keys — surface revoke-tier (90d+) as a warning ahead of
    // any savings card, since orphaned keys are a security concern. The
    // bare "stale-tier" (30-89d) is intentionally NOT surfaced here — we
    // don't want to nag for every key the user took a holiday on, only
    // for ones that have crossed the "this is probably forgotten" line.
    if (staleKeys.revoke > 0) {
      const n = staleKeys.revoke
      const sample = staleKeys.sampleName
      cards.push({
        kind: 'warning',
        cardKey: `stale_keys:${n}`,
        title: `${n} API key${n === 1 ? '' : 's'} idle 90+ days`,
        meta: sample ? `${sample}${n > 1 ? ` · +${n - 1} more` : ''}` : 'review · rotate · revoke',
        hint: 'Long-idle keys are usually forgotten — revoke them before a leak happens.',
        cta: 'Review keys →',
        href: '/projects',
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
        href: '/savings',
      })
    }

    return cards
  }, [anomalies.data, firingAlerts, recommendations.data, securitySummary.data, staleKeys.revoke, staleKeys.sampleName, timeRange, customRange, mountNow, hours])

  // Border classes for KPI cells — responsive 2-col (mobile) / 4-col (lg)
  const kpiCellClasses: [string, string, string, string] = [
    'border-r border-b border-border lg:border-b-0',       // 1st: right + bottom-on-mobile
    'border-b border-border lg:border-r lg:border-b-0',    // 2nd: no right on mobile, restore lg
    'border-r border-border',                               // 3rd: right, no bottom
    'border-border',                                        // 4th: no right, no bottom
  ]

  // Same `mounted` guard as the data branches — SSR shouldn't reveal the
  // empty-state CTA unless the client has confirmed the data is genuinely
  // empty, otherwise the wrapper toggles between SSR (false) and client
  // (true) and React hits the hydration mismatch path.
  const isEmptyWorkspace = mounted && !isLoading && !!o && o.totalRequests === 0

  return (
    <div className="-m-4 md:-m-7">
      {/* Sticky topbar — keeps the time range + crumbs in view while the
          page scrolls natively (no inner overflow container). */}
      <div className="sticky top-0 z-20 bg-bg">
        <Topbar crumbs={[{ label: 'Dashboard' }]} />
      </div>

      <div>
        {/* Greeting */}
        <div className="px-[22px] py-[22px] border-b border-border">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 mb-1">
            {/* Defer locale-sensitive header to client paint — server UTC ≠
                client local time. The whole wrapper is gated on `mounted`
                instead of relying on suppressHydrationWarning, which only
                silences the warning but doesn't stop React from regenerating
                the surrounding tree on mismatch. */}
            <h1 className="text-[22px] sm:text-[26px] font-medium tracking-[-0.6px]">
              {mounted ? `${greeting()}.` : <>&nbsp;</>}
            </h1>
            <span className="font-mono text-[11px] text-text-faint tracking-[0.03em]">
              {mounted ? (
                <>
                  {new Date().toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {tzShort() && <span className="ml-1 text-text-faint/70">{tzShort()}</span>}
                </>
              ) : null}
            </span>
          </div>
          {/* The summary text content is filled in on the client only —
              server renders an empty (but same-shape) placeholder. Both
              `o` being absent on the server AND the locale/time-sensitive
              labels would otherwise trigger React hydration mismatches.
              By keying the data branch on `mounted` we guarantee SSR and
              the first client paint produce identical DOM, and only the
              post-hydrate render switches in the real text. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] sm:text-[14px] text-text-muted">
            {mounted && o ? (
              <>
                <span>{sinceLabel(timeRange, customRange)}</span>
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
              </>
            ) : (
              <span className="text-text-faint">&nbsp;</span>
            )}
            <div className="ml-auto flex items-center gap-2 shrink-0">
              <TimeRangeSelector
                value={timeRange}
                onChange={(v) => { setTimeRange(v); if (v !== 'custom') setCustomRange(null) }}
                customRange={customRange}
                onCustomRange={(r) => { setCustomRange(r); setTimeRange('custom') }}
              />
              <div ref={exportRef} className="relative shrink-0">
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
          </div>
        </div>

        <WelcomeBanner />

        <QuotaBanner />
        <UpsellModal />

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

        {/* Needs attention — gated on `mounted` so the section visibility
            doesn't toggle between SSR (no cards, query data empty) and
            first client paint (cards from hydrated cache). */}
        {mounted && attnCards.filter((c) => !dismissedCards.has(c.cardKey)).length > 0 && (
          <div className="px-[22px] pt-[18px] pb-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2.5">
              Needs attention
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
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
        <div className="grid grid-cols-2 lg:grid-cols-4 border-y border-border mt-[18px]">
          {/* `!mounted` gate forces SSR + first client paint to both render
              the skeleton branch — TanStack's HydrationBoundary populates
              the client cache during hydration but the corresponding SSR
              render of useQuery doesn't see it as resolved, so the two
              sides diverge without this guard. */}
          {!mounted || isLoading || !o ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={cn('p-[18px]', kpiCellClasses[i])}>
                <Skeleton className="h-3 w-3/4 mb-3" />
                <Skeleton className="h-8 w-full mb-3" />
                <Skeleton className="h-5 w-full" />
              </div>
            ))
          ) : (
            <>
              <KpiCard
                className={kpiCellClasses[0]}
                label={`Requests · ${shortRangeLabel(timeRange, customRange)}`}
                value={o.totalRequests.toLocaleString()}
                delta={fmtDelta(o.requestsDelta, hasBaseline)}
                deltaVariant={deltaVariantFor(o.requestsDelta, true, hasBaseline)}
                sparkValues={sparkRequests}
                linkLabel="Requests →"
                linkHref="/requests"
              />
              <KpiCard
                className={kpiCellClasses[1]}
                label={`Spend · ${shortRangeLabel(timeRange, customRange)}`}
                value={fmtCost(o.totalCostUsd)}
                delta={fmtDelta(o.costDelta, hasBaseline)}
                deltaVariant={deltaVariantFor(o.costDelta, false, hasBaseline)}
                sparkValues={sparkCost}
                linkLabel="Savings →"
                linkHref="/savings"
              />
              <KpiCard
                className={kpiCellClasses[2]}
                label={`Avg latency · ${shortRangeLabel(timeRange, customRange)}`}
                value={`${o.avgLatencyMs}ms`}
                delta={fmtDelta(o.latencyDelta, hasBaseline)}
                deltaVariant={deltaVariantFor(o.latencyDelta, false, hasBaseline)}
                sparkValues={[]}
                linkLabel="Traces →"
                linkHref="/traces"
              />
              <KpiCard
                className={kpiCellClasses[3]}
                label="Error rate"
                value={errorRate}
                delta={fmtDelta(o.errorRateDelta, hasBaseline)}
                deltaVariant={deltaVariantFor(o.errorRateDelta, false, hasBaseline)}
                sparkValues={sparkErrors}
                linkLabel="Anomalies →"
                linkHref="/anomalies"
              />
            </>
          )}
        </div>

        {/* Empty workspace prompt — replaces the row of per-section "no data"
            messages with a single guided CTA. Appears only when the API
            confirmed zero traffic in the selected window.
            Mobile: text on top, CTAs as a row below — keeps the text column
            full-width instead of getting squeezed next to the links. */}
        {isEmptyWorkspace && (
          <div className="px-[22px] py-5 border-b border-border">
            <div className="rounded-md border border-border bg-bg-elev px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium text-text">No traffic in this window.</div>
                <div className="text-[12.5px] text-text-muted leading-relaxed mt-0.5">
                  Connect your first integration, or widen the time range.
                </div>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <Link
                  href="/projects"
                  className="font-mono text-[11.5px] text-accent hover:opacity-80 transition-opacity"
                >
                  Add provider key →
                </Link>
                <Link
                  href="/docs/quick-start"
                  className="font-mono text-[11.5px] text-text-muted hover:text-text transition-colors"
                >
                  Quick start →
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Traffic chart */}
        <div className="px-[22px] py-5 border-b border-border">
          <div className="flex items-center mb-3">
            <h2 className="text-[15px] font-medium">Traffic &amp; spend · last {shortRangeLabel(timeRange, customRange)}</h2>
          </div>
          {!mounted || isLoading || !timeseries.data ? (
            <Skeleton className="h-[220px] w-full" />
          ) : (
            <RequestChart data={timeseries.data} firedAt={alertFiredAt} isHourly={hours <= 48} />
          )}
        </div>

        {/* Token volume + Error distribution row — answers the obvious
            follow-up questions to the spend chart above ("was it tokens or
            model mix?" and "what kind of errors?"). */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 px-[22px] py-5 border-b border-border">
          {!mounted || isLoading || !timeseries.data ? (
            <>
              <Skeleton className="h-[260px] w-full" />
              <Skeleton className="h-[260px] w-full" />
            </>
          ) : (
            <>
              <ErrorBoundary label="dashboard:token-trends">
                <TokenTrendsCard
                  series={timeseries.data}
                  rangeLabel={shortRangeLabel(timeRange, customRange)}
                />
              </ErrorBoundary>
              <ErrorBoundary label="dashboard:error-distribution">
                <ErrorDistributionCard
                  series={timeseries.data}
                  rangeLabel={shortRangeLabel(timeRange, customRange)}
                />
              </ErrorBoundary>
            </>
          )}
        </div>

        {/* Cost-by-model breakdown — full width so long provider/model labels
            (anthropic / claude-sonnet-4-6) read comfortably. */}
        <div className="px-[22px] py-5 border-b border-border">
          {!mounted || modelsQuery.isLoading || !modelsQuery.data ? (
            <Skeleton className="h-[290px] w-full" />
          ) : (
            <ErrorBoundary label="dashboard:cost-breakdown">
              <CostBreakdownCard
                models={modelsQuery.data}
                rangeLabel={shortRangeLabel(timeRange, customRange)}
              />
            </ErrorBoundary>
          )}
        </div>

        {/* Spend forecast, always monthly, independent of time range selector */}
        {!mounted || spendForecast.isLoading ? (
          <div className="px-[22px] py-5 border-b border-border">
            <Skeleton className="h-[320px] w-full" />
          </div>
        ) : spendForecast.data ? (
          <SpendForecastCard data={spendForecast.data} />
        ) : null}

        {/* 2-col: Top prompts + Models in use */}
        <div className="grid grid-cols-1 md:grid-cols-2 border-b border-border">
          <div className="px-[22px] py-[18px] border-b border-border md:border-b-0 md:border-r">
            <div className="flex items-center mb-3">
              <h2 className="text-[14px] font-medium">Top prompts · spend</h2>
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

              if (!mounted || promptsQuery.isLoading) {
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
              <h2 className="text-[14px] font-medium">Models in use · {shortRangeLabel(timeRange, customRange)}</h2>
              <span className="flex-1" />
              <Link href="/requests" prefetch={linkPrefetchFor('/requests')} className="font-mono text-[10.5px] text-text-muted tracking-[0.03em] hover:text-text transition-colors">
                All requests →
              </Link>
            </div>
            {!mounted || modelsQuery.isLoading ? (
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
              <p className="font-mono text-[12px] text-text-faint">No requests in the last {shortRangeLabel(timeRange, customRange)}.</p>
            ) : (
              <div className="overflow-x-auto">
                <div style={{ minWidth: 300 }}>
                  <div className="grid font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint pb-2 border-b border-border" style={{ gridTemplateColumns: '1fr 70px 80px 60px', gap: 10 }}>
                    <span>Model</span>
                    <span className="text-right">Reqs</span>
                    <span className="text-right">Cost</span>
                    <span className="text-right">Lat</span>
                  </div>
                  {(modelsQuery.data ?? []).slice(0, 6).map((m) => (
                    <div
                      key={`${m.provider}/${m.model}`}
                      className="py-2 border-b border-border last:border-0 grid items-center font-mono"
                      style={{ gridTemplateColumns: '1fr 70px 80px 60px', gap: 10 }}
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
              </div>
            )}
          </div>
        </div>

        {/* Bottom 2-col: Alerts + Recommendations */}
        <div className="grid grid-cols-1 md:grid-cols-2 border-b border-border">
          {/* Active alert rules */}
          <div className="px-[22px] py-[18px] border-b border-border md:border-b-0 md:border-r">
            <div className="flex items-center mb-3">
              <h2 className="text-[14px] font-medium">Active alerts</h2>
              <span className="flex-1" />
              <Link
                href="/alerts"
                prefetch={linkPrefetchFor('/alerts')}
                className={cn(
                  'font-mono text-[10.5px] tracking-[0.03em]',
                  mounted && firingAlerts.length > 0 ? 'text-accent' : 'text-text-muted',
                )}
              >
                {!mounted
                  ? '→'
                  : firingAlerts.length > 0
                    ? `${firingAlerts.length} firing →`
                    : `${activeAlertRules.length} rule${activeAlertRules.length !== 1 ? 's' : ''} →`}
              </Link>
            </div>
            {!mounted ? (
              <p className="text-[13px] text-text-faint">&nbsp;</p>
            ) : activeAlertRules.length === 0 ? (
              <p className="text-[13px] text-text-faint">No active alert rules.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {activeAlertRules.slice(0, 3).map((a) => {
                  const fired = a.last_triggered_at
                    ? mountNow - new Date(a.last_triggered_at).getTime() < hours * 60 * 60 * 1000
                    : false
                  const minsAgo = a.last_triggered_at
                    ? Math.max(1, Math.round((mountNow - new Date(a.last_triggered_at).getTime()) / 60_000))
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
                        <div suppressHydrationWarning className="font-mono text-[10px] text-text-faint mt-0.5 uppercase tracking-[0.04em]">
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
              <h2 className="text-[14px] font-medium">Savings queued</h2>
              <span className="flex-1" />
              <Link href="/savings" prefetch={linkPrefetchFor('/savings')} className="font-mono text-[10.5px] text-good tracking-[0.03em]">
                View all →
              </Link>
            </div>
            {!mounted ? (
              <p className="text-[13px] text-text-faint">&nbsp;</p>
            ) : (recommendations.data ?? []).length === 0 ? (
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
            <h2 className="text-[14px] font-medium">Recent activity</h2>
            <span className="flex-1" />
            <Link
              href="/settings?tab=audit-log"
              className="font-mono text-[10.5px] text-text-muted tracking-[0.03em] hover:text-text transition-colors"
            >
              Audit log →
            </Link>
          </div>
          {!mounted || auditLogs.isLoading ? (
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
                  className={cn('py-2', i < arr.length - 1 && 'border-b border-border')}
                >
                  {/* Mobile: stacked; Desktop: inline grid */}
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 sm:grid sm:items-baseline" style={{ gridTemplateColumns: '56px 80px 1fr', gap: 14 }}>
                    <span className="font-mono text-[10.5px] text-text-faint shrink-0">
                      {formatTime(e.created_at)}
                    </span>
                    <span className={cn(
                      'font-mono text-[9px] uppercase tracking-[0.04em] px-[5px] py-[1px] rounded-[3px] border self-center shrink-0',
                      isAccent ? 'text-accent border-accent-border' : 'text-text-faint border-border',
                    )}>{kind}</span>
                    <div className="text-[12.5px] text-text leading-snug w-full sm:w-auto">
                      {formatAuditAction(e.action)}
                      {e.resource_id && (
                        <span className="font-mono text-[10.5px] text-text-faint ml-1.5">
                          · {e.resource_id.slice(0, 8)}
                        </span>
                      )}
                    </div>
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
