'use client'
import { useState, useSyncExternalStore } from 'react'
import { Plus } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { Section, PrimaryBtn, GhostBtn } from '@/components/ui/primitives'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  useMembers,
  useInvitations,
  useInviteMember,
  useUpdateMemberRole,
  useRemoveMember,
  useCancelInvitation,
  useCurrentMember,
  type OrgRole,
} from '@/lib/queries/use-members'
import { MonoPill, TabHeader } from '../_shared/ui'

// ─── MEMBERS tab ─────────────────────────────────────────────────────────────

export function MembersTab() {
  const members = useMembers()
  const invitations = useInvitations()
  const currentMember = useCurrentMember()
  const inviteMutation = useInviteMember()
  const updateRoleMutation = useUpdateMemberRole()
  const removeMutation = useRemoveMember()
  const cancelInvitation = useCancelInvitation()

  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<OrgRole>('editor')
  // Capture "now" once at mount — drives the invitations expiry countdown.
  const [mountNow] = useState(() => Date.now())
  // Hydration-safe gate so the "expires in Xd" cell doesn't flicker between
  // SSR (no clock) and the first client paint.
  const mounted = useSyncExternalStore(
    (_cb) => () => {},
    () => true,
    () => false,
  )
  const [inviteError, setInviteError] = useState('')
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  const isAdmin = currentMember?.role === 'admin'
  const adminCount = (members.data ?? []).filter((m) => m.role === 'admin').length
  const isLastAdmin = (role: OrgRole) => role === 'admin' && adminCount <= 1

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviteError('')
    setInviteSuccess(null)
    try {
      const result = await inviteMutation.mutateAsync({ email: inviteEmail.trim(), role: inviteRole })
      if (result.devAcceptUrl) {
        setInviteSuccess(`Dev: ${result.devAcceptUrl}`)
      } else {
        setInviteSuccess(`Invitation sent to ${inviteEmail.trim()}`)
      }
      setInviteEmail('')
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Failed to invite')
    }
  }

  async function handleRoleChange(userId: string, newRole: OrgRole) {
    setRowError(null)
    try {
      await updateRoleMutation.mutateAsync({ userId, role: newRole })
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Failed to update role')
    }
  }

  async function handleRemove(userId: string) {
    if (!confirm('Remove this member from the workspace?')) return
    setRowError(null)
    try {
      await removeMutation.mutateAsync(userId)
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Failed to remove')
    }
  }

  async function handleCancel(id: string) {
    if (!confirm('Cancel this pending invitation?')) return
    await cancelInvitation.mutateAsync(id)
  }

  return (
    <div className="max-w-[980px]">
      <TabHeader
        title="Members"
        description="Team members with access to this workspace."
        action={
          isAdmin ? (
            <PrimaryBtn onClick={() => { setInviteOpen(true); setInviteError(''); setInviteSuccess(null) }}>
              <Plus className="w-3.5 h-3.5" /> Invite member
            </PrimaryBtn>
          ) : null
        }
      />

      {rowError && (
        <div className="mb-3 border border-bad/30 bg-bad-bg rounded-lg px-4 py-2.5 text-[12.5px] text-bad">
          {rowError}
        </div>
      )}

      <Section title="Members" className="mb-5">
        {/* Gate on `mounted` so SSR + first paint pick the same branch.
            Without this, SSR renders "No members yet" (no query data) and
            client renders the loaded list, triggering React #418. */}
        {!mounted || members.isLoading ? (
          <div className="px-6 py-4 text-[12.5px] text-text-faint">Loading…</div>
        ) : members.isError ? (
          // Don't fall through to "No members yet" on a load failure — a
          // populated workspace would look empty. Show the error + a retry.
          <div className="px-6 py-4 flex items-center justify-between gap-3 flex-wrap">
            <span className="text-[12.5px] text-bad">Couldn&apos;t load members.</span>
            <button
              type="button"
              onClick={() => void members.refetch()}
              className="font-mono text-[11.5px] px-2.5 py-1 border border-border rounded text-text-muted hover:text-text hover:border-border-strong transition-colors"
            >
              Retry
            </button>
          </div>
        ) : (members.data ?? []).length === 0 ? (
          <div className="px-6 py-4 text-[12.5px] text-text-faint">No members yet.</div>
        ) : (
          <div className="overflow-x-auto">
          <div className="divide-y divide-border min-w-[520px]">
            {(members.data ?? []).map((m) => {
              const isMe = currentMember?.userId === m.userId
              const lockedLastAdmin = isLastAdmin(m.role)
              return (
                <div
                  key={m.userId}
                  className="grid grid-cols-[1.6fr_1fr_130px_100px] gap-4 px-6 py-3 items-center"
                >
                  <span className="text-[13px] font-medium text-text truncate">
                    {m.email} {isMe && <span className="text-text-faint font-normal">(you)</span>}
                  </span>
                  <span className="font-mono text-[11px] text-text-muted truncate">
                    joined {formatDate(m.createdAt)}
                  </span>
                  {isAdmin && !lockedLastAdmin ? (
                    <Select
                      value={m.role}
                      onValueChange={(v) => void handleRoleChange(m.userId, v as OrgRole)}
                    >
                      <SelectTrigger className="h-8 text-[12px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="editor">Editor</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <MonoPill variant={m.role === 'admin' ? 'accent' : 'neutral'} dot>
                      {m.role}
                    </MonoPill>
                  )}
                  {isAdmin && !lockedLastAdmin ? (
                    <button
                      type="button"
                      onClick={() => void handleRemove(m.userId)}
                      className="text-[12px] text-text-muted hover:text-bad transition-colors justify-self-end"
                    >
                      Remove
                    </button>
                  ) : lockedLastAdmin ? (
                    <span className="font-mono text-[10px] text-text-faint justify-self-end" title="Cannot remove the last admin">
                      🔒 last admin
                    </span>
                  ) : (
                    <span />
                  )}
                </div>
              )
            })}
          </div>
          </div>
        )}
      </Section>

      {(invitations.data ?? []).length > 0 && (
        <Section title="Pending invitations" className="mb-5">
          <div className="overflow-x-auto">
          <div className="divide-y divide-border min-w-[520px]">
            {(invitations.data ?? []).map((inv) => {
              const expires = new Date(inv.expires_at)
              const daysLeft = Math.max(0, Math.ceil((expires.getTime() - mountNow) / 86_400_000))
              return (
                <div
                  key={inv.id}
                  className="grid grid-cols-[1.6fr_1fr_130px_100px] gap-4 px-6 py-3 items-center"
                >
                  <span className="text-[13px] text-text truncate">{inv.email}</span>
                  <span className="font-mono text-[11px] text-text-muted">
                    {/* Pre-mount we don't know the user's local clock yet —
                        render a stable placeholder so SSR + first paint agree.
                        The `mountNow` closure recomputes daysLeft on the
                        post-mount render. */}
                    {mounted ? `expires in ${daysLeft}d` : 'expires in …'}
                  </span>
                  <MonoPill variant="neutral" dot>{inv.role}</MonoPill>
                  {isAdmin ? (
                    <button
                      type="button"
                      onClick={() => void handleCancel(inv.id)}
                      className="text-[12px] text-text-muted hover:text-bad transition-colors justify-self-end"
                    >
                      Cancel
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
              )
            })}
          </div>
          </div>
        </Section>
      )}

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite member</DialogTitle>
          </DialogHeader>
          {/* Stacked layout (label above input). The settings page's
              <FormRow> uses a 260px label column + px-6, that overflows the
              ~512px dialog width and pushes the inputs past the right edge. */}
          <form onSubmit={(e) => void submitInvite(e)} className="mt-3 space-y-4">
            <div>
              <label className="block text-[12px] text-text-muted mb-1.5">Email</label>
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@company.com"
                autoFocus
                className="w-full px-3 py-2 border border-border-strong rounded-[6px] bg-bg text-[13px] outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-[12px] text-text-muted mb-1.5">Role</label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as OrgRole)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin, manage everything</SelectItem>
                  <SelectItem value="editor">Editor, create/modify data</SelectItem>
                  <SelectItem value="viewer">Viewer, read-only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {inviteError && <div className="text-[12.5px] text-bad">{inviteError}</div>}
            {inviteSuccess && (
              <div className="text-[12px] text-good break-all">{inviteSuccess}</div>
            )}
            <div className="flex gap-2 justify-end pt-1">
              <GhostBtn type="button" onClick={() => setInviteOpen(false)}>Close</GhostBtn>
              <PrimaryBtn type="submit" disabled={inviteMutation.isPending}>
                {inviteMutation.isPending ? 'Sending…' : 'Send invitation'}
              </PrimaryBtn>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
