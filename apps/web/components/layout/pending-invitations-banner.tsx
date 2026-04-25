'use client'
import { useState } from 'react'
import { X } from 'lucide-react'

import {
  useAcceptPendingInvitation,
  useDeclinePendingInvitation,
  usePendingInvitations,
  type PendingInvitation,
} from '@/lib/queries/use-pending-invitations'
import { writeWorkspaceCookie } from '@/lib/workspace-cookie'

/**
 * Top-of-dashboard banner that surfaces pending workspace invitations
 * for the signed-in user, regardless of whether they ever clicked the
 * email link. Handles three actions:
 *
 *   • Accept — joins the org, sets `sb-ws` to that org, hard-reloads
 *     so middleware / sidebar re-resolve into the new active workspace.
 *   • Decline — DELETEs the invitation row. Re-invitation is required
 *     for it to ever appear again.
 *   • Dismiss (⨯) — session-only hide. Refreshing brings it back. Use
 *     this when "I see it, just not now". Decline is the permanent
 *     choice.
 *
 * Renders nothing while the query is loading or when there are no
 * pending invites — the banner is a temporary notice, not a layout
 * fixture. Sits on top of the dashboard tree at every nav so we
 * don't need a per-page integration.
 */
export function PendingInvitationsBanner() {
  const pending = usePendingInvitations()
  const accept = useAcceptPendingInvitation()
  const decline = useDeclinePendingInvitation()

  // Session-only dismiss state. Persists per inviteId to avoid a single
  // dismiss hiding a *future* unrelated invite that arrives in the same
  // session.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const items = (pending.data ?? []).filter((inv) => !dismissed.has(inv.id))
  if (items.length === 0) return null

  async function handleAccept(inv: PendingInvitation): Promise<void> {
    try {
      await accept.mutateAsync(inv.id)
      // Switch active workspace to the joined one and reload so
      // middleware re-resolves cookies and the sidebar shows the new
      // workspace as active.
      writeWorkspaceCookie(inv.orgId)
      window.location.reload()
    } catch {
      // Errors bubble up via React Query state — the user will see the
      // invite still there and can retry. Banner stays mounted.
    }
  }

  async function handleDecline(inv: PendingInvitation): Promise<void> {
    try {
      await decline.mutateAsync(inv.id)
    } catch {
      // Network blip — leave the invite visible so the user can retry.
    }
  }

  function handleDismiss(id: string): void {
    setDismissed((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }

  const isBusy = accept.isPending || decline.isPending

  return (
    <div className="border-b border-accent-border bg-accent-bg">
      {items.map((inv) => (
        <div
          key={inv.id}
          className="max-w-screen-2xl mx-auto px-6 py-2.5 flex items-center gap-3"
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-accent shrink-0">
            Invitation
          </span>

          <span className="text-[13px] text-text truncate">
            <span className="font-medium">{inv.orgName}</span>
            <span className="text-text-muted"> invited you as </span>
            <span className="font-mono text-[12px]">{inv.role}</span>
          </span>

          <span className="flex-1" />

          <button
            type="button"
            onClick={() => void handleAccept(inv)}
            disabled={isBusy}
            className="font-mono text-[11.5px] px-3 py-[5px] rounded-[5px] bg-text text-bg font-medium hover:opacity-90 transition-opacity disabled:opacity-40 shrink-0"
          >
            Accept
          </button>

          <button
            type="button"
            onClick={() => void handleDecline(inv)}
            disabled={isBusy}
            className="font-mono text-[11.5px] px-3 py-[5px] rounded-[5px] border border-border-strong text-text-muted hover:text-text transition-colors disabled:opacity-40 shrink-0"
          >
            Decline
          </button>

          <button
            type="button"
            onClick={() => handleDismiss(inv.id)}
            aria-label="Hide for now"
            className="ml-1 p-1 text-text-muted hover:text-text transition-colors shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
