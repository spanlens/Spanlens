'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Topbar } from '@/components/layout/topbar'
import { KpiCard } from '@/components/dashboard/kpi-card'
import { RequestChart } from '@/components/dashboard/request-chart'
import { cn } from '@/lib/utils'
import {
  DEMO_STATS_OVERVIEW,
  DEMO_TIMESERIES,
  DEMO_MODELS,
  DEMO_AUDIT_LOGS,
  DEMO_ANOMALIES,
  DEMO_ALERTS,
  DEMO_RECOMMENDATIONS,
} from '@/lib/demo-data'

// ── Helpers ────────────────────────────────────────────────────

function fmtCost(n: number): string {
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

  const sparkRequests = useMemo(
    () => DEMO_TIMESERIES.slice(-10).map((d) => d.requests),
    [],
  )
  const sparkCost = useMemo(
    () => DEMO_TIMESERIES.slice(-10).map((d) => d.cost),
    [],
  )
  const sparkErrors = useMemo(
    () => DEMO_TIMESERIES.slice(-10).map((d) => d.errors),
    [],
  )

  const kpiCellClasses: [string, string, string, string] = [
    'border-r border-b border-border lg:border-b-0',
    'border-b border-border lg:border-r lg:border-b-0',
    'border-r border-border',
    'border-border',
  ]

  const firedMinsAgo = firingAlert.last_triggered_at
    ? Math.max(1, Math.round((Date.now() - new Date(firingAlert.last_triggered_at).getTime()) / 60_000))
    : null

  const activeAlertRules = DEMO_ALERTS.filter((a) => a.is_active)
  const firingAlerts = DEMO_ALERTS.filter(
    (a) =>
      a.is_active &&
      a.last_triggered_at &&
      Date.now() - new Date(a.last_triggered_at).getTime() < 24 * 60 * 60 * 1000,
  )

  const alertFiredAt = DEMO_ALERTS
    .filter((a) => a.last_triggered_at != null)
    .map((a) => a.last_triggered_at as string)

  const topModels = DEMO_MODELS.slice(0, 5)

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col h-screen overflow-hidden bg-bg">
      <Topbar
        crumbs={[{ label: 'Demo', href: '/demo/dashboard' }, { label: 'Dashboard' }]}
      />

      <div className="flex-1 overflow-y-auto">
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
            <b className="text-text font-medium">{o.totalRequests.toLocaleString()} requests</b>
            <span className="text-text-faint">·</span>
            <b className="text-text font-medium">{fmtCost(o.totalCostUsd)} spent</b>
            <span className="text-text-faint">·</span>
            <span className="text-accent font-medium">
              {DEMO_ANOMALIES.filter((a) => !a.acknowledgedAt).length} anomalies
            </span>
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
              title={`${topAnomaly.kind.replaceAll('_', ' ')} anomaly on ${topAnomaly.model}`}
              meta={`${topAnomaly.deviations.toFixed(1)}σ · ${topAnomaly.provider}`}
              hint={`Current ${topAnomaly.currentValue.toFixed(0)} vs baseline ${topAnomaly.baselineMean.toFixed(0)}`}
              cta="Investigate requests →"
              href="/demo/requests"
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
            value={o.totalRequests.toLocaleString()}
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

        {/* Models in use */}
        <div className="px-[22px] py-[18px] border-b border-border">
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
                  <span className="text-[12px] text-text-muted text-right">{m.requestCount.toLocaleString()}</span>
                  <span className="text-[12px] text-text font-medium text-right">{fmtCost(m.totalCostUsd)}</span>
                </div>
              ))}
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
                  Date.now() - new Date(a.last_triggered_at).getTime() < 24 * 60 * 60 * 1000
                const minsAgo = a.last_triggered_at
                  ? Math.max(1, Math.round((Date.now() - new Date(a.last_triggered_at).getTime()) / 60_000))
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
              {DEMO_RECOMMENDATIONS.slice(0, 3).map((r) => (
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
          </div>
        </div>

        {/* Activity feed */}
        <div className="px-[22px] py-[18px]">
          <div className="flex items-center mb-3">
            <span className="text-[14px] font-medium">Recent activity</span>
            <span className="flex-1" />
            <Link
              href="/demo/dashboard"
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
                    {new Date(e.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
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
