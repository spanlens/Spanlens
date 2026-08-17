'use client'
import { use } from 'react'
import Link from 'next/link'
import { Trash2 } from 'lucide-react'
import { DEMO_ALERTS, DEMO_CHANNELS, DEMO_DELIVERIES } from '@/lib/demo-data'
import type { AlertType } from '@/lib/queries/types'
import { Topbar } from '@/components/layout/topbar'
import { Card, CardTitle } from '@/components/ui/card'
import { StatusPill } from '@/components/ui/primitives'
import { cn, formatDateTime, formatTime } from '@/lib/utils'
import { useHydrationSafeNow } from '@/lib/hydration-safe-now'
import {
  Board,
  TOPBAR_BLEED,
  CONTROL,
  SummaryStrip,
  SummaryCell,
  Well,
} from '../../../(dashboard)/_board/surfaces'

function fmtThreshold(type: AlertType, threshold: number): string {
  if (type === 'budget') return `$${threshold}`
  if (type === 'error_rate') return `${(threshold * 100).toFixed(1)}%`
  if (type === 'eval_score') return `${(threshold * 100).toFixed(1)}%`
  return `${threshold}ms`
}

function metricLabel(type: AlertType): string {
  if (type === 'budget') return 'cost total'
  if (type === 'error_rate') return 'error rate'
  if (type === 'eval_score') return 'eval score'
  return 'p95 latency'
}

