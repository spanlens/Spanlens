'use client'
import { useMemo, useState, useSyncExternalStore } from 'react'
import dynamic from 'next/dynamic'

// Module-level cache so useSyncExternalStore's getSnapshot returns the
// same number on every call. Without the cache, each call returned a
// fresh Date.now() and React's identity comparison treated every render
// as "store changed" → forceStoreRerender → render → forceStoreRerender,
// until "Maximum update depth exceeded" fired. The cache is fine for the
// demo dashboard: the page only needs `now` once at mount to compute
// "fired X mins ago" relative timestamps.
let cachedClientNow = 0
function getClientNow(): number {
  if (cachedClientNow === 0) cachedClientNow = Date.now()
  return cachedClientNow
}
function getServerNow(): number {
  return 0
}
function subscribeNow(): () => void {
  return () => {}
}
import Link from 'next/link'
import { Topbar } from '@/components/layout/topbar'
import { KpiCard } from '@/components/dashboard/kpi-card'
// recharts' ResponsiveContainer reads element size via ResizeObserver,
// which is unavailable during SSR. That produces a 0-width SVG on the
// server render and a real-width SVG on the first client paint —
// React #418 hydration mismatch. ssr:false skips the server render
// entirely; users see a tiny height-220 blank for ~1 frame instead of
// the broken-then-redrawn chart they got before, which is an
// improvement on every measurable axis. SEO is a non-goal for
// /demo/dashboard so the lost SSR pass costs nothing.
const RequestChart = dynamic(
  () =>
    import('@/components/dashboard/request-chart').then((m) => m.RequestChart),
  { ssr: false, loading: () => <div className="h-[220px]" /> },
)
// recharts-heavy breakdown cards — same ssr:false treatment as RequestChart
// (ResizeObserver isn't available during SSR, so a server render produces a
// 0-width SVG that mismatches the client paint — CLAUDE.md gotcha #22 D).
const SpendForecastCard = dynamic(
  () => import('@/components/dashboard/spend-forecast').then((m) => m.SpendForecastCard),
  { ssr: false, loading: () => <div className="h-[320px]" /> },
)
const CostBreakdownCard = dynamic(
  () => import('@/components/dashboard/cost-breakdown').then((m) => m.CostBreakdownCard),
  { ssr: false, loading: () => <div className="h-[290px]" /> },
)
const TokenTrendsCard = dynamic(
  () => import('@/components/dashboard/token-trends').then((m) => m.TokenTrendsCard),
  { ssr: false, loading: () => <div className="h-[260px]" /> },
)
const ErrorDistributionCard = dynamic(
  () => import('@/components/dashboard/error-distribution').then((m) => m.ErrorDistributionCard),
  { ssr: false, loading: () => <div className="h-[260px]" /> },
)
import { cn } from '@/lib/utils'
import { TimeRangeSelector, type CustomRange } from '@/components/layout/topbar'
import type { ModelStat } from '@/lib/queries/use-stats'
import {
  DEMO_STATS_OVERVIEW,
  DEMO_TIMESERIES,
  DEMO_MODELS,
  DEMO_AUDIT_LOGS,
  DEMO_ANOMALIES,
  DEMO_ALERTS,
  DEMO_RECOMMENDATIONS,
  DEMO_SPEND_FORECAST,
  DEMO_PROMPTS,
  DEMO_SECURITY_SUMMARY,
} from '@/lib/demo-data'

// ── Local fixture ──────────────────────────────────────────────
// CostBreakdownCard consumes the ModelStat shape (requests / avgLatencyMs /
// errorRate), which the shared DEMO_MODELS export doesn't carry. Derive a
// static ModelStat[] here rather than editing the shared fixture file.
// Module-level const so the reference stays stable across renders.
const DEMO_MODEL_STATS: ModelStat[] = [
  { provider: 'openai', model: 'gpt-4o', requests: 842, totalCostUsd: 38.24, avgLatencyMs: 4600, errorRate: 0.021 },
  { provider: 'anthropic', model: 'claude-sonnet-4-5', requests: 624, totalCostUsd: 29.84, avgLatencyMs: 5200, errorRate: 0.014 },
  { provider: 'openai', model: 'gpt-4o-mini', requests: 748, totalCostUsd: 8.42, avgLatencyMs: 520, errorRate: 0.008 },
  { provider: 'anthropic', model: 'claude-haiku-4-5', requests: 182, totalCostUsd: 4.21, avgLatencyMs: 1840, errorRate: 0.011 },
  { provider: 'google', model: 'gemini-2.0-flash', requests: 85, totalCostUsd: 0.98, avgLatencyMs: 860, errorRate: 0.005 },
]

