'use client'
import { useState } from 'react'
import { Plus, Trash2, Bell, Mail, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
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
import type { AlertType, ChannelKind } from '@/lib/queries/types'
import { DocsLink } from '@/components/layout/docs-link'

function formatThreshold(type: AlertType, threshold: number): string {
  if (type === 'budget') return `$${threshold}`
  if (type === 'error_rate') return `${(threshold * 100).toFixed(1)}%`
  return `${threshold}ms`
}

function channelIcon(kind: ChannelKind) {
  if (kind === 'email') return <Mail className="h-4 w-4" />
  return <MessageSquare className="h-4 w-4" />
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

  // Alert dialog state
  const [alertDialogOpen, setAlertDialogOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<AlertType>('budget')
  const [newThreshold, setNewThreshold] = useState('')
  const [newWindow, setNewWindow] = useState('60')
  const [newCooldown, setNewCooldown] = useState('60')

  // Channel dialog state
  const [channelDialogOpen, setChannelDialogOpen] = useState(false)
  const [newChannelKind, setNewChannelKind] = useState<ChannelKind>('email')
  const [newChannelTarget, setNewChannelTarget] = useState('')

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

  const alerts = alertsQuery.data ?? []
  const channels = channelsQuery.data ?? []
  const deliveries = deliveriesQuery.data ?? []

  return (
    <div className="max-w-5xl">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Alerts</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Get notified when spend, error rate, or latency crosses your thresholds
          </p>
        </div>
        <DocsLink href="/docs/features/alerts" />
      </div>

      {/* Alerts section */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">Alert rules</h2>
          <Dialog open={alertDialogOpen} onOpenChange={setAlertDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2">
                <Plus className="h-4 w-4" /> New alert
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create alert</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="High daily spend"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Type</Label>
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
                    <Label>Threshold</Label>
                    <Input
                      type="number"
                      step="any"
                      value={newThreshold}
                      onChange={(e) => setNewThreshold(e.target.value)}
                      placeholder={newType === 'budget' ? '10' : newType === 'error_rate' ? '0.05' : '2000'}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Window (min)</Label>
                    <Input
                      type="number"
                      value={newWindow}
                      onChange={(e) => setNewWindow(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Cooldown (min)</Label>
                    <Input
                      type="number"
                      value={newCooldown}
                      onChange={(e) => setNewCooldown(e.target.value)}
                    />
                  </div>
                </div>
                <Button
                  onClick={() => void handleCreateAlert()}
                  disabled={!newName.trim() || !newThreshold || createAlert.isPending}
                  className="w-full"
                >
                  {createAlert.isPending ? 'Creating…' : 'Create alert'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="rounded-lg border bg-white overflow-hidden">
          {alertsQuery.isLoading ? (
            <div className="p-4"><Skeleton className="h-20 w-full" /></div>
          ) : alerts.length === 0 ? (
            <div className="p-8 text-center">
              <Bell className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                No alerts yet. Create one to get notified about budget, error rate, or latency issues.
              </p>
            </div>
          ) : (
            alerts.map((a) => (
              <div key={a.id} className="flex items-center justify-between px-6 py-4 border-b last:border-0">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{a.name}</span>
                    <Badge variant="outline" className="text-xs uppercase">
                      {a.type}
                    </Badge>
                    {!a.is_active && <Badge variant="secondary">Paused</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Fires when {a.type === 'budget' ? 'spend' : a.type === 'error_rate' ? 'error rate' : 'p95 latency'} {'>'} {formatThreshold(a.type, a.threshold)} over last {a.window_minutes}m · {a.cooldown_minutes}m cooldown
                    {a.last_triggered_at && ` · last fired ${new Date(a.last_triggered_at).toLocaleString()}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void updateAlert.mutateAsync({ id: a.id, is_active: !a.is_active })}
                    disabled={updateAlert.isPending}
                  >
                    {a.is_active ? 'Pause' : 'Resume'}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => void deleteAlert.mutateAsync(a.id)}
                    disabled={deleteAlert.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Channels section */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">Notification channels</h2>
          <Dialog open={channelDialogOpen} onOpenChange={setChannelDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="gap-2">
                <Plus className="h-4 w-4" /> Add channel
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add notification channel</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div className="space-y-2">
                  <Label>Kind</Label>
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
                  <Label>{newChannelKind === 'email' ? 'Email address' : 'Webhook URL'}</Label>
                  <Input
                    value={newChannelTarget}
                    onChange={(e) => setNewChannelTarget(e.target.value)}
                    placeholder={
                      newChannelKind === 'email'
                        ? 'alerts@yourco.com'
                        : newChannelKind === 'slack'
                          ? 'https://hooks.slack.com/services/...'
                          : 'https://discord.com/api/webhooks/...'
                    }
                  />
                </div>
                <Button
                  onClick={() => void handleCreateChannel()}
                  disabled={!newChannelTarget.trim() || createChannel.isPending}
                  className="w-full"
                >
                  {createChannel.isPending ? 'Adding…' : 'Add channel'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="rounded-lg border bg-white overflow-hidden">
          {channelsQuery.isLoading ? (
            <div className="p-4"><Skeleton className="h-16 w-full" /></div>
          ) : channels.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              No channels yet. Add an email or webhook to receive alerts.
            </p>
          ) : (
            channels.map((ch) => (
              <div key={ch.id} className="flex items-center justify-between px-6 py-3 border-b last:border-0">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-muted-foreground">{channelIcon(ch.kind)}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs capitalize">{ch.kind}</Badge>
                    </div>
                    <p className="text-xs font-mono text-muted-foreground truncate max-w-md mt-0.5">
                      {ch.target}
                    </p>
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => void deleteChannel.mutateAsync(ch.id)}
                  disabled={deleteChannel.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Deliveries audit */}
      <section>
        <h2 className="text-base font-semibold mb-4">Recent deliveries</h2>
        <div className="rounded-lg border bg-white overflow-hidden">
          {deliveriesQuery.isLoading ? (
            <div className="p-4"><Skeleton className="h-16 w-full" /></div>
          ) : deliveries.length === 0 ? (
            <p className="px-6 py-6 text-center text-sm text-muted-foreground">
              No deliveries yet.
            </p>
          ) : (
            deliveries.slice(0, 20).map((d) => (
              <div key={d.id} className="flex items-center justify-between px-6 py-2.5 border-b last:border-0 text-xs font-mono">
                <span className="text-muted-foreground">{new Date(d.created_at).toLocaleString()}</span>
                <Badge variant={d.status === 'sent' ? 'success' : 'destructive'}>{d.status}</Badge>
                {d.error_message && (
                  <span className="text-destructive truncate max-w-md ml-2">{d.error_message}</span>
                )}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
