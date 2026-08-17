'use client'
import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { GhostBtn } from '@/components/ui/primitives'
import { useNotificationChannels, useDeleteChannel } from '@/lib/queries/use-alerts'
import type { ChannelKind, NotificationChannelRow } from '@/lib/queries/types'
import { AddChannelDialog } from '@/components/channels/add-channel-dialog'
import { PermissionGate } from '@/components/permission-gate'
import { cn } from '@/lib/utils'
import { MonoPill, TabHeader, PILL_SECONDARY } from '../_shared/ui'

// ─── INTEGRATIONS tab ─────────────────────────────────────────────────────────

interface ChannelProviderDef {
  kind: ChannelKind
  name: string
  description: string
}

const CHANNEL_PROVIDERS: ChannelProviderDef[] = [
  { kind: 'slack',   name: 'Slack',   description: 'Post alerts to Slack via incoming webhook.' },
  { kind: 'discord', name: 'Discord', description: 'Post alerts to Discord via incoming webhook.' },
  { kind: 'email',   name: 'Email',   description: 'Email alerts to one or more addresses.' },
]

const COMING_SOON: { id: string; name: string; description: string }[] = [
  { id: 'pagerduty', name: 'PagerDuty', description: 'Route critical alerts to on-call engineers.' },
  { id: 'datadog',   name: 'Datadog',   description: 'Forward metrics and traces to your Datadog account.' },
]

/** Webhook URLs are partially secret and unreadable — show only a tail. */
function maskTarget(kind: ChannelKind, target: string): string {
  if (kind === 'email') return target
  const tail = target.length > 10 ? target.slice(-10) : target
  return `••••${tail}`
}

function ProviderChannelCard({
  provider,
  channels,
  onAdd,
  onDelete,
  deletingId,
}: {
  provider: ChannelProviderDef
  channels: NotificationChannelRow[]
  onAdd: () => void
  onDelete: (id: string) => void
  deletingId: string | null
}) {
  const mine = channels.filter((ch) => ch.kind === provider.kind)
  return (
    <div className="rounded-card border border-border bg-bg-elev shadow-card p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[13.5px] font-semibold text-text mb-1">{provider.name}</div>
          <div className="text-[11.5px] text-text-muted leading-relaxed">{provider.description}</div>
        </div>
        {mine.length > 0
          ? <MonoPill variant="good" dot>{mine.length} connected</MonoPill>
          : <MonoPill variant="neutral" dot>Not connected</MonoPill>}
      </div>

      {mine.length > 0 && (
        <div className="rounded-md border border-border overflow-hidden">
          {mine.map((ch) => (
            <div
              key={ch.id}
              className="flex items-center gap-3 px-[12px] py-2.5 border-b border-border last:border-0"
            >
              <div className="min-w-0 flex-1">
                {ch.label && (
                  <div className="font-mono text-[12px] text-text truncate">{ch.label}</div>
                )}
                <div className="font-mono text-[11px] text-text-faint truncate">{maskTarget(ch.kind, ch.target)}</div>
              </div>
              <PermissionGate need="edit">
                <button
                  type="button"
                  onClick={() => onDelete(ch.id)}
                  disabled={deletingId === ch.id}
                  title="Remove channel"
                  className="text-text-faint hover:text-bad transition-colors p-1 disabled:opacity-40 shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </PermissionGate>
            </div>
          ))}
        </div>
      )}

      <PermissionGate need="edit">
        <div className="mt-auto">
          <GhostBtn className={cn(PILL_SECONDARY, 'gap-1.5')} onClick={onAdd}>
            <Plus className="w-3.5 h-3.5" /> Add {provider.name} channel
          </GhostBtn>
        </div>
      </PermissionGate>
    </div>
  )
}

export function IntegrationsTab() {
  const { data: channels, isLoading } = useNotificationChannels()
  const deleteChannel = useDeleteChannel()
  const [addKind, setAddKind] = useState<ChannelKind | null>(null)

  const allChannels = channels ?? []

  return (
    <div>
      <TabHeader
        title="Integrations"
        description="Connect Spanlens with the tools your team already uses. Channels here receive every alert you configure on the Alerts page."
      />

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[1, 2].map((i) => <div key={i} className="h-40 bg-bg-muted rounded-card animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {CHANNEL_PROVIDERS.map((provider) => (
            <ProviderChannelCard
              key={provider.kind}
              provider={provider}
              channels={allChannels}
              onAdd={() => setAddKind(provider.kind)}
              onDelete={(id) => void deleteChannel.mutateAsync(id)}
              deletingId={deleteChannel.isPending ? (deleteChannel.variables ?? null) : null}
            />
          ))}

          {COMING_SOON.map((integration) => (
            <div
              key={integration.id}
              className="rounded-card border border-border bg-bg-elev shadow-card p-5 flex flex-col gap-3 opacity-75"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[13.5px] font-semibold text-text mb-1">{integration.name}</div>
                  <div className="text-[11.5px] text-text-muted leading-relaxed">{integration.description}</div>
                </div>
                <MonoPill variant="faint">coming soon</MonoPill>
              </div>
            </div>
          ))}
        </div>
      )}

      <AddChannelDialog
        open={addKind !== null}
        onOpenChange={(open) => { if (!open) setAddKind(null) }}
        {...(addKind ? { fixedKind: addKind } : {})}
      />
    </div>
  )
}
