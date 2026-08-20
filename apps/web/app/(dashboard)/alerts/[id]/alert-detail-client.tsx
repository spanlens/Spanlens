'use client'
import { useMemo, useState, useSyncExternalStore } from 'react'

// Hydration-safe mounted gate. Same pattern as the other overhauled pages —
// avoids the suppressHydrationWarning band-aid on cells that depend on
// Date.now() or the user's local timezone.
const subscribeNoop = () => () => {}
const getTrue = () => true
const getFalse = () => false
function useMounted(): boolean {
  return useSyncExternalStore(subscribeNoop, getTrue, getFalse)
}
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Trash2 } from 'lucide-react'
import {
  useAlerts,
  useDeleteAlert,
  useUpdateAlert,
  useAlertDeliveries,
  useNotificationChannels,
} from '@/lib/queries/use-alerts'
import type { AlertRow, AlertType } from '@/lib/queries/types'
import { Topbar } from '@/components/layout/topbar'
import { PermissionGate } from '@/components/permission-gate'
import { StatusPill } from '@/components/ui/primitives'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn, formatDateTime, formatTime } from '@/lib/utils'
import {
  Board,
  TOPBAR_BLEED,
  CONTROL,
  SummaryStrip,
  SummaryCell,
  Well,
} from '../../_board/surfaces'

function fmtThreshold(type: AlertType, threshold: number): string {
  if (type === 'budget') return `$${threshold}`
  if (type === 'error_rate') return `${(threshold * 100).toFixed(1)}%`
  if (type === 'eval_score') return `${(threshold * 100).toFixed(1)}%`
  return `${threshold}ms`
}

// Short human name for the summary strip. The expression form lives in the
// trigger card, which has the width for it.
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
function CardHead({
  title,
  note,
  noteClass,
}: {
  title: string
  // `| undefined` is explicit because the project runs exactOptionalPropertyTypes.
  note?: string | undefined
  noteClass?: string | undefined
}) {
  return (
    <div className="mb-[14px] flex items-baseline gap-2.5">
      <CardTitle>{title}</CardTitle>
      <span className="flex-1" />
      {note && (
        <span className={cn('font-mono text-[11px] leading-[1.4] text-text-faint', noteClass)}>
          {note}
        </span>
      )}
    </div>
  )
}

