'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCreateChannel } from '@/lib/queries/use-alerts'
import type { ChannelKind } from '@/lib/queries/types'
import { cn } from '@/lib/utils'
import { CONTROL } from '@/app/(dashboard)/_board/surfaces'

/* Form fields share the board's 34px control chrome so the modal reads as part
   of the same surface family as the pages that open it. */
const FIELD = 'w-full px-3 text-[12.5px] leading-[18px] text-text placeholder:text-text-faint focus:border-border-strong focus:outline-none'

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
        <div className="mt-2 space-y-4">
          {!fixedKind && (
            <div className="space-y-2">
              <span className="eyebrow block">Kind</span>
              <Select value={kind} onValueChange={(v) => setKind(v as ChannelKind)}>
                <SelectTrigger aria-label="Channel kind"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email (Resend)</SelectItem>
                  <SelectItem value="slack">Slack webhook</SelectItem>
                  <SelectItem value="discord">Discord webhook</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="channel-target" className="eyebrow block">
              {KIND_LABEL[effectiveKind]}
            </label>
            <input
              id="channel-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={KIND_PLACEHOLDER[effectiveKind]}
              className={cn(CONTROL, FIELD)}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="channel-label" className="eyebrow block">
              Label <span className="normal-case tracking-normal">· optional, e.g. #prod-alerts</span>
            </label>
            <input
              id="channel-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Give this channel a name"
              className={cn(CONTROL, FIELD)}
            />
          </div>

          {error && <div className="text-[12.5px] leading-[1.45] text-bad">{error}</div>}

          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!target.trim() || createChannel.isPending}
            className="w-full rounded-full bg-primary py-2 text-[12.5px] font-semibold leading-[18px] text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {createChannel.isPending ? 'Adding…' : 'Add channel'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
