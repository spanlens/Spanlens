'use client'
import { use, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { DEMO_ALERTS, DEMO_CHANNELS, DEMO_DELIVERIES } from '@/lib/demo-data'
import type { AlertType } from '@/lib/queries/types'
import { Topbar } from '@/components/layout/topbar'
import { cn, formatDateTime } from '@/lib/utils'
import { useHydrationSafeNow } from '@/lib/hydration-safe-now'

function fmtThreshold(type: AlertType, threshold: number): string {
  if (type === 'budget') return `$${threshold}`
  if (type === 'error_rate') return `${(threshold * 100).toFixed(1)}%`
  return `${threshold}ms`
}

function kindLabel(type: AlertType): string {
  if (type === 'budget') return 'BUDGET'
  if (type === 'error_rate') return 'ERROR RATE'
  return 'P95 LATENCY'
}

function isRecentlyFired(iso: string | null): boolean {
  if (!iso) return false
  return Date.now() - new Date(iso).getTime() < 60 * 60 * 1000
}

function relTime(iso: string | null): string {
  if (!iso) return 'never'
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function DemoAlertDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  // Stable "now" for the 24h delivery bucket. Demo data has fixed timestamps,
  // so re-evaluating on every render isn't useful.
  const mountNow = useHydrationSafeNow()

  const alert = DEMO_ALERTS.find((a) => a.id === id)
  const channels = DEMO_CHANNELS
  const deliveries = DEMO_DELIVERIES.filter((d) => d.alert_id === id)
  const channelById = new Map(channels.map((c) => [c.id, { kind: c.kind, target: c.target }]))

  if (!alert) {
    return (
      <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col h-screen overflow-hidden bg-bg">
        <Topbar
          crumbs={[
            { label: 'Demo', href: '/demo/dashboard' },
            { label: 'Alerts', href: '/demo/alerts' },
            { label: 'Not found' },
          ]}
        />
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-text-muted">
          <p className="text-[13px]">Alert rule not found.</p>
          <Link href="/demo/alerts" className="font-mono text-[12px] text-accent hover:opacity-80 transition-opacity">
            ← Back to all alerts
          </Link>
        </div>
      </div>
    )
  }

  const firing = alert.is_active && isRecentlyFired(alert.last_triggered_at)
  const fires24h = deliveries.filter(
    (d) => mountNow - new Date(d.created_at).getTime() < 24 * 60 * 60 * 1000,
  ).length
  const sent = deliveries.filter((d) => d.status === 'sent').length
  const failed = deliveries.filter((d) => d.status === 'failed').length

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col h-screen overflow-hidden bg-bg">
      <Topbar
        crumbs={[
          { label: 'Demo', href: '/demo/dashboard' },
          { label: 'Alerts', href: '/demo/alerts' },
          { label: alert.name },
        ]}
        right={
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled
              title="Disabled in demo"
              className="font-mono text-[11px] text-text-muted px-[10px] py-[5px] border border-border rounded-[5px] bg-bg-elev opacity-60 cursor-not-allowed"
            >
              Edit
            </button>
            <button
              type="button"
              disabled
              title="Disabled in demo"
              className="font-mono text-[11px] text-text-muted px-[10px] py-[5px] border border-border rounded-[5px] bg-bg-elev opacity-60 cursor-not-allowed"
            >
              {alert.is_active ? 'Pause' : 'Resume'}
            </button>
            <button
              type="button"
              disabled
              title="Disabled in demo"
              className="p-2 text-text-faint opacity-60 cursor-not-allowed"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-auto">
        <div className="px-[22px] py-6 max-w-4xl">
          <Link
            href="/demo/alerts"
            className="inline-flex items-center gap-1 font-mono text-[11px] text-text-muted hover:text-text transition-colors mb-4"
          >
            <ArrowLeft className="h-3 w-3" /> All alerts
          </Link>

          <div className="flex items-center gap-3 mb-1">
            <span
              className={cn(
                'w-2.5 h-2.5 rounded-full',
                firing ? 'bg-accent animate-pulse' : alert.is_active ? 'bg-good' : 'bg-text-faint',
              )}
            />
            <h1 className="text-[22px] font-semibold text-text tracking-[-0.4px]">{alert.name}</h1>
            <span className="font-mono text-[9px] px-[6px] py-[1px] rounded-[3px] border uppercase tracking-[0.04em] text-text-muted border-border">
              {kindLabel(alert.type)}
            </span>
          </div>
          <p className="text-[13px] text-text-muted mb-6 ml-[22px]">
            {firing
              ? 'Firing right now.'
              : alert.is_active
                ? 'Active · watching for threshold breach.'
                : 'Paused · no evaluation.'}
          </p>

          <div className="border border-border rounded-xl bg-bg-elev p-5 mb-5 grid grid-cols-4 gap-4">
            {[
              { label: 'Threshold', value: fmtThreshold(alert.type, alert.threshold) },
              { label: 'Window', value: `${alert.window_minutes} min` },
              { label: 'Cooldown', value: `${alert.cooldown_minutes} min` },
              { label: 'Last fired', value: relTime(alert.last_triggered_at) },
            ].map((s) => (
              <div key={s.label}>
                <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-1.5">
                  {s.label}
                </div>
                <div
                  suppressHydrationWarning
                  className={cn(
                    'font-mono text-[16px] font-medium tracking-[-0.2px]',
                    s.label === 'Last fired' && firing ? 'text-accent' : 'text-text',
                  )}
                >
                  {s.value}
                </div>
              </div>
            ))}
          </div>

          <div className="border border-border rounded-xl bg-bg-elev px-5 py-4 mb-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">Trigger</div>
            <code className="font-mono text-[13px] text-text">
              {alert.type === 'budget'
                ? 'sum(cost)'
                : alert.type === 'error_rate'
                  ? 'error_rate'
                  : 'p95(latency)'}{' '}
              &gt; {fmtThreshold(alert.type, alert.threshold)} for {alert.window_minutes}m
            </code>
            <p className="text-[12px] text-text-muted mt-2 leading-relaxed">
              Evaluated every ~5 minutes by the <code className="font-mono text-text">cron-evaluate-alerts</code> job.
              After firing, re-alerts are suppressed for {alert.cooldown_minutes} minutes.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              { label: 'Deliveries · 24h', value: String(fires24h), warn: fires24h > 0 },
              { label: 'Sent · lifetime', value: String(sent), warn: false },
              { label: 'Failed · lifetime', value: String(failed), warn: failed > 0 },
            ].map((s) => (
              <div key={s.label} className="border border-border rounded-lg bg-bg-elev p-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">
                  {s.label}
                </div>
                <div className={cn('text-[22px] font-medium tracking-[-0.3px]', s.warn ? 'text-accent' : 'text-text')}>
                  {s.value}
                </div>
              </div>
            ))}
          </div>

          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-3">
              Delivery history
            </div>
            {deliveries.length === 0 ? (
              <div className="rounded-md border border-dashed border-border bg-bg-elev px-4 py-6 text-center font-mono text-[12px] text-text-muted">
                This rule has never fired yet. When the threshold is breached, deliveries will appear here.
              </div>
            ) : (
              <div className="rounded-[6px] border border-border overflow-hidden divide-y divide-border">
                <div className="grid grid-cols-[150px_90px_1fr_1fr] gap-4 px-4 py-2.5 bg-bg-muted font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
                  <span>When</span>
                  <span>Status</span>
                  <span>Channel</span>
                  <span>Error</span>
                </div>
                {deliveries.slice(0, 50).map((d) => {
                  const ch = channelById.get(d.channel_id)
                  return (
                    <div
                      key={d.id}
                      className="grid grid-cols-[150px_90px_1fr_1fr] gap-4 px-4 py-2.5 items-center text-[11.5px]"
                    >
                      <span className="font-mono text-text-muted" suppressHydrationWarning>
                        {formatDateTime(d.created_at)}
                      </span>
                      <span
                        className={cn(
                          'font-mono text-[10px] uppercase tracking-[0.04em] px-1.5 py-0.5 rounded w-fit',
                          d.status === 'sent' ? 'bg-good/10 text-good' : 'bg-bad/10 text-bad',
                        )}
                      >
                        ● {d.status}
                      </span>
                      <span className="font-mono text-[11px] text-text-muted truncate">
                        {ch ? (
                          <>
                            <span className="text-text uppercase tracking-[0.04em] text-[10px] mr-1.5">{ch.kind}</span>
                            {ch.target}
                          </>
                        ) : (
                          <span className="text-text-faint">channel deleted</span>
                        )}
                      </span>
                      <span className="font-mono text-[11px] text-bad truncate">{d.error_message ?? ''}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