export function AlertDetailClient() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params?.id ?? ''

  const alertsQuery = useAlerts()
  const deliveriesQuery = useAlertDeliveries()
  const channelsQuery = useNotificationChannels()
  const updateAlert = useUpdateAlert()
  const deleteAlert = useDeleteAlert()

  const alert: AlertRow | undefined = useMemo(
    () => (alertsQuery.data ?? []).find((a) => a.id === id),
    [alertsQuery.data, id],
  )

  // Newest first — the board reads top-down and the "Where it goes" card wants
  // the most recent attempt per channel.
  const deliveries = useMemo(
    () => (deliveriesQuery.data ?? [])
      .filter((d) => d.alert_id === id)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [deliveriesQuery.data, id],
  )

  const channels = useMemo(() => channelsQuery.data ?? [], [channelsQuery.data])

  const channelById = useMemo(() => {
    const m = new Map<string, { kind: string; target: string }>()
    for (const c of channels) m.set(c.id, { kind: c.kind, target: c.target })
    return m
  }, [channels])

  // Most recent delivery attempt per channel, for the routing card's status.
  const lastByChannel = useMemo(() => {
    const m = new Map<string, (typeof deliveries)[number]>()
    for (const d of deliveries) if (!m.has(d.channel_id)) m.set(d.channel_id, d)
    return m
  }, [deliveries])

  // Capture "now" at mount — used to bucket deliveries into the last 24h.
  // This is a UI sliver, not a billing window, so a fixed reference is fine.
  const [mountNow] = useState(() => Date.now())
  const mounted = useMounted()

  const [editOpen, setEditOpen] = useState(false)
  const [editName, setEditName] = useState('')
  const [editThreshold, setEditThreshold] = useState('')
  const [editWindow, setEditWindow] = useState('60')
  const [editCooldown, setEditCooldown] = useState('60')

  function openEdit() {
    if (!alert) return
    setEditName(alert.name)
    setEditThreshold(String(alert.threshold))
    setEditWindow(String(alert.window_minutes))
    setEditCooldown(String(alert.cooldown_minutes))
    setEditOpen(true)
  }

  async function handleSave() {
    if (!alert) return
    const threshold = Number(editThreshold)
    if (!editName.trim() || !Number.isFinite(threshold) || threshold <= 0) return
    await updateAlert.mutateAsync({
      id: alert.id,
      name: editName.trim(),
      threshold,
      window_minutes: Math.max(1, Number(editWindow) || 60),
      cooldown_minutes: Math.max(0, Number(editCooldown) || 60),
    })
    setEditOpen(false)
  }

  async function handleDelete() {
    if (!alert) return
    if (!confirm(`Delete alert "${alert.name}"? This can't be undone.`)) return
    await deleteAlert.mutateAsync(alert.id)
    router.push('/alerts')
  }

  async function handleToggle() {
    if (!alert) return
    await updateAlert.mutateAsync({ id: alert.id, is_active: !alert.is_active })
  }

  if (alertsQuery.isLoading) {
    return (
      <div>
        <div className={TOPBAR_BLEED}>
          <Topbar crumbs={[{ label: 'Alerts', href: '/alerts' }, { label: '…' }]} />
        </div>
        <Board>
          <Skeleton className="h-[70px] w-full rounded-card" />
          <Skeleton className="h-[220px] w-full rounded-card" />
        </Board>
      </div>
    )
  }

  if (!alert) {
    return (
      <div>
        <div className={TOPBAR_BLEED}>
          <Topbar crumbs={[{ label: 'Alerts', href: '/alerts' }, { label: 'Not found' }]} />
        </div>
        <Board>
          <div className="card-surface rounded-card flex h-64 flex-col items-center justify-center gap-3 text-text-muted">
            <p className="text-[13px]">Alert rule not found.</p>
            <Link href="/alerts" className="font-mono text-[12px] text-accent transition-opacity hover:opacity-80">
              ← Back to all alerts
            </Link>
          </div>
        </Board>
      </div>
    )
  }

  // `firing` folds in `mounted` because isRecentlyFired reads Date.now() —
  // SSR and the first client paint both render the non-firing shape, and the
  // banner only appears on the post-hydration pass.
  const firing = mounted && alert.is_active && isRecentlyFired(alert.last_triggered_at)
  const fires24h = deliveries.filter(
    (d) => mountNow - new Date(d.created_at).getTime() < 24 * 60 * 60 * 1000,
  ).length
  const failed = deliveries.filter((d) => d.status === 'failed').length

  return (
    <div>
      <div className={TOPBAR_BLEED}>
        <Topbar
          crumbs={[
            { label: 'Alerts', href: '/alerts' },
            { label: alert.name },
          ]}
          right={
            <PermissionGate need="edit">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleToggle()}
                  disabled={updateAlert.isPending}
                  title={alert.is_active ? 'Pause rule' : 'Resume rule'}
                  className={cn(CONTROL, 'px-3.5 text-[12.5px] font-medium leading-[18px] text-text transition-colors hover:border-border-strong disabled:opacity-40')}
                >
                  {alert.is_active ? 'Pause rule' : 'Resume rule'}
                </button>
                <button
                  type="button"
                  onClick={openEdit}
                  title="Edit rule"
                  className="rounded-full bg-primary px-3.5 py-2 text-[12.5px] font-semibold leading-[18px] text-primary-foreground transition-opacity hover:opacity-90"
                >
                  Edit rule
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={deleteAlert.isPending}
                  className="p-2 text-text-faint transition-colors hover:text-bad disabled:opacity-40"
                  title="Delete rule"
                  aria-label="Delete rule"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </PermissionGate>
          }
        />
        {/* The rule name lives in the breadcrumb on this board, so the heading
            stays in the accessibility tree only. */}
        <h1 className="sr-only">{alert.name}</h1>
      </div>

      <Board>
        {/* Firing banner — only while the rule is breaching. The Figma frame
            pairs it with an "Acknowledge" button; alerts have no acknowledge
            action today, so the right slot carries the 24h delivery count
            instead of a control that would do nothing. */}
        {firing && (
          <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-border bg-bad-bg px-4 py-3.5">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            <span className="text-[12.5px] font-semibold leading-[1.45] text-accent">
              Firing since {formatTime(alert.last_triggered_at)}, {metricLabel(alert.type)} broke its{' '}
              {fmtThreshold(alert.type, alert.threshold)} {alert.type === 'eval_score' ? 'floor' : 'ceiling'}
            </span>
            <span className="ml-auto font-mono text-[11px] leading-[1.4] text-accent">
              {fires24h} delivered in 24h
            </span>
          </div>
        )}

        {/* Summary strip. SCOPE reports whether the rule is pinned to a project
            or watches the whole workspace — the project name is not part of the
            alert payload, so the strip names the level rather than the id. */}
        <SummaryStrip>
          <SummaryCell label="Metric">{metricLabel(alert.type)}</SummaryCell>
          <SummaryCell label="Threshold">
            {alert.type === 'eval_score' ? '<' : '>'} {fmtThreshold(alert.type, alert.threshold)}
          </SummaryCell>
          <SummaryCell label="Window">{alert.window_minutes} min</SummaryCell>
          <SummaryCell label="Cooldown">{alert.cooldown_minutes} min</SummaryCell>
          <SummaryCell label="Scope">{alert.project_id ? 'project' : 'workspace'}</SummaryCell>
          <SummaryCell label="Fires 24h">
            {/* Tinted only when the rule actually delivered something. */}
            <span className={cn(mounted && fires24h > 0 && 'text-accent')}>
              {mounted ? fires24h : ' '}
            </span>
          </SummaryCell>
        </SummaryStrip>

        {/* Split row — delivery history on the left, routing on the right. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="px-5 py-[18px]">
            <CardHead
              title="Recent fires"
              note={mounted ? `last fired ${relTime(alert.last_triggered_at)}` : undefined}
              {...(mounted && failed > 0 ? { noteClass: 'text-bad' } : {})}
            />
            {deliveriesQuery.isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : deliveries.length === 0 ? (
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
                        {mounted ? formatDateTime(d.created_at) : ' '}
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
            <CardHead
              title="Where it goes"
              note={channels.length > 0 ? `${channels.length} connected` : undefined}
            />
            {channelsQuery.isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : channels.length === 0 ? (
              <p className="text-[12.5px] leading-[1.6] text-text-muted">
                No channels connected.{' '}
                <Link href="/settings?tab=integrations" className="text-accent transition-opacity hover:opacity-80">
                  Connect Slack, Discord, or email
                </Link>{' '}
                so this rule can reach someone.
              </p>
            ) : (
              <div>
                {channels.map((ch) => {
                  const last = lastByChannel.get(ch.id)
                  return (
                    <div
                      key={ch.id}
                      className="flex items-center gap-3 border-b border-border py-[9px] last:border-b-0"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] leading-[1.45] text-text">
                          {ch.label ?? ch.kind}
                        </div>
                        <div className="truncate font-mono text-[11px] leading-[1.45] text-text-faint">
                          {ch.target}
                        </div>
                      </div>
                      <span
                        className={cn(
                          'shrink-0 font-mono text-[11px] leading-[1.45]',
                          !mounted || !last
                            ? 'text-text-faint'
                            : last.status === 'sent'
                              ? 'text-good'
                              : 'text-bad',
                        )}
                      >
                        {!mounted
                          ? ' '
                          : !last
                            ? 'no deliveries yet'
                            : `${last.status === 'sent' ? 'delivered' : 'failed'} ${formatTime(last.created_at)}`}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Trigger expression. Not part of the Figma frame, kept because it is
            the only place that spells out the cooldown behaviour. */}
        <Card className="px-5 py-[18px]">
          <CardHead title="Trigger" note={`re-alerts suppressed for ${alert.cooldown_minutes} min`} />
          <Well>
            <code className="font-mono text-[12.5px] leading-[1.45] text-text">
              {metricExpression(alert.type)}
              {' '}{alert.type === 'eval_score' ? '<' : '>'} {fmtThreshold(alert.type, alert.threshold)}
              {' '}for {alert.window_minutes}m
            </code>
          </Well>
          <p className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] leading-[1.6] text-text-muted">
            <StatusPill variant={alert.is_active ? 'good' : 'neutral'}>
              {alert.is_active ? 'active' : 'paused'}
            </StatusPill>
            <span>
              Evaluated every ~5 minutes by the{' '}
              <code className="font-mono text-text">cron-evaluate-alerts</code> job.
            </span>
          </p>
        </Card>
      </Board>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit alert rule</DialogTitle>
          </DialogHeader>
          <div className="mt-2 space-y-4">
            <div className="space-y-2">
              <label htmlFor="edit-alert-name" className="eyebrow block">Name</label>
              <input
                id="edit-alert-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className={cn(CONTROL, 'w-full px-3 text-[12.5px] leading-[18px] text-text focus:border-border-strong focus:outline-none')}
              />
            </div>
            <div className="space-y-2">
              <span className="eyebrow block">
                Type <span className="normal-case tracking-normal">· locked, threshold semantics depend on type</span>
              </span>
              <Select value={alert.type} disabled>
                <SelectTrigger aria-label="Alert type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="budget">Budget (USD)</SelectItem>
                  <SelectItem value="error_rate">Error rate (0–1)</SelectItem>
                  <SelectItem value="latency_p95">p95 latency (ms)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { id: 'edit-alert-threshold', label: 'Threshold', value: editThreshold, onChange: setEditThreshold },
                { id: 'edit-alert-window', label: 'Window (min)', value: editWindow, onChange: setEditWindow },
                { id: 'edit-alert-cooldown', label: 'Cooldown (min)', value: editCooldown, onChange: setEditCooldown },
              ].map((f) => (
                <div key={f.label} className="space-y-2">
                  <label htmlFor={f.id} className="eyebrow block">{f.label}</label>
                  <input
                    id={f.id}
                    type="number"
                    step="any"
                    value={f.value}
                    onChange={(e) => f.onChange(e.target.value)}
                    className={cn(CONTROL, 'w-full px-3 text-[12.5px] leading-[18px] tabular-nums text-text focus:border-border-strong focus:outline-none')}
                  />
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!editName.trim() || !editThreshold || updateAlert.isPending}
              className="w-full rounded-full bg-primary py-2 text-[12.5px] font-semibold leading-[18px] text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {updateAlert.isPending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
