'use client'

import { useState } from 'react'
import { Plus, Trash2, Mail, MessageSquare } from 'lucide-react'
import {
  useAlerts,
  useCreateAlert,
  useDeleteAlert,
  useUpdateAlert,
  useNotificationChannels,
  useCreateChannel,
  useDeleteChannel,
  useAlertDeliveries,
} from '@/lib/queries/use-alerts'
import type { AlertType, ChannelKind, AlertRow, AlertDeliveryRow } from '@/lib/queries/types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Topbar } from '@/components/layout/topbar'
import { MicroLabel, PrimaryBtn, GhostBtn } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'

function fmtThreshold(type: AlertType, threshold: number): string {
  if (type === 'budget') return `$${threshold}`
  if (type === 'error_rate') return `${(threshold * 100).toFixed(1)}%`
  return `${threshold}ms`
}

function kindLabel(type: AlertType): string {
  if (type === 'budget') return 'Budget'
  if (type === 'error_rate') return 'Error rate'
  return 'p95 latency'
}

function isRecentlyFired(lastTriggeredAt: string | null): boolean {
  if (!lastTriggeredAt) return false
  return Date.now() - new Date(lastTriggeredAt).getTime() < 60 * 60 * 1000
}

function ChannelIcon({ kind }: { kind: ChannelKind }) {
  if (kind === 'email') return <Mail className="h-3.5 w-3.5" />
  return <MessageSquare className="h-3.5 w-3.5" />
}

function KpiTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: string
  accent?: boolean
}) {
  return (
    <div className="flex flex-col gap-1 px-6 py-4 border-r border-border last:border-r-0">
      <MicroLabel>{label}</MicroLabel>
      <span
        className={cn(
          'text-[22px] font-semibold leading-none',
          accent ? 'text-accent' : 'text-text',
        )}
      >
        {value}
      </span>
      {sub && <span className="text-[11px] text-text-muted font-mono">{sub}</span>}
    </div>
  )
}

interface AlertGroupProps {
  title: string
  alerts: AlertRow[]
  deliveries: AlertDeliveryRow[]
  onToggle: (id: string, active: boolean) => void
  onDelete: (id: string) => void
  isPending: boolean
  firing?: boolean
}

