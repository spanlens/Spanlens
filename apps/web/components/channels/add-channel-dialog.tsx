'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCreateChannel } from '@/lib/queries/use-alerts'
import type { ChannelKind } from '@/lib/queries/types'

interface AddChannelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set, the kind picker is hidden and locked to this kind. */
  fixedKind?: ChannelKind
}

const KIND_LABEL: Record<ChannelKind, string> = {
  email: 'Email address',
  slack: 'Slack webhook URL',
  discord: 'Discord webhook URL',
}

const KIND_PLACEHOLDER: Record<ChannelKind, string> = {
  email: 'alerts@yourco.com',
  slack: 'https://hooks.slack.com/…',
  discord: 'https://discord.com/api/webhooks/…',
}

/**
 * Shared "add a notification channel" modal, used by Settings → Integrations
 * (provider cards pass `fixedKind`) and by the Alerts empty-state shortcut.
 * Channels are org-level, so wherever it's opened it writes the same row.
 *
 * Form state resets when the dialog closes (not via useEffect) so the
 * react-hooks/set-state-in-effect rule stays happy and a re-open with a
 * different fixedKind starts clean.
 */
export function AddChannelDialog({ open, onOpenChange, fixedKind }: AddChannelDialogProps) {
  const createChannel = useCreateChannel()
  const [kind, setKind] = useState<ChannelKind>('email')
  const [target, setTarget] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)

  // When fixedKind is provided the picker is hidden and we follow the prop
  // directly — no stale state across re-opens for different providers.
  const effectiveKind = fixedKind ?? kind

  function handleOpenChange(next: boolean) {
    if (!next) {
      setKind('email')
      setTarget('')
      setLabel('')
      setError(null)
    }
    onOpenChange(next)
  }

  async function handleSubmit() {
    if (!target.trim()) return
    setError(null)
    try {
      await createChannel.mutateAsync({
        kind: effectiveKind,
        target: target.trim(),
        ...(label.trim() ? { label: label.trim() } : {}),
      })
      handleOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add channel')
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {fixedKind ? `Add ${fixedKind} channel` : 'Add notification channel'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          {!fixedKind && (
            <div className="space-y-2">
              <label className="font-mono text-[11px] text-text-muted uppercase tracking-[0.04em]">Kind</label>
              <Select value={kind} onValueChange={(v) => setKind(v as ChannelKind)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email (Resend)</SelectItem>
                  <SelectItem value="slack">Slack webhook</SelectItem>
                  <SelectItem value="discord">Discord webhook</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <label className="font-mono text-[11px] text-text-muted uppercase tracking-[0.04em]">
              {KIND_LABEL[effectiveKind]}
            </label>
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={KIND_PLACEHOLDER[effectiveKind]}
              className="w-full h-9 px-3 rounded border border-border bg-bg text-[13px] focus:outline-none focus:border-border-strong"
            />
          </div>

          <div className="space-y-2">
            <label className="font-mono text-[11px] text-text-muted uppercase tracking-[0.04em]">
              Label <span className="text-text-faint normal-case tracking-normal">· optional, e.g. #prod-alerts</span>
            </label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Give this channel a name"
              className="w-full h-9 px-3 rounded border border-border bg-bg text-[13px] focus:outline-none focus:border-border-strong"
            />
          </div>

          {error && <div className="text-[12.5px] text-bad">{error}</div>}

          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!target.trim() || createChannel.isPending}
            className="w-full py-2 rounded bg-text text-bg font-mono text-[13px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {createChannel.isPending ? 'Adding…' : 'Add channel'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