// ── Helpers ────────────────────────────────────────────────────

import { fmtCostKpi as fmtCost } from '@/lib/format'

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

const AUDIT_LABELS: Record<string, string> = {
  'key.created': 'API key created',
  'key.deleted': 'API key deleted',
  'provider_key.created': 'Provider key added',
  'alert.triggered': 'Alert triggered',
  'anomaly.detected': 'Anomaly detected',
  'prompt.created': 'Prompt created',
  'billing.payment.succeeded': 'Payment succeeded',
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
  title: string
  meta: string
  hint: string
  cta: string
  href: string
}

function AttnCard({ kind, title, meta, hint, cta, href }: AttnCardProps) {
  const isCritical = kind === 'critical'
  const isSavings = kind === 'savings'
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null
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
          onClick={() => setDismissed(true)}
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

export default function DemoDashboardPage() {
  const o = DEMO_STATS_OVERVIEW
  const topAnomaly = DEMO_ANOMALIES[0]!
  const firingAlert = DEMO_ALERTS.find((a) => a.is_active && a.last_triggered_at)!
  const topRec = DEMO_RECOMMENDATIONS[0]!

  // Cosmetic-only time range control — the demo serves static fixtures, so
  // changing the range doesn't refetch. It exists to mirror the real
  // dashboard's affordance. Default '24h' matches the greeting copy below.
  const [timeRange, setTimeRange] = useState('24h')
  const [customRange, setCustomRange] = useState<CustomRange | null>(null)
  // Export dropdown — writes are disabled in the demo (same convention as the
  // other /demo pages: an alert that points visitors to signup).
  const [exportOpen, setExportOpen] = useState(false)

  // PII-leak attention card sources its count from the shared security
  // fixture so the number stays consistent with /demo/security.
  const piiHits = DEMO_SECURITY_SUMMARY
    .filter((r) => r.type === 'pii')
    .reduce((sum, r) => sum + r.count, 0)

  // Top prompts by spend (mirrors the real dashboard's "Top prompts · spend").
  const activePrompts = DEMO_PROMPTS
    .filter((p) => (p.stats?.calls ?? 0) > 0)
    .sort((a, b) => (b.stats?.totalCostUsd ?? 0) - (a.stats?.totalCostUsd ?? 0))
    .slice(0, 5)
  const topPromptMax = activePrompts[0]?.stats?.totalCostUsd ?? 0

  // Module-level demo data — React Compiler auto-memoizes; manual useMemo would
  // block compilation since the input array reference is module-stable.
  const sparkRequests = DEMO_TIMESERIES.slice(-10).map((d) => d.requests)
  const sparkCost = DEMO_TIMESERIES.slice(-10).map((d) => d.cost)
  const sparkErrors = DEMO_TIMESERIES.slice(-10).map((d) => d.errors)

  const kpiCellClasses: [string, string, string, string] = [
    'border-r border-b border-border lg:border-b-0',
    'border-b border-border lg:border-r lg:border-b-0',
    'border-r border-border',
    'border-border',
  ]

  // SSR + first client paint return 0 so React hydrates from identical
  // HTML. The client snapshot returns a *cached* timestamp (captured on
  // first call) so subsequent invocations return the same reference and
  // React stops re-rendering. Returning a fresh `Date.now()` on every
  // call sent useSyncExternalStore into an infinite update loop that
  // bubbled up through recharts as "Maximum update depth exceeded".
  //
  // Same shape as the R-Q3 docs/_components/table-of-contents.tsx fix.
  // CLAUDE.md gotcha #22 pattern.
  const now = useSyncExternalStore(subscribeNow, getClientNow, getServerNow)

  const firedMinsAgo = firingAlert.last_triggered_at
    ? Math.max(1, Math.round((now - new Date(firingAlert.last_triggered_at).getTime()) / 60_000))
    : null

  const activeAlertRules = DEMO_ALERTS.filter((a) => a.is_active)
  const firingAlerts = DEMO_ALERTS.filter(
    (a) =>
      a.is_active &&
      a.last_triggered_at &&
      now - new Date(a.last_triggered_at).getTime() < 24 * 60 * 60 * 1000,
  )

  const alertFiredAt = DEMO_ALERTS
    .filter((a) => a.last_triggered_at != null)
    .map((a) => a.last_triggered_at as string)

  const topModels = DEMO_MODELS.slice(0, 5)

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col min-h-screen">
      <div className="sticky top-0 z-20 bg-bg">
        <Topbar
          crumbs={[{ label: 'Demo', href: '/demo/dashboard' }, { label: 'Dashboard' }]}
        />
      </div>

      <div>
        {/* Greeting */}
        <div className="px-[22px] py-[22px] border-b border-border">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 mb-1">
            <span className="text-[22px] sm:text-[26px] font-medium tracking-[-0.6px]">
              Afternoon.
            </span>
            <span className="font-mono text-[11px] text-text-faint tracking-[0.03em]">
              Demo workspace · Acme Corp / Production
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] sm:text-[14px] text-text-muted">
            <span>Last 24h:</span>
            <b className="text-text font-medium">{o.totalRequests.toLocaleString('en-US')} requests</b>
            <span className="text-text-faint">·</span>
            <b className="text-text font-medium">{fmtCost(o.totalCostUsd)} spent</b>
            <span className="text-text-faint">·</span>
            <span className="text-accent font-medium">
              {DEMO_ANOMALIES.filter((a) => !a.acknowledgedAt).length} anomalies
            </span>
            <div className="ml-auto flex items-center gap-2 shrink-0">
              <TimeRangeSelector
                value={timeRange}
                onChange={(v) => { setTimeRange(v); if (v !== 'custom') setCustomRange(null) }}
                customRange={customRange}
                onCustomRange={(r) => { setCustomRange(r); setTimeRange('custom') }}
              />
              <div className="relative shrink-0">
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
                        onClick={() => { setExportOpen(false); alert('Sign up to export data') }}
                        className="w-full text-left px-3 py-2 font-mono text-[11px] text-text-muted hover:text-text hover:bg-bg transition-colors"
                      >
                        CSV
                      </button>
                      <button
                        type="button"
                        onClick={() => { setExportOpen(false); alert('Sign up to export data') }}
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

        {/* Needs attention */}
        <div className="px-[22px] pt-[18px] pb-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2.5">
            Needs attention
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <AttnCard
              kind="critical"
              title={`PII leak · ${piiHits} match${piiHits === 1 ? '' : 'es'} in last 24h`}
              meta="email · phone · card · ssn · passport"
              hint="Review flagged requests to identify the source prompt."
              cta="Open security →"
              href="/demo/security"
            />
            <AttnCard
              kind="critical"
              title={`${topAnomaly.kind.replaceAll('_', ' ')} anomaly on ${topAnomaly.model}`}
              meta={`${topAnomaly.deviations.toFixed(1)}σ · ${topAnomaly.provider}`}
              hint={`Current ${topAnomaly.currentValue.toFixed(0)} vs baseline ${topAnomaly.baselineMean.toFixed(0)}`}
              cta="Investigate requests →"
              href="/demo/requests"
            />
            <AttnCard
              kind="warning"
              title="2 API keys idle 90+ days"
              meta="ci-legacy-key · +1 more"
              hint="Long-idle keys are usually forgotten. Revoke them before a leak happens."
              cta="Review keys →"
              href="/demo/settings"
            />
            <AttnCard
              kind="warning"
              title={firingAlert.name}
              meta={`${firingAlert.type} · ${firingAlert.window_minutes}m window`}
              hint={firedMinsAgo != null ? `fired ${firedMinsAgo}m ago` : 'recently fired'}
              cta="Open alert →"
              href="/demo/alerts"
            />
            <AttnCard
              kind="savings"
              title={`Switch to ${topRec.suggestedModel}`}
              meta={`${topRec.currentModel} · same quality`}
              hint={`~${fmtCost(topRec.estimatedMonthlySavingsUsd)}/mo estimated savings`}
              cta="Review & approve →"
              href="/demo/savings"
            />
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 border-y border-border mt-[18px]">
          <KpiCard
            className={kpiCellClasses[0]}
            label="Requests · 24h"
            value={o.totalRequests.toLocaleString('en-US')}
            delta={fmtDelta(o.requestsDelta)}
            deltaVariant={deltaVariantFor(o.requestsDelta, true)}
            sparkValues={sparkRequests}
            linkLabel="Requests →"
            linkHref="/demo/requests"
          />
          <KpiCard
            className={kpiCellClasses[1]}
            label="Spend · 24h"
            value={fmtCost(o.totalCostUsd)}
            delta={fmtDelta(o.costDelta)}
            deltaVariant={deltaVariantFor(o.costDelta, false)}
            sparkValues={sparkCost}
            linkLabel="Savings →"
            linkHref="/demo/savings"
          />
          <KpiCard
            className={kpiCellClasses[2]}
            label="Avg latency · 24h"
            value={`${o.avgLatencyMs}ms`}
            delta={fmtDelta(o.latencyDelta)}
            deltaVariant={deltaVariantFor(o.latencyDelta, false)}
            sparkValues={[]}
            linkLabel="Traces →"
            linkHref="/demo/traces"
          />
          <KpiCard
            className={kpiCellClasses[3]}
            label="Error rate"
            value={`${o.errorRate.toFixed(2)}%`}
            delta={fmtDelta(o.errorRateDelta)}
            deltaVariant={deltaVariantFor(o.errorRateDelta, false)}
            sparkValues={sparkErrors}
            linkLabel="Anomalies →"
            linkHref="/demo/anomalies"
          />
        </div>

        {/* Traffic chart */}
        <div className="px-[22px] py-5 border-b border-border">
          <div className="flex items-center mb-3">
            <span className="text-[15px] font-medium">Traffic &amp; spend · last 24h</span>
          </div>
          <RequestChart data={DEMO_TIMESERIES} firedAt={alertFiredAt} />
        </div>

        {/* Token volume + Error distribution row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 px-[22px] py-5 border-b border-border">
          <TokenTrendsCard series={DEMO_TIMESERIES} rangeLabel="24h" />
          <ErrorDistributionCard series={DEMO_TIMESERIES} rangeLabel="24h" />
        </div>

        {/* Cost-by-model breakdown */}
        <div className="px-[22px] py-5 border-b border-border">
          <CostBreakdownCard models={DEMO_MODEL_STATS} rangeLabel="24h" />
        </div>

        {/* Spend forecast — always monthly, independent of the range selector */}
        <SpendForecastCard data={DEMO_SPEND_FORECAST} />

        {/* 2-col: Top prompts + Models in use */}
        <div className="grid grid-cols-1 md:grid-cols-2 border-b border-border">
          {/* Top prompts by spend */}
          <div className="px-[22px] py-[18px] border-b border-border md:border-b-0 md:border-r">
            <div className="flex items-center mb-3">
              <span className="text-[14px] font-medium">Top prompts · spend</span>
              <span className="flex-1" />
              <Link href="/demo/prompts" className="font-mono text-[10.5px] text-text-muted tracking-[0.03em] hover:text-text transition-colors">
                All prompts →
              </Link>
            </div>
            <div className="space-y-0">
              {activePrompts.map((p, i) => {
                const cost = p.stats?.totalCostUsd ?? 0
                const pct = topPromptMax > 0 ? (cost / topPromptMax) * 100 : 0
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
                      <div className="font-mono text-[10px] text-text-faint">{(p.stats?.calls ?? 0).toLocaleString('en-US')} calls</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Models in use */}
          <div className="px-[22px] py-[18px]">
            <div className="flex items-center mb-3">
              <span className="text-[14px] font-medium">Models in use · 24h</span>
              <span className="flex-1" />
              <Link href="/demo/requests" className="font-mono text-[10.5px] text-text-muted tracking-[0.03em] hover:text-text transition-colors">
                All requests →
              </Link>
            </div>
            <div className="overflow-x-auto">
              <div style={{ minWidth: 300 }}>
                <div className="grid font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint pb-2 border-b border-border" style={{ gridTemplateColumns: '1fr 80px 90px', gap: 10 }}>
                  <span>Model</span>
                  <span className="text-right">Reqs</span>
                  <span className="text-right">Cost</span>
                </div>
                {topModels.map((m) => (
                  <div
                    key={`${m.provider}/${m.model}`}
                    className="py-2 border-b border-border last:border-0 grid items-center font-mono"
                    style={{ gridTemplateColumns: '1fr 80px 90px', gap: 10 }}
                  >
                    <span className="text-[12.5px] text-text truncate">
                      <span className="text-text-faint text-[10.5px] uppercase tracking-[0.04em] mr-1.5">{m.provider}</span>
                      {m.model}
                    </span>
                    <span className="text-[12px] text-text-muted text-right">{m.requestCount.toLocaleString('en-US')}</span>
                    <span className="text-[12px] text-text font-medium text-right">{fmtCost(m.totalCostUsd)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom 2-col: Alerts + Recommendations */}
        <div className="grid grid-cols-1 md:grid-cols-2 border-b border-border">
          {/* Active alert rules */}
          <div className="px-[22px] py-[18px] border-b border-border md:border-b-0 md:border-r">
            <div className="flex items-center mb-3">
              <span className="text-[14px] font-medium">Active alerts</span>
              <span className="flex-1" />
              <Link
                href="/demo/alerts"
                className={cn(
                  'font-mono text-[10.5px] tracking-[0.03em]',
                  firingAlerts.length > 0 ? 'text-accent' : 'text-text-muted',
                )}
              >
                {firingAlerts.length > 0
                  ? `${firingAlerts.length} firing →`
                  : `${activeAlertRules.length} rules →`}
              </Link>
            </div>
            <div className="flex flex-col gap-2">
              {activeAlertRules.slice(0, 3).map((a) => {
                const fired =
                  a.last_triggered_at != null &&
                  now - new Date(a.last_triggered_at).getTime() < 24 * 60 * 60 * 1000
                const minsAgo = a.last_triggered_at
                  ? Math.max(1, Math.round((now - new Date(a.last_triggered_at).getTime()) / 60_000))
                  : null
                return (
                  <div
                    key={a.id}
                    className={cn(
                      'flex items-center gap-2.5 px-3 py-2.5 rounded-[5px] border',
                      fired ? 'bg-accent-bg border-accent-border' : 'bg-bg-elev border-border',
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
          </div>

          {/* Recommendations */}
          <div className="px-[22px] py-[18px]">
            <div className="flex items-center mb-3">
              <span className="text-[14px] font-medium">Savings queued</span>
              <span className="flex-1" />
              <Link href="/demo/savings" className="font-mono text-[10.5px] text-good tracking-[0.03em]">
                View all →
              </Link>
            </div>
            <div className="flex flex-col gap-2">
              {DEMO_RECOMMENDATIONS.slice(0, 3).map((r, i) => (
                <div
                  // DEMO_RECOMMENDATIONS can carry duplicate (currentModel,
                  // suggestedModel) pairs (e.g. two distinct gpt-4o → gpt-4o-mini
                  // suggestions surfaced for different traffic shapes), so the
                  // composite key alone collides. Pre-fix this triggered React's
                  // "two children with the same key" warning on every render.
                  key={`${r.currentModel}->${r.suggestedModel}#${i}`}
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
          </div>
        </div>

        {/* Activity feed */}
        <div className="px-[22px] py-[18px]">
          <div className="flex items-center mb-3">
            <span className="text-[14px] font-medium">Recent activity</span>
            <span className="flex-1" />
            <Link
              href="/demo/settings?tab=audit-log"
              className="font-mono text-[10.5px] text-text-muted tracking-[0.03em] hover:text-text transition-colors"
            >
              Audit log →
            </Link>
          </div>
          {DEMO_AUDIT_LOGS.map((e, i, arr) => {
            const kind = e.action.split('.')[0] ?? 'event'
            const isAccent = kind === 'alert' || kind === 'anomaly' || kind === 'billing'
            return (
              <div
                key={e.id}
                className={cn('py-2', i < arr.length - 1 && 'border-b border-border')}
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 sm:grid sm:items-baseline" style={{ gridTemplateColumns: '56px 80px 1fr', gap: 14 }}>
                  <span className="font-mono text-[10.5px] text-text-faint shrink-0">
                    {new Date(e.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
                  </span>
                  <span className={cn(
                    'font-mono text-[9px] uppercase tracking-[0.04em] px-[5px] py-[1px] rounded-[3px] border self-center shrink-0',
                    isAccent ? 'text-accent border-accent-border' : 'text-text-faint border-border',
                  )}>{kind}</span>
                  <div className="text-[12.5px] text-text leading-snug w-full sm:w-auto">
                    {formatAuditAction(e.action)}
                    {e.metadata && Object.keys(e.metadata).length > 0 && (
                      <span className="font-mono text-[10.5px] text-text-faint ml-1.5">
                        · {e.actor_email !== 'system' ? e.actor_email : 'system'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
