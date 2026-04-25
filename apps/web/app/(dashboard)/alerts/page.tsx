'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Trash2, Mail, MessageSquare } from 'lucide-react'
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
import type { AlertType, ChannelKind, AlertRow } from '@/lib/queries/types'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Topbar } from '@/components/layout/topbar'
import { PermissionGate } from '@/components/permission-gate'
import { cn } from '@/lib/utils'

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

function AlertRuleRow({
  a,
  fires,
  onToggle,
  onEdit,
  onDelete,
  isPending,
  last,
}: {
  a: AlertRow
  fires: number
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
  isPending: boolean
  last: boolean
}) {
  const color = sevColor(a)
  const isFiring = color === 'accent'
  return (
    <div
      className={cn(
        'grid items-center px-[22px] py-[12px]',
        !last && 'border-b border-border',
        isFiring && 'bg-accent-bg',
      )}
      style={{ gridTemplateColumns: '28px 1fr 160px 60px 200px', gap: 14 }}
    >
      {/* state dot */}
      <div className="flex items-center justify-center">
        <span
          className={cn(
            'w-2 h-2 rounded-full',
            color === 'accent' ? 'bg-accent animate-pulse' : color === 'good' ? 'bg-good' : 'bg-text-faint',
          )}
        />
      </div>

      {/* name + rule */}
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <Link
            href={`/alerts/${a.id}`}
            className="text-[13.5px] text-text font-medium truncate hover:text-accent transition-colors"
          >
            {a.name}
          </Link>
          <span
            className={cn(
              'font-mono text-[9px] px-[6px] py-[1px] rounded-[3px] border uppercase tracking-[0.04em] shrink-0',
              isFiring ? 'text-accent border-accent-border bg-accent-bg' : 'text-text-muted border-border',
            )}
          >
            {kindLabel(a.type)}
          </span>
        </div>
        <div className="font-mono text-[11px] text-text-muted">
          <span className="text-text-faint">trigger </span>
          {a.type === 'budget' ? 'sum(cost)' : a.type === 'error_rate' ? 'error_rate' : 'p95(latency)'}{' '}
          &gt; {fmtThreshold(a.type, a.threshold)}
          <span className="text-text-faint"> for </span>{a.window_minutes}m
          {a.last_triggered_at && (
            <span className="text-text-faint ml-2">· last fired {new Date(a.last_triggered_at).toLocaleString()}</span>
          )}
        </div>
      </div>

      {/* window + cooldown */}
      <div>
        <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.03em] mb-[3px]">WINDOW · COOLDOWN</div>
        <div className="font-mono text-[12px] text-text-muted">
          {a.window_minutes}m · {a.cooldown_minutes}m
        </div>
      </div>

      {/* fire count */}
      <div className="text-right">
        <div className="font-mono text-[13px] text-text">{fires}</div>
        <div className="font-mono text-[10px] text-text-faint">fires</div>
      </div>

      {/* actions */}
      <PermissionGate need="edit">
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={onEdit}
            disabled={isPending}
            className="font-mono text-[10.5px] text-text-muted px-2 py-[3px] border border-border rounded-[4px] hover:text-text transition-colors disabled:opacity-40"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onToggle}
            disabled={isPending}
            className="font-mono text-[10.5px] text-text-muted px-2 py-[3px] border border-border rounded-[4px] hover:text-text transition-colors disabled:opacity-40"
          >
            {a.is_active ? 'Pause' : 'Resume'}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={isPending}
            className="p-1.5 text-text-faint hover:text-bad transition-colors disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </PermissionGate>
    </div>
  )
}