function AlertGroup({
  title,
  alerts,
  deliveries,
  onToggle,
  onDelete,
  isPending,
  firing = false,
}: AlertGroupProps) {
  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-2 px-6 py-2 border-b border-border',
          firing ? 'bg-accent-bg' : 'bg-bg-elev',
        )}
      >
        <span
          className={cn(
            'font-mono text-[10.5px] uppercase tracking-[0.05em] font-semibold',
            firing ? 'text-accent' : 'text-text-faint',
          )}
        >
          {title}
        </span>
        <span
          className={cn(
            'font-mono text-[10px]',
            firing ? 'text-accent/70' : 'text-text-faint',
          )}
        >
          {alerts.length}
        </span>
      </div>
      {alerts.map((a) => {
        const alertFires = deliveries.filter((d) => d.alert_id === a.id).length
        const isFiring = a.is_active && isRecentlyFired(a.last_triggered_at)
        return (
          <div
            key={a.id}
            className="flex items-center gap-4 px-6 py-3.5 border-b border-border hover:bg-bg-elev transition-colors"
          >
            <span
              className={cn(
                'w-2 h-2 rounded-full shrink-0',
                isFiring ? 'bg-accent animate-pulse' : a.is_active ? 'bg-good' : 'bg-text-faint',
              )}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-[13px] text-text">{a.name}</span>
                <span className="font-mono text-[10.5px] uppercase tracking-[0.04em] bg-bg-elev border border-border px-1.5 py-0.5 rounded text-text-muted">
                  {a.type}
                </span>
              </div>
              <p className="text-[11.5px] text-text-muted mt-0.5 font-mono">
                {kindLabel(a.type)} &gt; {fmtThreshold(a.type, a.threshold)} · {a.window_minutes}m
                window · {a.cooldown_minutes}m cooldown
                {a.last_triggered_at &&
                  ` · last fired ${new Date(a.last_triggered_at).toLocaleString()}`}
              </p>
            </div>
            <div className="text-right shrink-0 w-16">
              <div className="text-[13px] font-mono text-text">{alertFires}</div>
              <div className="text-[10.5px] text-text-faint">fires</div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => onToggle(a.id, !a.is_active)}
                disabled={isPending}
                className="px-2.5 py-1 rounded border border-border text-[11.5px] text-text-muted hover:text-text transition-colors disabled:opacity-40"
              >
                {a.is_active ? 'Pause' : 'Resume'}
              </button>
              <button
                type="button"
                onClick={() => onDelete(a.id)}
                disabled={isPending}
                className="p-1.5 text-text-faint hover:text-bad transition-colors disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

type AlertStateFilter = 'all' | 'firing' | 'ok' | 'paused'

export default function AlertsPage() {
  const alertsQuery = useAlerts()
  const channelsQuery = useNotificationChannels()
  const deliveriesQuery = useAlertDeliveries()
  const createAlert = useCreateAlert()
  const deleteAlert = useDeleteAlert()
  const updateAlert = useUpdateAlert()
  const createChannel = useCreateChannel()
  const deleteChannel = useDeleteChannel()

  const [stateFilter, setStateFilter] = useState<AlertStateFilter>('all')
  const [alertDialogOpen, setAlertDialogOpen] = useState(false)
  const [channelDialogOpen, setChannelDialogOpen] = useState(false)

  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<AlertType>('budget')
  const [newThreshold, setNewThreshold] = useState('')
  const [newWindow, setNewWindow] = useState('60')
  const [newCooldown, setNewCooldown] = useState('60')

  const [newChannelKind, setNewChannelKind] = useState<ChannelKind>('email')
  const [newChannelTarget, setNewChannelTarget] = useState('')

  const alerts = alertsQuery.data ?? []
  const channels = channelsQuery.data ?? []
  const deliveries = deliveriesQuery.data ?? []

  const firingAlerts = alerts.filter((a) => a.is_active && isRecentlyFired(a.last_triggered_at))
  const activeAlerts = alerts.filter((a) => a.is_active && !isRecentlyFired(a.last_triggered_at))
  const pausedAlerts = alerts.filter((a) => !a.is_active)
  const fires24h = deliveries.filter(
    (d) => Date.now() - new Date(d.created_at).getTime() < 24 * 60 * 60 * 1000,
  ).length

  const isPending = updateAlert.isPending || deleteAlert.isPending

  async function handleCreateAlert() {
    const threshold = Number(newThreshold)
    if (!newName.trim() || !Number.isFinite(threshold) || threshold <= 0) return
    await createAlert.mutateAsync({
      name: newName.trim(),
      type: newType,
      threshold,
      window_minutes: Math.max(1, Number(newWindow) || 60),
      cooldown_minutes: Math.max(0, Number(newCooldown) || 60),
    })
    setNewName('')
    setNewThreshold('')
    setAlertDialogOpen(false)
  }

  async function handleCreateChannel() {
    if (!newChannelTarget.trim()) return
    await createChannel.mutateAsync({
      kind: newChannelKind,
      target: newChannelTarget.trim(),
    })
    setNewChannelTarget('')
    setChannelDialogOpen(false)
  }

  return (
    <div className="-m-7 flex flex-col h-screen overflow-hidden bg-bg">
      {/* Topbar */}
      <Topbar
        crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Alerts' }]}
        right={
          <div className="flex items-center gap-2">
            <GhostBtn
              onClick={() => setChannelDialogOpen(true)}
              className="flex items-center gap-1.5 text-[12.5px] px-3 py-[5px]"
            >
              <Plus className="h-3.5 w-3.5" />
              Add channel
            </GhostBtn>
            <PrimaryBtn
              onClick={() => setAlertDialogOpen(true)}
              className="flex items-center gap-1.5 text-[12.5px] px-3 py-[5px]"
            >
              <Plus className="h-3.5 w-3.5" />
              New alert
            </PrimaryBtn>
          </div>
        }
      />

      {/* Stat strip */}
      <div className="grid grid-cols-5 border-b border-border shrink-0">
        <KpiTile
          label="Firing now"
          value={String(firingAlerts.length)}
          accent={firingAlerts.length > 0}
        />
        <KpiTile label="Rules active" value={String(alerts.filter((a) => a.is_active).length)} />
        <KpiTile label="Fires 24h" value={String(fires24h)} />
        <KpiTile label="Rules total" value={String(alerts.length)} />
        <KpiTile label="Channels" value={String(channels.length)} />
      </div>

      {/* Filter toolbar */}
      <div className="flex items-center gap-2 px-6 py-2.5 border-b border-border shrink-0">
        {(['all', 'firing', 'ok', 'paused'] as AlertStateFilter[]).map((f) => (
          <button
            type="button"
            key={f}
            onClick={() => setStateFilter(f)}
            className={cn(
              'px-3 py-1 rounded text-[12.5px] transition-colors',
              stateFilter === f
                ? 'bg-bg-elev text-text font-medium border border-border-strong'
                : 'text-text-muted hover:text-text',
            )}
          >
            {f === 'all'
              ? 'All'
              : f === 'firing'
                ? 'Firing'
                : f === 'ok'
                  ? 'Active'
                  : 'Paused'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {alertsQuery.isLoading ? (
          <div className="p-6 space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 bg-bg-elev rounded animate-pulse" />
            ))}
          </div>
        ) : alerts.length === 0 && channels.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
            <p className="text-[13px]">No alert rules yet.</p>
            <p className="text-[12px]">
              Create an alert to get notified about budget, error rate, or latency issues.
            </p>
            <PrimaryBtn
              onClick={() => setAlertDialogOpen(true)}
              className="flex items-center gap-1.5 text-[12.5px] px-3 py-[5px] mt-1"
            >
              <Plus className="h-3.5 w-3.5" />
              New alert
            </PrimaryBtn>
          </div>
        ) : (
          <div className="pb-8">
            {(stateFilter === 'all' || stateFilter === 'firing') && firingAlerts.length > 0 && (
              <AlertGroup
                title="Firing"
                alerts={firingAlerts}
                deliveries={deliveries}
                onToggle={(id, active) => void updateAlert.mutateAsync({ id, is_active: active })}
                onDelete={(id) => void deleteAlert.mutateAsync(id)}
                isPending={isPending}
                firing
              />
            )}
            {(stateFilter === 'all' || stateFilter === 'ok') && activeAlerts.length > 0 && (
              <AlertGroup
                title="Active"
                alerts={activeAlerts}
                deliveries={deliveries}
                onToggle={(id, active) => void updateAlert.mutateAsync({ id, is_active: active })}
                onDelete={(id) => void deleteAlert.mutateAsync(id)}
                isPending={isPending}
              />
            )}
            {(stateFilter === 'all' || stateFilter === 'paused') && pausedAlerts.length > 0 && (
              <AlertGroup
                title="Paused"
                alerts={pausedAlerts}
                deliveries={deliveries}
                onToggle={(id, active) => void updateAlert.mutateAsync({ id, is_active: active })}
                onDelete={(id) => void deleteAlert.mutateAsync(id)}
                isPending={isPending}
              />
            )}

            {/* Channels section */}
            {stateFilter === 'all' && (
              <div className="mt-6 mx-6">
                <span className="text-[12px] font-mono uppercase tracking-[0.05em] text-text-faint block mb-3">
                  Notification channels
                </span>
                {channelsQuery.isLoading ? (
                  <div className="h-12 bg-bg-elev rounded animate-pulse" />
                ) : channels.length === 0 ? (
                  <div className="rounded border border-dashed border-border py-6 text-center text-[12.5px] text-text-muted">
                    No channels yet — add an email or webhook to receive alerts.
                  </div>
                ) : (
                  <div className="rounded-md border border-border bg-bg-elev overflow-hidden">
                    {channels.map((ch) => (
                      <div
                        key={ch.id}
                        className="flex items-center justify-between px-5 py-3 border-b border-border last:border-0"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-text-muted">
                            <ChannelIcon kind={ch.kind} />
                          </span>
                          <div className="min-w-0">
                            <span className="text-[11px] font-mono uppercase tracking-[0.04em] text-text-muted">
                              {ch.kind}
                            </span>
                            <p className="text-[12px] font-mono text-text-faint truncate max-w-xs">
                              {ch.target}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void deleteChannel.mutateAsync(ch.id)}
                          disabled={deleteChannel.isPending}
                          className="text-text-faint hover:text-bad transition-colors p-1 disabled:opacity-40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Recent deliveries */}
            {stateFilter === 'all' && deliveries.length > 0 && (
              <div className="mt-6 mx-6">
                <span className="text-[12px] font-mono uppercase tracking-[0.05em] text-text-faint block mb-3">
                  Recent deliveries
                </span>
                <div className="rounded-md border border-border bg-bg-elev overflow-hidden">
                  {deliveries.slice(0, 10).map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center gap-4 px-5 py-2 border-b border-border last:border-0 text-[11.5px]"
                    >
                      <span className="font-mono text-text-faint">
                        {new Date(d.created_at).toLocaleString()}
                      </span>
                      <span
                        className={cn(
                          'font-mono px-1.5 py-0.5 rounded text-[10px] uppercase tracking-[0.04em]',
                          d.status === 'sent' ? 'bg-good-bg text-good' : 'bg-bad-bg text-bad',
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
          </div>
        )}
      </div>

      {/* Create alert dialog */}
      <Dialog open={alertDialogOpen} onOpenChange={setAlertDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create alert rule</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <label className="text-[13px] font-medium">Name</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="High daily spend"
                className="w-full h-9 px-3 rounded border border-border bg-bg text-[13px] focus:outline-none focus:border-border-strong"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[13px] font-medium">Type</label>
              <Select value={newType} onValueChange={(v) => setNewType(v as AlertType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="budget">Budget (USD)</SelectItem>
                  <SelectItem value="error_rate">Error rate (0–1)</SelectItem>
                  <SelectItem value="latency_p95">p95 latency (ms)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <label className="text-[13px] font-medium">Threshold</label>
                <input
                  type="number"
                  step="any"
                  value={newThreshold}
                  onChange={(e) => setNewThreshold(e.target.value)}
                  placeholder={
                    newType === 'budget' ? '10' : newType === 'error_rate' ? '0.05' : '2000'
                  }
                  className="w-full h-9 px-3 rounded border border-border bg-bg text-[13px] focus:outline-none focus:border-border-strong"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[13px] font-medium">Window (min)</label>
                <input
                  type="number"
                  value={newWindow}
                  onChange={(e) => setNewWindow(e.target.value)}
                  className="w-full h-9 px-3 rounded border border-border bg-bg text-[13px] focus:outline-none focus:border-border-strong"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[13px] font-medium">Cooldown (min)</label>
                <input
                  type="number"
                  value={newCooldown}
                  onChange={(e) => setNewCooldown(e.target.value)}
                  className="w-full h-9 px-3 rounded border border-border bg-bg text-[13px] focus:outline-none focus:border-border-strong"
                />
              </div>
            </div>
            <PrimaryBtn
              onClick={() => void handleCreateAlert()}
              disabled={!newName.trim() || !newThreshold || createAlert.isPending}
              className="w-full"
            >
              {createAlert.isPending ? 'Creating…' : 'Create alert'}
            </PrimaryBtn>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add channel dialog */}
      <Dialog open={channelDialogOpen} onOpenChange={setChannelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add notification channel</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <label className="text-[13px] font-medium">Kind</label>
              <Select
                value={newChannelKind}
                onValueChange={(v) => setNewChannelKind(v as ChannelKind)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email (Resend)</SelectItem>
                  <SelectItem value="slack">Slack webhook</SelectItem>
                  <SelectItem value="discord">Discord webhook</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-[13px] font-medium">
                {newChannelKind === 'email' ? 'Email address' : 'Webhook URL'}
              </label>
              <input
                value={newChannelTarget}
                onChange={(e) => setNewChannelTarget(e.target.value)}
                placeholder={
                  newChannelKind === 'email'
                    ? 'alerts@yourco.com'
                    : newChannelKind === 'slack'
                      ? 'https://hooks.slack.com/services/…'
                      : 'https://discord.com/api/webhooks/…'
                }
                className="w-full h-9 px-3 rounded border border-border bg-bg text-[13px] focus:outline-none focus:border-border-strong"
              />
            </div>
            <PrimaryBtn
              onClick={() => void handleCreateChannel()}
              disabled={!newChannelTarget.trim() || createChannel.isPending}
              className="w-full"
            >
              {createChannel.isPending ? 'Adding…' : 'Add channel'}
            </PrimaryBtn>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
