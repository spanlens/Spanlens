'use client'
import { useMemo, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { useHydrationSafeNow } from '@/lib/hydration-safe-now'
import { Bell, Mail, MessageSquare, Plus, Search } from 'lucide-react'
import { DEMO_ALERTS, DEMO_CHANNELS, DEMO_DELIVERIES } from '@/lib/demo-data'
import type { AlertRow, AlertType } from '@/lib/queries/types'
import { Topbar } from '@/components/layout/topbar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DemoExportButton } from '@/components/ui/demo-export-button'
import { StatusPill } from '@/components/ui/primitives'
import { cn, formatDate, formatDateTime } from '@/lib/utils'
import {
  Board,
  TOPBAR_BLEED,
  FilterBar,
  CONTROL,
  Segment,
  SegmentItem,
  StatCard,
  TableCard,
  TableHead,
  Th,
  ROW,
} from '../../(dashboard)/_board/surfaces'

const STATUS_FILTERS = ['all', 'firing', 'active', 'paused'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

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

function isRecentlyFired(lastTriggeredAt: string | null): boolean {
  if (!lastTriggeredAt) return false
  return Date.now() - new Date(lastTriggeredAt).getTime() < 60 * 60 * 1000
}

type RuleStatus = 'firing' | 'active' | 'paused'

function ruleStatus(a: AlertRow): RuleStatus {
  if (!a.is_active) return 'paused'
  return isRecentlyFired(a.last_triggered_at) ? 'firing' : 'active'
}

const STATUS_VARIANT: Record<RuleStatus, NonNullable<React.ComponentProps<typeof StatusPill>['variant']>> = { firing: 'bad', active: 'good', paused: 'neutral' }
const STATUS_RANK: Record<RuleStatus, number> = { firing: 0, active: 1, paused: 2 }

const RULE_GRID: CSSProperties = {
  gridTemplateColumns: 'minmax(200px,1.6fr) 148px 118px 92px 104px 150px 84px',
}
const CHANNEL_GRID: CSSProperties = {
  gridTemplateColumns: 'minmax(150px,1fr) minmax(220px,2fr) 130px 92px',
}
const DELIVERY_GRID: CSSProperties = {
  gridTemplateColumns: '200px 92px minmax(200px,1fr)',
}

function alertFires(id: string): number {
  return DEMO_DELIVERIES.filter((d) => d.alert_id === id).length
}

export default function DemoAlertsPage() {
  const alerts = DEMO_ALERTS
  const channels = DEMO_CHANNELS
  const deliveries = DEMO_DELIVERIES
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [tab, setTab] = useState<'alerts' | 'channels'>('alerts')

  const totalFiring = alerts.filter((a) => ruleStatus(a) === 'firing').length
  const totalActive = alerts.filter((a) => a.is_active).length
  const totalPaused = alerts.filter((a) => !a.is_active).length
  const firstFiring = alerts.find((a) => ruleStatus(a) === 'firing')

  // One flat table ordered firing → active → paused, matching the D13 board.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return alerts
      .filter((a) => {
        if (q && !a.name.toLowerCase().includes(q) && !a.type.toLowerCase().includes(q)) return false
        if (status === 'all') return true
        return ruleStatus(a) === status
      })
      .sort((x, y) => STATUS_RANK[ruleStatus(x)] - STATUS_RANK[ruleStatus(y)])
  }, [alerts, query, status])

  const isFiltered = query.trim().length > 0 || status !== 'all'

  // Channels are org-level, so every rule routes to the same set.
  const channelFanout = [...new Set(channels.filter((c) => c.is_active).map((c) => c.kind))].sort().join(', ')

  // Capture "now" once at mount — demo data is static.
  const now = useHydrationSafeNow()
  const fires24h = deliveries.filter(
    (d) => now - new Date(d.created_at).getTime() < 24 * 60 * 60 * 1000,
  ).length

  return (
    <div>
      <div className={TOPBAR_BLEED}>
        <Topbar
          crumbs={[{ label: 'Demo', href: '/demo/dashboard' }, { label: 'Alerts' }]}
          right={
            <div className="flex items-center gap-2">
              <DemoExportButton
                base="alerts"
                rows={filtered}
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
                className={cn(CONTROL, 'hidden px-3 text-[12.5px] font-medium leading-[18px] text-text-muted transition-colors hover:text-text sm:inline-flex sm:items-center')}
              >
                Add channel
              </button>
              <button
                type="button"
                onClick={() => alert('Sign up to create alerts')}
                className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-accent-fg transition-colors hover:bg-accent-strong"
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                New alert
              </button>
            </div>
          }
        />
        <h1 className="sr-only">Alerts</h1>
      </div>

      <Board>
        {/* `contents` drops the tab root out of layout so the strip and panel
            inherit the board's 16px rhythm. */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'alerts' | 'channels')} className="contents">
          <TabsList>
            <TabsTrigger value="alerts">Alerts</TabsTrigger>
            <TabsTrigger value="channels">Channels</TabsTrigger>
          </TabsList>

          <TabsContent value="alerts" className="mt-0 flex flex-col gap-4">
            <FilterBar>
              <div className={cn(CONTROL, 'flex min-w-[220px] flex-1 items-center gap-2 px-3')}>
                <Search className="h-[13px] w-[13px] shrink-0 text-text-faint" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setQuery('') }}
                  placeholder="Search alerts"
                  aria-label="Search alerts"
                  className="w-full bg-transparent text-[12.5px] leading-[18px] text-text placeholder:text-text-faint focus:outline-none"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label="Clear search"
                    className="shrink-0 font-mono text-[11px] text-text-faint transition-colors hover:text-text"
                  >
                    Clear
                  </button>
                )}
              </div>

              <Segment>
                {STATUS_FILTERS.map((s) => (
                  <SegmentItem key={s} active={s === status} onClick={() => setStatus(s)} className="capitalize">
                    {s}
                  </SegmentItem>
                ))}
              </Segment>

              <span className="flex-1" />

              {isFiltered && (
                <span className="whitespace-nowrap font-mono text-[11px] text-text-faint">
                  {filtered.length} of {alerts.length}
                </span>
              )}
            </FilterBar>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="Rules total" value={alerts.length} foot="across this workspace" />
              <StatCard label="Rules active" value={totalActive} foot={`${totalPaused} paused`} />
              <StatCard
                label="Firing now"
                value={totalFiring}
                foot={firstFiring ? firstFiring.name : 'nothing breaching'}
                {...(totalFiring > 0 ? { footClass: 'text-accent' } : {})}
              />
              <StatCard label="Fires 24h" value={fires24h} foot={`${deliveries.length} deliveries on record`} />
            </div>

            {filtered.length === 0 ? (
              <div className="card-surface rounded-card flex h-40 flex-col items-center justify-center gap-3 text-text-muted">
                <p className="text-[12.5px]">No alerts match the current filters.</p>
                <button
                  type="button"
                  onClick={() => { setQuery(''); setStatus('all') }}
                  className="font-mono text-[11px] text-text underline underline-offset-2 hover:no-underline"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <TableCard>
                <div className="overflow-x-auto">
                  <div className="min-w-[920px]">
                    <TableHead>
                      <div className="grid items-center gap-3" style={RULE_GRID}>
                        <Th>Rule</Th>
                        <Th>Metric</Th>
                        <Th>Threshold</Th>
                        <Th>Window</Th>
                        <Th>Cooldown</Th>
                        <Th>Channels</Th>
                        <Th>Status</Th>
                      </div>
                    </TableHead>
                    {filtered.map((a) => {
                      const s = ruleStatus(a)
                      return (
                        <Link
                          key={a.id}
                          href={`/demo/alerts/${a.id}`}
                          className={cn(ROW, 'grid items-center gap-3 transition-colors hover:bg-bg-muted/50')}
                          style={RULE_GRID}
                        >
                          <span className="truncate text-[12px] leading-[1.45] text-text">{a.name}</span>
                          <span className="truncate font-mono text-[12px] leading-[1.45] text-text-muted">
                            {metricLabel(a.type)}
                          </span>
                          <span className="font-mono text-[12px] leading-[1.45] tabular-nums text-text-muted">
                            {a.type === 'eval_score' ? '<' : '>'} {fmtThreshold(a.type, a.threshold)}
                          </span>
                          <span className="font-mono text-[12px] leading-[1.45] tabular-nums text-text-muted">
                            {a.window_minutes} min
                          </span>
                          <span className="font-mono text-[12px] leading-[1.45] tabular-nums text-text-muted">
                            {a.cooldown_minutes} min
                          </span>
                          <span className="truncate font-mono text-[12px] leading-[1.45] text-text-muted">
                            {channelFanout || 'none'}
                          </span>
                          <span>
                            <StatusPill variant={STATUS_VARIANT[s]}>{s}</StatusPill>
                          </span>
                        </Link>
                      )
                    })}
                  </div>
                </div>
              </TableCard>
            )}

            <div className="card-surface rounded-card flex flex-wrap items-center gap-2 px-5 py-3.5 font-mono text-[11px] text-text-muted">
              <Bell className="h-3.5 w-3.5 shrink-0" />
              <span>Threshold rules on cost, error rate, and p95 latency. Evaluated every ~5 minutes.</span>
              <Link href="/docs/features/alerts" className="ml-auto text-text transition-opacity hover:opacity-80">
                How alerts work →
              </Link>
            </div>
          </TabsContent>

          <TabsContent value="channels" className="mt-0 flex flex-col gap-4">
            <div className="card-surface rounded-card flex flex-wrap items-center gap-2 px-5 py-3.5 font-mono text-[11px] text-text-muted">
              <MessageSquare className="h-3.5 w-3.5 shrink-0" />
              <span>Every active rule fans out to all connected channels.</span>
            </div>

            <TableCard>
              <div className="overflow-x-auto">
                <div className="min-w-[720px]">
                  <TableHead>
                    <div className="grid items-center gap-3" style={CHANNEL_GRID}>
                      <Th>Channel</Th>
                      <Th>Target</Th>
                      <Th>Added</Th>
                      <Th>Status</Th>
                    </div>
                  </TableHead>
                  {channels.map((ch) => (
                    <div key={ch.id} className={cn(ROW, 'grid items-center gap-3')} style={CHANNEL_GRID}>
                      <span className="flex min-w-0 items-center gap-2 text-[12px] leading-[1.45] text-text">
                        <span className="shrink-0 text-text-faint">
                          {ch.kind === 'email' ? <Mail className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
                        </span>
                        <span className="truncate">{ch.label ?? ch.kind}</span>
                      </span>
                      <span className="truncate font-mono text-[12px] leading-[1.45] text-text-muted">
                        {ch.kind === 'slack' ? 'https://hooks.slack.com/services/T00000/…' : ch.target}
                      </span>
                      <span className="font-mono text-[12px] leading-[1.45] text-text-muted">
                        {formatDate(ch.created_at)}
                      </span>
                      <span>
                        <StatusPill variant={ch.is_active ? 'good' : 'neutral'}>{ch.is_active ? 'active' : 'off'}</StatusPill>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </TableCard>

            <TableCard>
              <TableHead>
                <div className="grid items-center gap-3" style={DELIVERY_GRID}>
                  <Th>Delivered</Th>
                  <Th>Status</Th>
                  <Th>Detail</Th>
                </div>
              </TableHead>
              {deliveries.slice(0, 10).map((d) => (
                <div key={d.id} className={cn(ROW, 'grid items-center gap-3')} style={DELIVERY_GRID}>
                  <span className="font-mono text-[12px] leading-[1.45] text-text-muted">
                    {formatDateTime(d.created_at)}
                  </span>
                  <span>
                    <StatusPill variant={d.status === 'sent' ? 'good' : 'bad'}>{d.status}</StatusPill>
                  </span>
                  <span className="truncate font-mono text-[11px] leading-[1.45] text-text-faint">
                    {d.error_message ?? 'no errors reported'}
                  </span>
                </div>
              ))}
            </TableCard>
          </TabsContent>
        </Tabs>
      </Board>
    </div>
  )
}
