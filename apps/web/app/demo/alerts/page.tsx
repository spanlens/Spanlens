'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Mail, MessageSquare, Search } from 'lucide-react'
import { DEMO_ALERTS, DEMO_CHANNELS, DEMO_DELIVERIES } from '@/lib/demo-data'
import type { AlertRow } from '@/lib/queries/types'
import type { AlertType } from '@/lib/queries/types'
import { Topbar } from '@/components/layout/topbar'
import { DemoExportButton } from '@/components/ui/demo-export-button'
import { cn } from '@/lib/utils'

const STATUS_FILTERS = ['all', 'firing', 'active', 'inactive'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

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

function isRecentlyFired(lastTriggeredAt: string | null): boolean {
  if (!lastTriggeredAt) return false
  return Date.now() - new Date(lastTriggeredAt).getTime() < 60 * 60 * 1000
}

function sevColor(a: AlertRow): 'accent' | 'good' | 'faint' {
  if (a.is_active && isRecentlyFired(a.last_triggered_at)) return 'accent'
  if (a.is_active) return 'good'
  return 'faint'
}

function alertFires(id: string): number {
  return DEMO_DELIVERIES.filter((d) => d.alert_id === id).length
}

function AlertRuleRow({ a, last }: { a: AlertRow; last: boolean }) {
  const color = sevColor(a)
  const isFiring = color === 'accent'
  const fires = alertFires(a.id)

  return (
    <Link
      href={`/demo/alerts/${a.id}`}
      className={cn(
        'grid items-center px-[22px] py-[12px] transition-colors hover:bg-bg-muted/40',
        !last && 'border-b border-border',
        isFiring && 'bg-accent-bg hover:bg-accent-bg/80',
      )}
      style={{ gridTemplateColumns: '28px 1fr 160px 60px 200px', gap: 14 }}
    >
      {/* state dot */}
      <div className="flex items-center justify-center">
        <span
          className={cn(
            'w-2 h-2 rounded-full',
            color === 'accent'
              ? 'bg-accent animate-pulse'
              : color === 'good'
                ? 'bg-good'
                : 'bg-text-faint',
          )}
        />
      </div>

      {/* name + rule */}
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span
            className="text-[13.5px] text-text font-medium truncate"
          >
            {a.name}
          </span>
          <span
            className={cn(
              'font-mono text-[9px] px-[6px] py-[1px] rounded-[3px] border uppercase tracking-[0.04em] shrink-0',
              isFiring
                ? 'text-accent border-accent-border bg-accent-bg'
                : 'text-text-muted border-border',
            )}
          >
            {kindLabel(a.type)}
          </span>
        </div>
        <div className="font-mono text-[11px] text-text-muted">
          <span className="text-text-faint">trigger </span>
          {a.type === 'budget'
            ? 'sum(cost)'
            : a.type === 'error_rate'
              ? 'error_rate'
              : 'p95(latency)'}{' '}
          &gt; {fmtThreshold(a.type, a.threshold)}
          <span className="text-text-faint"> for </span>
          {a.window_minutes}m
          {a.last_triggered_at && (
            <span className="text-text-faint ml-2">
              · last fired {new Date(a.last_triggered_at).toLocaleString()}
            </span>
          )}
        </div>
      </div>

      {/* window + cooldown */}
      <div>
        <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.03em] mb-[3px]">
          WINDOW · COOLDOWN
        </div>
        <div className="font-mono text-[12px] text-text-muted">
          {a.window_minutes}m · {a.cooldown_minutes}m
        </div>
      </div>

      {/* fire count */}
      <div className="text-right">
        <div className="font-mono text-[13px] text-text">{fires}</div>
        <div className="font-mono text-[10px] text-text-faint">fires</div>
      </div>

      {/* actions (demo: disabled, also stop link nav) */}
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          disabled
          title="Disabled in demo"
          onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
          className="font-mono text-[10.5px] text-text-muted px-2 py-[3px] border border-border rounded-[4px] opacity-60 cursor-not-allowed"
        >
          Edit
        </button>
        <button
          type="button"
          disabled
          title="Disabled in demo"
          onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
          className="font-mono text-[10.5px] text-text-muted px-2 py-[3px] border border-border rounded-[4px] opacity-60 cursor-not-allowed"
        >
          {a.is_active ? 'Pause' : 'Resume'}
        </button>
      </div>
    </Link>
  )
}