export default function AlertsPage() {
  const alertsQuery = useAlerts()
  const channelsQuery = useNotificationChannels()
  const deliveriesQuery = useAlertDeliveries()
  const createAlert = useCreateAlert()
  const deleteAlert = useDeleteAlert()
  const updateAlert = useUpdateAlert()
  const createChannel = useCreateChannel()
  const deleteChannel = useDeleteChannel()

  const [alertDialogOpen, setAlertDialogOpen] = useState(false)
  const [channelDialogOpen, setChannelDialogOpen] = useState(false)
  /** When non-null, the alert-form dialog is in edit mode for this id. */
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<AlertType>('budget')
  const [newThreshold, setNewThreshold] = useState('')
  const [newWindow, setNewWindow] = useState('60')
  const [newCooldown, setNewCooldown] = useState('60')
  const [newChannelKind, setNewChannelKind] = useState<ChannelKind>('email')
  const [newChannelTarget, setNewChannelTarget] = useState('')

  function openCreateAlert() {
    setEditingId(null)
    setNewName('')
    setNewType('budget')
    setNewThreshold('')
    setNewWindow('60')
    setNewCooldown('60')
    setAlertDialogOpen(true)
  }

  function openEditAlert(a: AlertRow) {
    setEditingId(a.id)
    setNewName(a.name)
    setNewType(a.type)
    setNewThreshold(String(a.threshold))
    setNewWindow(String(a.window_minutes))
    setNewCooldown(String(a.cooldown_minutes))
    setAlertDialogOpen(true)
  }

  const alerts = alertsQuery.data ?? []
  const channels = channelsQuery.data ?? []
  const deliveries = deliveriesQuery.data ?? []

  const firing = alerts.filter((a) => a.is_active && isRecentlyFired(a.last_triggered_at))
  const active = alerts.filter((a) => a.is_active && !isRecentlyFired(a.last_triggered_at))
  const paused = alerts.filter((a) => !a.is_active)
  const fires24h = deliveries.filter(
    (d) => Date.now() - new Date(d.created_at).getTime() < 24 * 60 * 60 * 1000,
  ).length
  const isPending = updateAlert.isPending || deleteAlert.isPending

  function alertFires(id: string): number {
    return deliveries.filter((d) => d.alert_id === id).length
  }

  async function handleSubmitAlert() {
    const threshold = Number(newThreshold)
    if (!newName.trim() || !Number.isFinite(threshold) || threshold <= 0) return
    const window_minutes = Math.max(1, Number(newWindow) || 60)
    const cooldown_minutes = Math.max(0, Number(newCooldown) || 60)

    if (editingId) {
      // Edit: type is immutable (threshold semantics depend on it)
      await updateAlert.mutateAsync({
        id: editingId,
        name: newName.trim(),
        threshold,
        window_minutes,
        cooldown_minutes,
      })
    } else {
      await createAlert.mutateAsync({
        name: newName.trim(),
        type: newType,
        threshold,
        window_minutes,
        cooldown_minutes,
      })
    }
    setAlertDialogOpen(false)
    setEditingId(null)
  }

  async function handleCreateChannel() {
    if (!newChannelTarget.trim()) return
    await createChannel.mutateAsync({ kind: newChannelKind, target: newChannelTarget.trim() })
    setNewChannelTarget('')
    setChannelDialogOpen(false)
  }

  return (
    <div className="-m-7 flex flex-col h-screen overflow-hidden bg-bg">
      <Topbar
        crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Alerts' }]}
        right={
          <PermissionGate need="edit">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setChannelDialogOpen(true)}
                className="font-mono text-[11px] text-text-muted px-[10px] py-[5px] border border-border rounded-[5px] bg-bg-elev hover:text-text transition-colors"
              >
                + Add channel
              </button>
              <button
                type="button"
                onClick={openCreateAlert}
                className="font-mono text-[11px] text-bg px-[10px] py-[5px] rounded-[5px] bg-text font-medium hover:opacity-90 transition-opacity"
              >
                + New alert
              </button>
            </div>
          </PermissionGate>
        }
      />

      {/* Stat strip */}
      <div className="grid grid-cols-5 border-b border-border shrink-0">
        {[
          { label: 'Firing now',    value: String(firing.length),                              warn: firing.length > 0 },
          { label: 'Rules active',  value: String(alerts.filter((a) => a.is_active).length),  warn: false },
          { label: 'Fires 24h',     value: String(fires24h),                                  warn: fires24h > 0 },
          { label: 'Rules total',   value: String(alerts.length),                             warn: false },
          { label: 'Channels',      value: String(channels.length),                           warn: false },
        ].map((s, i) => (
          <div key={i} className={cn('px-[18px] py-[14px]', i < 4 && 'border-r border-border')}>
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">{s.label}</div>
            <span className={cn('text-[24px] font-medium leading-none tracking-[-0.6px]', s.warn ? 'text-accent' : 'text-text')}>
              {s.value}
            </span>
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {alertsQuery.isLoading ? (
          <div className="p-6 space-y-2">
            {[1, 2, 3].map((i) => <div key={i} className="h-14 bg-bg-elev rounded animate-pulse" />)}
          </div>
        ) : alerts.length === 0 && channels.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
            <p className="text-[13px]">No alert rules yet.</p>
            <p className="font-mono text-[12px]">Create an alert to get notified about budget, error rate, or latency issues.</p>
            <PermissionGate need="edit">
              <button
                type="button"
                onClick={openCreateAlert}
                className="font-mono text-[11.5px] px-3 py-[5px] mt-1 rounded-[4px] bg-text text-bg font-medium hover:opacity-90 transition-opacity"
              >
                + New alert
              </button>
            </PermissionGate>
          </div>
        ) : (
          <>
            {/* Firing */}
            {firing.length > 0 && (
              <div>
                <div className="flex items-center gap-2.5 px-[22px] py-[10px] bg-accent-bg border-b border-border">
                  <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-accent">
                    Firing · {firing.length}
                  </span>
                </div>
                {firing.map((a, i) => (
                  <AlertRuleRow key={a.id} a={a} fires={alertFires(a.id)} last={i === firing.length - 1}
                    onToggle={() => void updateAlert.mutateAsync({ id: a.id, is_active: !a.is_active })}
                    onEdit={() => openEditAlert(a)}
                    onDelete={() => void deleteAlert.mutateAsync(a.id)}
                    isPending={isPending}
                  />
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
                  <AlertRuleRow key={a.id} a={a} fires={alertFires(a.id)} last={i === active.length - 1}
                    onToggle={() => void updateAlert.mutateAsync({ id: a.id, is_active: !a.is_active })}
                    onEdit={() => openEditAlert(a)}
                    onDelete={() => void deleteAlert.mutateAsync(a.id)}
                    isPending={isPending}
                  />
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
                    <AlertRuleRow key={a.id} a={a} fires={alertFires(a.id)} last={i === paused.length - 1}
                      onToggle={() => void updateAlert.mutateAsync({ id: a.id, is_active: !a.is_active })}
                      onEdit={() => openEditAlert(a)}
                      onDelete={() => void deleteAlert.mutateAsync(a.id)}
                      isPending={isPending}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Notification channels */}
            <div className="px-[22px] py-[18px]">
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-3">
                Notification channels
              </div>
              {channelsQuery.isLoading ? (
                <div className="h-12 bg-bg-elev rounded animate-pulse" />
              ) : channels.length === 0 ? (
                <div className="rounded-[5px] border border-dashed border-border py-5 text-center font-mono text-[12px] text-text-muted">
                  No channels yet — add an email or webhook to receive alerts.
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
                          {ch.kind === 'email' ? <Mail className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
                        </span>
                        <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-text-muted">{ch.kind}</span>
                        <span className="font-mono text-[12px] text-text-faint truncate max-w-xs">{ch.target}</span>
                      </div>
                      <PermissionGate need="edit">
                        <button
                          type="button"
                          onClick={() => void deleteChannel.mutateAsync(ch.id)}
                          disabled={deleteChannel.isPending}
                          className="text-text-faint hover:text-bad transition-colors p-1 disabled:opacity-40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </PermissionGate>
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
                    <div key={d.id} className="flex items-center gap-4 px-[14px] py-2 border-b border-border last:border-0 text-[11.5px]">
                      <span className="font-mono text-text-faint">{new Date(d.created_at).toLocaleString()}</span>
                      <span className={cn('font-mono px-1.5 py-0.5 rounded text-[10px] uppercase tracking-[0.04em]',
                        d.status === 'sent' ? 'bg-good/10 text-good' : 'bg-bad/10 text-bad')}>
                        {d.status}
                      </span>
                      {d.error_message && <span className="text-bad truncate max-w-md">{d.error_message}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Create / Edit alert dialog */}
      <Dialog
        open={alertDialogOpen}
        onOpenChange={(open) => {
          setAlertDialogOpen(open)
          if (!open) setEditingId(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit alert rule' : 'Create alert rule'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <label className="font-mono text-[11px] text-text-muted uppercase tracking-[0.04em]">Name</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="High daily spend"
                className="w-full h-9 px-3 rounded border border-border bg-bg text-[13px] focus:outline-none focus:border-border-strong"
              />
            </div>
            <div className="space-y-2">
              <label className="font-mono text-[11px] text-text-muted uppercase tracking-[0.04em]">
                Type {editingId && <span className="text-text-faint normal-case tracking-normal">· locked (threshold semantics depend on type)</span>}
              </label>
              <Select
                value={newType}
                onValueChange={(v) => setNewType(v as AlertType)}
                disabled={Boolean(editingId)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="budget">Budget (USD)</SelectItem>
                  <SelectItem value="error_rate">Error rate (0–1)</SelectItem>
                  <SelectItem value="latency_p95">p95 latency (ms)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Threshold', value: newThreshold, onChange: setNewThreshold, placeholder: newType === 'budget' ? '10' : newType === 'error_rate' ? '0.05' : '2000' },
                { label: 'Window (min)', value: newWindow, onChange: setNewWindow, placeholder: '60' },
                { label: 'Cooldown (min)', value: newCooldown, onChange: setNewCooldown, placeholder: '60' },
              ].map((f) => (
                <div key={f.label} className="space-y-2">
                  <label className="font-mono text-[11px] text-text-muted uppercase tracking-[0.04em]">{f.label}</label>
                  <input
                    type="number"
                    step="any"
                    value={f.value}
                    onChange={(e) => f.onChange(e.target.value)}
                    placeholder={f.placeholder}
                    className="w-full h-9 px-3 rounded border border-border bg-bg text-[13px] focus:outline-none focus:border-border-strong"
                  />
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void handleSubmitAlert()}
              disabled={
                !newName.trim() ||
                !newThreshold ||
                createAlert.isPending ||
                updateAlert.isPending
              }
              className="w-full py-2 rounded bg-text text-bg font-mono text-[13px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {editingId
                ? (updateAlert.isPending ? 'Saving…' : 'Save changes')
                : (createAlert.isPending ? 'Creating…' : 'Create alert')}
            </button>
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
              <label className="font-mono text-[11px] text-text-muted uppercase tracking-[0.04em]">Kind</label>
              <Select value={newChannelKind} onValueChange={(v) => setNewChannelKind(v as ChannelKind)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email (Resend)</SelectItem>
                  <SelectItem value="slack">Slack webhook</SelectItem>
                  <SelectItem value="discord">Discord webhook</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="font-mono text-[11px] text-text-muted uppercase tracking-[0.04em]">
                {newChannelKind === 'email' ? 'Email address' : 'Webhook URL'}
              </label>
              <input
                value={newChannelTarget}
                onChange={(e) => setNewChannelTarget(e.target.value)}
                placeholder={newChannelKind === 'email' ? 'alerts@yourco.com' : 'https://hooks.slack.com/…'}
                className="w-full h-9 px-3 rounded border border-border bg-bg text-[13px] focus:outline-none focus:border-border-strong"
              />
            </div>
            <button
              type="button"
              onClick={() => void handleCreateChannel()}
              disabled={!newChannelTarget.trim() || createChannel.isPending}
              className="w-full py-2 rounded bg-text text-bg font-mono text-[13px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {createChannel.isPending ? 'Adding…' : 'Add channel'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