function metricExpression(type: AlertType): string {
  if (type === 'budget') return 'sum(cost)'
  if (type === 'error_rate') return 'error_rate'
  if (type === 'eval_score') return 'avg(eval_score)'
  return 'p95(latency)'
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

/** Card head from the detail boards: 13.5px title with a mono note pushed right. */
function CardHead({ title, note }: { title: string; note?: string | undefined }) {
  return (
    <div className="mb-[14px] flex items-baseline gap-2.5">
      <CardTitle>{title}</CardTitle>
      <span className="flex-1" />
      {note && <span className="font-mono text-[11px] leading-[1.4] text-text-faint">{note}</span>}
    </div>
  )
}

export default function DemoAlertDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  // Stable "now" for the 24h delivery bucket. Demo data has fixed timestamps,
  // so re-evaluating on every render isn't useful.
  const mountNow = useHydrationSafeNow()

  const alertRule = DEMO_ALERTS.find((a) => a.id === id)
  const channels = DEMO_CHANNELS
  const deliveries = DEMO_DELIVERIES
    .filter((d) => d.alert_id === id)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  const channelById = new Map(channels.map((c) => [c.id, { kind: c.kind, target: c.target }]))
  // Most recent attempt per channel, for the routing card's status.
  const lastByChannel = new Map<string, (typeof deliveries)[number]>()
  for (const d of deliveries) if (!lastByChannel.has(d.channel_id)) lastByChannel.set(d.channel_id, d)

  if (!alertRule) {
    return (
      <div>
        <div className={TOPBAR_BLEED}>
          <Topbar
            crumbs={[
              { label: 'Demo', href: '/demo/dashboard' },
              { label: 'Alerts', href: '/demo/alerts' },
              { label: 'Not found' },
            ]}
          />
        </div>
        <Board>
          <div className="card-surface rounded-card flex h-64 flex-col items-center justify-center gap-3 text-text-muted">
            <p className="text-[13px]">Alert rule not found.</p>
            <Link href="/demo/alerts" className="font-mono text-[12px] text-accent transition-opacity hover:opacity-80">
              ← Back to all alerts
            </Link>
          </div>
        </Board>
      </div>
    )
  }

  const firing = alertRule.is_active && isRecentlyFired(alertRule.last_triggered_at)
  const fires24h = deliveries.filter(
    (d) => mountNow - new Date(d.created_at).getTime() < 24 * 60 * 60 * 1000,
  ).length

  return (
    <div>
      <div className={TOPBAR_BLEED}>
        <Topbar
          crumbs={[
            { label: 'Demo', href: '/demo/dashboard' },
            { label: 'Alerts', href: '/demo/alerts' },
            { label: alertRule.name },
          ]}
          right={
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled
                title="Disabled in demo"
                className={cn(CONTROL, 'cursor-not-allowed px-3.5 text-[12.5px] font-medium leading-[18px] text-text opacity-60')}
              >
                {alertRule.is_active ? 'Pause rule' : 'Resume rule'}
              </button>
              <button
                type="button"
                disabled
                title="Disabled in demo"
                className="cursor-not-allowed rounded-full bg-primary px-3.5 py-2 text-[12.5px] font-semibold leading-[18px] text-primary-foreground opacity-60"
              >
                Edit rule
              </button>
              <button
                type="button"
                disabled
                title="Disabled in demo"
                aria-label="Delete rule"
                className="cursor-not-allowed p-2 text-text-faint opacity-60"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          }
        />
        <h1 className="sr-only">{alertRule.name}</h1>
      </div>

      <Board>
        {/* Firing banner. The Figma frame pairs it with an "Acknowledge"
            button; alerts have no acknowledge action, so the right slot
            carries the 24h delivery count instead. */}
        {firing && (
          <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-border bg-bad-bg px-4 py-3.5">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            <span className="text-[12.5px] font-semibold leading-[1.45] text-accent">
              Firing since {formatTime(alertRule.last_triggered_at)}, {metricLabel(alertRule.type)} broke its{' '}
              {fmtThreshold(alertRule.type, alertRule.threshold)}{' '}
              {alertRule.type === 'eval_score' ? 'floor' : 'ceiling'}
            </span>
            <span className="ml-auto font-mono text-[11px] leading-[1.4] text-accent">
              {fires24h} delivered in 24h
            </span>
          </div>
        )}

        <SummaryStrip>
          <SummaryCell label="Metric">{metricLabel(alertRule.type)}</SummaryCell>
          <SummaryCell label="Threshold">
            {alertRule.type === 'eval_score' ? '<' : '>'} {fmtThreshold(alertRule.type, alertRule.threshold)}
          </SummaryCell>
          <SummaryCell label="Window">{alertRule.window_minutes} min</SummaryCell>
          <SummaryCell label="Cooldown">{alertRule.cooldown_minutes} min</SummaryCell>
          <SummaryCell label="Scope">{alertRule.project_id ? 'project' : 'workspace'}</SummaryCell>
          <SummaryCell label="Fires 24h">
            <span className={cn(fires24h > 0 && 'text-accent')}>{fires24h}</span>
          </SummaryCell>
        </SummaryStrip>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="px-5 py-[18px]">
            <CardHead title="Recent fires" note={`last fired ${relTime(alertRule.last_triggered_at)}`} />
            {deliveries.length === 0 ? (
              <p className="text-[12.5px] leading-[1.6] text-text-muted">
                This rule has never fired. Deliveries show up here once the threshold breaks.
              </p>
            ) : (
              <div>
                {deliveries.slice(0, 8).map((d) => {
                  const ch = channelById.get(d.channel_id)
                  return (
                    <div
                      key={d.id}
                      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border py-[9px] last:border-b-0"
                    >
                      <span className="font-mono text-[12px] leading-[1.45] text-text-muted">
                        {formatDateTime(d.created_at)}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px] leading-[1.45] text-accent">
                        {ch ? ch.target : 'channel deleted'}
                      </span>
                      <span
                        className={cn(
                          'font-mono text-[11px] leading-[1.45]',
                          d.status === 'sent' ? 'text-good' : 'text-bad',
                        )}
                      >
                        {d.status === 'sent' ? 'delivered' : (d.error_message ?? 'failed')}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>

          <Card className="px-5 py-[18px]">
            <CardHead title="Where it goes" note={`${channels.length} connected`} />
            <div>
              {channels.map((ch) => {
                const last = lastByChannel.get(ch.id)
                return (
                  <div key={ch.id} className="flex items-center gap-3 border-b border-border py-[9px] last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] leading-[1.45] text-text">{ch.label ?? ch.kind}</div>
                      <div className="truncate font-mono text-[11px] leading-[1.45] text-text-faint">
                        {ch.kind === 'slack' ? 'https://hooks.slack.com/services/T00000/…' : ch.target}
                      </div>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 font-mono text-[11px] leading-[1.45]',
                        !last ? 'text-text-faint' : last.status === 'sent' ? 'text-good' : 'text-bad',
                      )}
                    >
                      {!last
                        ? 'no deliveries yet'
                        : `${last.status === 'sent' ? 'delivered' : 'failed'} ${formatTime(last.created_at)}`}
                    </span>
                  </div>
                )
              })}
            </div>
          </Card>
        </div>

        <Card className="px-5 py-[18px]">
          <CardHead title="Trigger" note={`re-alerts suppressed for ${alertRule.cooldown_minutes} min`} />
          <Well>
            <code className="font-mono text-[12.5px] leading-[1.45] text-text">
              {metricExpression(alertRule.type)}
              {' '}{alertRule.type === 'eval_score' ? '<' : '>'} {fmtThreshold(alertRule.type, alertRule.threshold)}
              {' '}for {alertRule.window_minutes}m
            </code>
          </Well>
          <p className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] leading-[1.6] text-text-muted">
            <StatusPill variant={alertRule.is_active ? 'good' : 'neutral'}>
              {alertRule.is_active ? 'active' : 'paused'}
            </StatusPill>
            <span>
              Evaluated every ~5 minutes by the{' '}
              <code className="font-mono text-text">cron-evaluate-alerts</code> job.
            </span>
          </p>
        </Card>
      </Board>
    </div>
  )
}