export default function DemoAlertsPage() {
  const alerts = DEMO_ALERTS
  const channels = DEMO_CHANNELS
  const deliveries = DEMO_DELIVERIES
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')

  const allFiring = alerts.filter((a) => a.is_active && isRecentlyFired(a.last_triggered_at))
  const allActive = alerts.filter((a) => a.is_active && !isRecentlyFired(a.last_triggered_at))
  const allPaused = alerts.filter((a) => !a.is_active)

  const matchQ = (a: AlertRow): boolean => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return a.name.toLowerCase().includes(q) || a.type.toLowerCase().includes(q)
  }
  const firing = status === 'all' || status === 'firing' ? allFiring.filter(matchQ) : []
  const active = status === 'all' || status === 'active' ? allActive.filter(matchQ) : []
  const paused = status === 'all' || status === 'inactive' ? allPaused.filter(matchQ) : []
  const filteredAll = [...firing, ...active, ...paused]
  const isFiltered = query.trim().length > 0 || status !== 'all'

  // Capture "now" once at mount — demo data is static.
  const [now] = useState(() => Date.now())
  const fires24h = deliveries.filter(
    (d) => now - new Date(d.created_at).getTime() < 24 * 60 * 60 * 1000,
  ).length

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col min-h-screen">
      <div className="sticky top-0 z-20 bg-bg">
        <Topbar
          crumbs={[{ label: 'Demo', href: '/demo/dashboard' }, { label: 'Alerts' }]}
          right={
            <div className="flex items-center gap-2">
              <DemoExportButton
                base="alerts"
                rows={filteredAll}
                columns={[
                  { header: 'Name', value: (a: AlertRow) => a.name },
                  { header: 'Type', value: (a: AlertRow) => a.type },
                  { header: 'Threshold', value: (a: AlertRow) => fmtThreshold(a.type, a.threshold) },
                  { header: 'Window (min)', value: (a: AlertRow) => a.window_minutes },
                  { header: 'Active', value: (a: AlertRow) => a.is_active },
                  { header: 'Fires', value: (a: AlertRow) => alertFires(a.id) },
                ]}
              />
              <button
                type="button"
                onClick={() => alert('Sign up to add notification channels')}
                className="hidden sm:inline-flex font-mono text-[11px] text-text-muted px-[10px] py-[5px] border border-border rounded-[5px] bg-bg-elev hover:text-text transition-colors"
              >
                + Add channel
              </button>
              <button
                type="button"
                onClick={() => alert('Sign up to create alerts')}
                className="font-mono text-[11px] text-bg px-[10px] py-[5px] rounded-[5px] bg-text font-medium hover:opacity-90 transition-opacity"
              >
                + New alert
              </button>
            </div>
          }
        />
      </div>

      {/* Stat strip */}
      <div className="overflow-x-auto shrink-0 border-b border-border">
        <div className="grid grid-cols-5 min-w-[480px]">
          {[
            { label: 'Firing now',   value: String(allFiring.length),                          warn: allFiring.length > 0 },
            { label: 'Rules active', value: String(alerts.filter((a) => a.is_active).length),  warn: false },
            { label: 'Fires 24h',    value: String(fires24h),                                  warn: fires24h > 0 },
            { label: 'Rules total',  value: String(alerts.length),                             warn: false },
            { label: 'Channels',     value: String(channels.length),                           warn: false },
          ].map((s, i) => (
            <div key={i} className={cn('px-[18px] py-[14px]', i < 4 && 'border-r border-border')}>
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">
                {s.label}
              </div>
              <span
                className={cn(
                  'text-[24px] font-medium leading-none tracking-[-0.6px]',
                  s.warn ? 'text-accent' : 'text-text',
                )}
              >
                {s.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 px-[22px] py-[12px] border-b border-border">
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('')
            }}
            placeholder="Search alerts…"
            className="w-full pl-8 pr-8 py-1.5 font-mono text-[12px] bg-bg-elev border border-border rounded-[6px] text-text placeholder:text-text-faint focus:outline-none focus:border-accent"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-faint hover:text-text transition-colors"
            >
              ✕
            </button>
          )}
        </div>
        <div className="flex border border-border rounded-[6px] overflow-hidden">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={cn(
                'font-mono text-[11px] px-[10px] py-[6px] border-r border-border last:border-r-0 transition-colors capitalize',
                s === status ? 'bg-bg-elev text-text font-medium' : 'bg-transparent text-text-muted hover:text-text',
              )}
            >
              {s}
            </button>
          ))}
        </div>
        {isFiltered && (
          <span className="font-mono text-[11px] text-text-faint whitespace-nowrap">
            {filteredAll.length} of {alerts.length}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <>
          {isFiltered && filteredAll.length === 0 && (
            <div className="px-[22px] py-16 text-center">
              <p className="font-mono text-[12.5px] text-text-muted mb-1.5">No alerts match your filters</p>
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  setStatus('all')
                }}
                className="font-mono text-[11px] text-accent hover:opacity-80 transition-opacity"
              >
                Clear filters
              </button>
            </div>
          )}
          {/* Firing */}
          {firing.length > 0 && (
            <div>
              <div className="flex items-center gap-2.5 px-[22px] py-[10px] bg-accent-bg border-b border-border">
                <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-accent">
                  Firing · {firing.length}
                </span>
              </div>
              {firing.map((a, i) => (
                <AlertRuleRow key={a.id} a={a} last={i === firing.length - 1} />
              ))}
            </div>
          )}

          {/* Active */}
          {active.length > 0 && (
            <div>
              <div className="flex items-center gap-2.5 px-[22px] py-[10px] bg-bg-muted border-b border-border border-t border-t-border">
                <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint">
                  Active · {active.length}
                </span>
              </div>
              {active.map((a, i) => (
                <AlertRuleRow key={a.id} a={a} last={i === active.length - 1} />
              ))}
            </div>
          )}

          {/* Paused */}
          {paused.length > 0 && (
            <div>
              <div className="flex items-center gap-2.5 px-[22px] py-[10px] bg-bg-muted border-b border-border border-t border-t-border">
                <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint opacity-75">
                  Paused · {paused.length}
                </span>
              </div>
              <div className="opacity-70">
                {paused.map((a, i) => (
                  <AlertRuleRow key={a.id} a={a} last={i === paused.length - 1} />
                ))}
              </div>
            </div>
          )}

          {/* Notification channels */}
          <div className="px-[22px] py-[18px]">
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-3">
              Notification channels
            </div>
            {channels.length === 0 ? (
              <div className="rounded-[5px] border border-dashed border-border py-5 text-center font-mono text-[12px] text-text-muted">
                No channels yet, add an email or webhook to receive alerts.
              </div>
            ) : (
              <div className="rounded-[6px] border border-border overflow-hidden">
                {channels.map((ch) => (
                  <div
                    key={ch.id}
                    className="flex items-center justify-between px-[14px] py-3 border-b border-border last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-text-muted">
                        {ch.kind === 'email' ? (
                          <Mail className="h-3.5 w-3.5" />
                        ) : (
                          <MessageSquare className="h-3.5 w-3.5" />
                        )}
                      </span>
                      <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-text-muted">
                        {ch.kind}
                      </span>
                      <span className="font-mono text-[12px] text-text-faint truncate max-w-xs">
                        {ch.kind === 'slack'
                          ? 'https://hooks.slack.com/services/T00000/…'
                          : ch.target}
                      </span>
                    </div>
                    <span
                      className={cn(
                        'font-mono text-[10px] px-[6px] py-[2px] rounded-[3px] uppercase tracking-[0.04em]',
                        ch.is_active ? 'bg-good/10 text-good' : 'bg-text-faint/10 text-text-faint',
                      )}
                    >
                      {ch.is_active ? 'active' : 'off'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent deliveries */}
          {deliveries.length > 0 && (
            <div className="px-[22px] pb-[18px]">
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-3">
                Recent deliveries
              </div>
              <div className="rounded-[6px] border border-border overflow-hidden">
                {deliveries.slice(0, 10).map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center gap-4 px-[14px] py-2 border-b border-border last:border-0 text-[11.5px]"
                  >
                    <span className="font-mono text-text-faint">
                      {new Date(d.created_at).toLocaleString()}
                    </span>
                    <span
                      className={cn(
                        'font-mono px-1.5 py-0.5 rounded text-[10px] uppercase tracking-[0.04em]',
                        d.status === 'sent' ? 'bg-good/10 text-good' : 'bg-bad/10 text-bad',
                      )}
                    >
                      {d.status}
                    </span>
                    {d.error_message && (
                      <span className="text-bad truncate max-w-md">{d.error_message}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      </div>
    </div>
  )
}
