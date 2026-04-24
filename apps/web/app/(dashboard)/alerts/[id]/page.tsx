'use client'
import { useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Trash2 } from 'lucide-react'
import {
  useAlerts,
  useDeleteAlert,
  useUpdateAlert,
  useAlertDeliveries,
  useNotificationChannels,
} from '@/lib/queries/use-alerts'
import type { AlertRow, AlertType } from '@/lib/queries/types'
import { Topbar } from '@/components/layout/topbar'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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

export default function AlertDetailPage() {
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

  const deliveries = useMemo(
    () => (deliveriesQuery.data ?? []).filter((d) => d.alert_id === id),
    [deliveriesQuery.data, id],
  )

  const channelById = useMemo(() => {
    const m = new Map<string, { kind: string; target: string }>()
    for (const c of channelsQuery.data ?? []) m.set(c.id, { kind: c.kind, target: c.target })
    return m
  }, [channelsQuery.data])

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
      <div className="-m-7 flex flex-col h-screen overflow-hidden bg-bg">
        <Topbar crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Alerts', href: '/alerts' }, { label: '…' }]} />
        <div className="p-6 space-y-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    )
  }

  if (!alert) {
    return (
      <div className="-m-7 flex flex-col h-screen overflow-hidden bg-bg">
        <Topbar crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Alerts', href: '/alerts' }, { label: 'Not found' }]} />
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-text-muted">
          <p className="text-[13px]">Alert rule not found.</p>
          <Link href="/alerts" className="font-mono text-[12px] text-accent hover:opacity-80 transition-opacity">
            ← Back to all alerts
          </Link>
        </div>
      </div>
    )
  }

  const firing = alert.is_active && isRecentlyFired(alert.last_triggered_at)
  const fires24h = deliveries.filter(
    (d) => Date.now() - new Date(d.created_at).getTime() < 24 * 60 * 60 * 1000,
  ).length
  const sent = deliveries.filter((d) => d.status === 'sent').length
  const failed = deliveries.filter((d) => d.status === 'failed').length

  return (
    <div className="-m-7 flex flex-col h-screen overflow-hidden bg-bg">
      <Topbar
        crumbs={[
          { label: 'Workspace', href: '/dashboard' },
          { label: 'Alerts', href: '/alerts' },
          { label: alert.name },
        ]}
        right={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openEdit}
              className="font-mono text-[11px] text-text-muted px-[10px] py-[5px] border border-border rounded-[5px] bg-bg-elev hover:text-text transition-colors"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => void handleToggle()}
              disabled={updateAlert.isPending}
              className="font-mono text-[11px] text-text-muted px-[10px] py-[5px] border border-border rounded-[5px] bg-bg-elev hover:text-text transition-colors disabled:opacity-40"
            >
              {alert.is_active ? 'Pause' : 'Resume'}
            </button>
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={deleteAlert.isPending}
              className="p-2 text-text-faint hover:text-bad transition-colors disabled:opacity-40"
              title="Delete rule"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-auto">
        <div className="px-[22px] py-6 max-w-4xl">
          <Link
            href="/alerts"
            className="inline-flex items-center gap-1 font-mono text-[11px] text-text-muted hover:text-text transition-colors mb-4"
          >
            <ArrowLeft className="h-3 w-3" /> All alerts
          </Link>

          {/* Header — rule state */}
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
            {firing ? 'Firing right now.' : alert.is_active ? 'Active · watching for threshold breach.' : 'Paused · no evaluation.'}
          </p>

          {/* Rule config card */}
          <div className="border border-border rounded-xl bg-bg-elev p-5 mb-5 grid grid-cols-4 gap-4">
            {[
              { label: 'Threshold', value: fmtThreshold(alert.type, alert.threshold) },
              { label: 'Window', value: `${alert.window_minutes} min` },
              { label: 'Cooldown', value: `${alert.cooldown_minutes} min` },
              { label: 'Last fired', value: relTime(alert.last_triggered_at) },
            ].map((s) => (
              <div key={s.label}>
                <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-1.5">{s.label}</div>
                <div className={cn(
                  'font-mono text-[16px] font-medium tracking-[-0.2px]',
                  s.label === 'Last fired' && firing ? 'text-accent' : 'text-text',
                )}>
                  {s.value}
                </div>
              </div>
            ))}
          </div>

          {/* Trigger expression explainer */}
          <div className="border border-border rounded-xl bg-bg-elev px-5 py-4 mb-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">Trigger</div>
            <code className="font-mono text-[13px] text-text">
              {alert.type === 'budget' ? 'sum(cost)' : alert.type === 'error_rate' ? 'error_rate' : 'p95(latency)'}
              {' '}&gt; {fmtThreshold(alert.type, alert.threshold)}
              {' '}for {alert.window_minutes}m
            </code>
            <p className="text-[12px] text-text-muted mt-2 leading-relaxed">
              Evaluated every ~5 minutes by the <code className="font-mono text-text">cron-evaluate-alerts</code> job.
              After firing, re-alerts are suppressed for {alert.cooldown_minutes} minutes.
            </p>
          </div>

          {/* Delivery stats */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              { label: 'Deliveries · 24h', value: String(fires24h), warn: fires24h > 0 },
              { label: 'Sent · lifetime', value: String(sent), warn: false },
              { label: 'Failed · lifetime', value: String(failed), warn: failed > 0 },
            ].map((s) => (
              <div key={s.label} className="border border-border rounded-lg bg-bg-elev p-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">{s.label}</div>
                <div className={cn('text-[22px] font-medium tracking-[-0.3px]', s.warn ? 'text-accent' : 'text-text')}>
                  {s.value}
                </div>
              </div>
            ))}
          </div>

          {/* Delivery history */}
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-3">
              Delivery history
            </div>
            {deliveriesQuery.isLoading ? (
              <div className="h-20 bg-bg-elev rounded animate-pulse" />
            ) : deliveries.length === 0 ? (
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
                      <span className="font-mono text-text-muted">
                        {new Date(d.created_at).toLocaleString()}
                      </span>
                      <span className={cn(
                        'font-mono text-[10px] uppercase tracking-[0.04em] px-1.5 py-0.5 rounded w-fit',
                        d.status === 'sent' ? 'bg-good/10 text-good' : 'bg-bad/10 text-bad',
                      )}>
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

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit alert rule</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <label className="font-mono text-[11px] text-text-muted uppercase tracking-[0.04em]">Name</label>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full h-9 px-3 rounded border border-border bg-bg text-[13px] focus:outline-none focus:border-border-strong"
              />
            </div>
            <div className="space-y-2">
              <label className="font-mono text-[11px] text-text-muted uppercase tracking-[0.04em]">
                Type <span className="text-text-faint normal-case tracking-normal">· locked (threshold semantics depend on type)</span>
              </label>
              <Select value={alert.type} disabled>
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
                { label: 'Threshold', value: editThreshold, onChange: setEditThreshold },
                { label: 'Window (min)', value: editWindow, onChange: setEditWindow },
                { label: 'Cooldown (min)', value: editCooldown, onChange: setEditCooldown },
              ].map((f) => (
                <div key={f.label} className="space-y-2">
                  <label className="font-mono text-[11px] text-text-muted uppercase tracking-[0.04em]">{f.label}</label>
                  <input
                    type="number"
                    step="any"
                    value={f.value}
                    onChange={(e) => f.onChange(e.target.value)}
                    className="w-full h-9 px-3 rounded border border-border bg-bg text-[13px] focus:outline-none focus:border-border-strong"
                  />
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!editName.trim() || !editThreshold || updateAlert.isPending}
              className="w-full py-2 rounded bg-text text-bg font-mono text-[13px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {updateAlert.isPending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
