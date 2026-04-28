'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Plus, RotateCcw, Trash2, Check, Sun, Moon, Monitor, type LucideIcon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { initializePaddle, type Paddle } from '@paddle/paddle-js'
import { cn, formatDate } from '@/lib/utils'
import { Topbar } from '@/components/layout/topbar'
import { Section, FormRow, PrimaryBtn, GhostBtn } from '@/components/ui/primitives'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  useOrganization,
  useUpdateOrganization,
  useUpdateOverageSettings,
} from '@/lib/queries/use-organization'
import {
  useCreateProviderKey,
  useProviderKeys,
  useRevokeProviderKey,
  useRotateProviderKey,
} from '@/lib/queries/use-provider-keys'
import {
  useSubscription,
  useCreateCheckout,
  useRefreshSubscription,
  useQuota,
} from '@/lib/queries/use-billing'
import { QuotaBanner } from '@/components/dashboard/quota-banner'
import { useAuditLogs } from '@/lib/queries/use-audit-logs'
import { useCurrentUser } from '@/lib/queries/use-current-user'
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
import { PLANS, PLAN_REQUEST_LIMITS } from '@/lib/billing-plans'
import type { BillingPlan } from '@/lib/queries/types'
import {
  useWebhooks,
  useCreateWebhook,
  useUpdateWebhook,
  useDeleteWebhook,
  useTestWebhook,
  useWebhookDeliveries,
} from '@/lib/queries/use-webhooks'
import type { WebhookEvent, WebhookRow } from '@/lib/queries/types'
import { useNotificationChannels } from '@/lib/queries/use-alerts'

// ─── types ───────────────────────────────────────────────────────────────────

type TabId =
  | 'general' | 'members' | 'api-keys' | 'audit-log'
  | 'billing' | 'plan' | 'invoices'
  | 'profile' | 'notifications' | 'preferences'
  | 'integrations' | 'destinations' | 'webhooks' | 'opentelemetry'

interface NavItem { id: TabId; label: string; crumbs: { label: string }[] }

// ─── nav definition ───────────────────────────────────────────────────────────

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Workspace',
    items: [
      { id: 'general',    label: 'General',    crumbs: [{ label: 'Workspace' }, { label: 'Settings' }, { label: 'General' }] },
      { id: 'members',    label: 'Members',    crumbs: [{ label: 'Workspace' }, { label: 'Settings' }, { label: 'Members' }] },
      { id: 'api-keys',   label: 'Provider keys', crumbs: [{ label: 'Workspace' }, { label: 'Settings' }, { label: 'Provider keys' }] },
      { id: 'audit-log',  label: 'Audit log',  crumbs: [{ label: 'Workspace' }, { label: 'Settings' }, { label: 'Audit log' }] },
    ],
  },
  {
    group: 'Usage',
    items: [
      { id: 'billing',  label: 'Billing',      crumbs: [{ label: 'Workspace' }, { label: 'Settings' }, { label: 'Billing' }] },
      { id: 'plan',     label: 'Plan & limits', crumbs: [{ label: 'Workspace' }, { label: 'Settings' }, { label: 'Plan & limits' }] },
      { id: 'invoices', label: 'Invoices',      crumbs: [{ label: 'Workspace' }, { label: 'Settings' }, { label: 'Invoices' }] },
    ],
  },
  {
    group: 'Account',
    items: [
      { id: 'profile',       label: 'Profile',       crumbs: [{ label: 'Account' }, { label: 'Profile' }] },
      { id: 'notifications', label: 'Notifications', crumbs: [{ label: 'Account' }, { label: 'Notifications' }] },
      { id: 'preferences',   label: 'Preferences',   crumbs: [{ label: 'Account' }, { label: 'Preferences' }] },
    ],
  },
  {
    group: 'Connect',
    items: [
      { id: 'integrations',  label: 'Integrations',  crumbs: [{ label: 'Connect' }, { label: 'Integrations' }] },
      // DESTINATIONS_HIDDEN: uncomment when BigQuery/S3/Snowflake connectors are implemented
      // { id: 'destinations',  label: 'Destinations',  crumbs: [{ label: 'Connect' }, { label: 'Destinations' }] },
      { id: 'webhooks',      label: 'Webhooks',       crumbs: [{ label: 'Connect' }, { label: 'Webhooks' }] },
      { id: 'opentelemetry', label: 'OpenTelemetry',  crumbs: [{ label: 'Connect' }, { label: 'OpenTelemetry' }] },
    ],
  },
]

const ALL_ITEMS = NAV.flatMap((g) => g.items)

function NativeInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props
  return (
    <input
      {...rest}
      className={cn(
        'h-9 px-3 rounded-[6px] border border-border bg-bg text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors',
        className,
      )}
    />
  )
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function Toggle({ on, disabled, onToggle }: { on: boolean; disabled?: boolean; onToggle?: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
        on ? 'bg-text' : 'bg-border-strong',
        disabled && 'opacity-50 cursor-not-allowed',
        !disabled && 'cursor-pointer',
      )}
    >
      <span
        className={cn(
          'inline-block h-3.5 w-3.5 rounded-full bg-bg transition-transform',
          on ? 'translate-x-[18px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  )
}

function MonoPill({
  children,
  dot,
  variant = 'neutral',
}: {
  children: React.ReactNode
  dot?: boolean
  variant?: 'neutral' | 'accent' | 'good' | 'faint'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full border font-mono text-[10px] uppercase tracking-[0.04em]',
        variant === 'neutral' && 'border-border bg-bg-elev text-text-muted',
        variant === 'accent'  && 'border-accent-border bg-accent-bg text-accent',
        variant === 'good'    && 'border-good/20 bg-good-bg text-good',
        variant === 'faint'   && 'border-border bg-transparent text-text-faint',
      )}
    >
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full', variant === 'accent' ? 'bg-accent' : variant === 'good' ? 'bg-good' : 'bg-text-faint')} />}
      {children}
    </span>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[10.5px] text-text-faint tracking-[0.03em]">{children}</span>
}

function TabHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between mb-6">
      <div>
        <h1 className="text-[26px] font-medium tracking-[-0.6px] mb-1">{title}</h1>
        <p className="text-[13px] text-text-muted">{description}</p>
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  )
}

// ─── GENERAL tab ─────────────────────────────────────────────────────────────

function GeneralTab() {
  const { data: org } = useOrganization()
  const updateOrg = useUpdateOrganization()
  const [name, setName] = useState(org?.name ?? '')
  const currentMember = useCurrentMember()
  const isAdmin = currentMember?.role === 'admin'

  return (
    <div className="max-w-[920px]">
      <TabHeader
        title="General"
        description="Workspace identity, storage region, and retention."
      />

      <Section title="Identity" description="Visible within your workspace" className="mb-5">
        <FormRow label="Workspace name" hint="Shown in the app header and on shared traces.">
          <div className="flex items-center gap-3 w-full max-w-[460px]">
            <NativeInput
              value={name || (org?.name ?? '')}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 font-mono text-[12.5px]"
              disabled={!isAdmin}
            />
            {isAdmin && (
              <GhostBtn
                disabled={updateOrg.isPending || !name.trim() || name === org?.name}
                onClick={() => org && void updateOrg.mutateAsync({ id: org.id, name })}
              >
                {updateOrg.isPending ? 'Saving…' : 'Save'}
              </GhostBtn>
            )}
          </div>
        </FormRow>
        <FormRow label="Plan">
          <MonoPill variant={org?.plan === 'enterprise' ? 'good' : 'accent'} dot>
            {org?.plan ?? '—'}
          </MonoPill>
        </FormRow>
      </Section>

      <Section title="Data retention" description="Log retention is determined by your plan" className="mb-5">
        <FormRow label="Current retention">
          <div className="font-mono text-[12.5px] text-text-muted">
            {org?.plan === 'team' ? '90 days'
              : org?.plan === 'starter' ? '30 days'
              : org?.plan === 'enterprise' ? '1 year'
              : '7 days'}
            <span className="ml-2 text-text-faint">· {org?.plan ?? 'free'} plan</span>
          </div>
        </FormRow>
        <FormRow label="Timestamps" hint="All timestamps in the UI use your browser's local timezone.">
          <div className="font-mono text-[12.5px] text-text-muted">
            {Intl.DateTimeFormat().resolvedOptions().timeZone}
          </div>
        </FormRow>
      </Section>

      <Section title="Delete workspace" description="Contact support to delete your workspace" className="mb-5">
        <div className="px-6 py-4 text-[13px] text-text-muted leading-relaxed">
          Workspace deletion requires verification and isn&apos;t available in the self-service UI yet.
          Email <span className="font-mono text-text">support@spanlens.io</span> from the owner address
          and we&apos;ll purge data and cancel billing within one business day.
        </div>
      </Section>
    </div>
  )
}

// ─── MEMBERS tab ─────────────────────────────────────────────────────────────

function MembersTab() {
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
        {members.isLoading ? (
          <div className="px-6 py-4 text-[12.5px] text-text-faint">Loading…</div>
        ) : (members.data ?? []).length === 0 ? (
          <div className="px-6 py-4 text-[12.5px] text-text-faint">No members yet.</div>
        ) : (
          <div className="divide-y divide-border">
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
                    joined {new Date(m.createdAt).toLocaleDateString()}
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
        )}
      </Section>

      {(invitations.data ?? []).length > 0 && (
        <Section title="Pending invitations" className="mb-5">
          <div className="divide-y divide-border">
            {(invitations.data ?? []).map((inv) => {
              const expires = new Date(inv.expires_at)
              const daysLeft = Math.max(0, Math.ceil((expires.getTime() - Date.now()) / 86_400_000))
              return (
                <div
                  key={inv.id}
                  className="grid grid-cols-[1.6fr_1fr_130px_100px] gap-4 px-6 py-3 items-center"
                >
                  <span className="text-[13px] text-text truncate">{inv.email}</span>
                  <span className="font-mono text-[11px] text-text-muted">
                    expires in {daysLeft}d
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
        </Section>
      )}

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite member</DialogTitle>
          </DialogHeader>
          {/* Stacked layout (label above input). The settings page's
              <FormRow> uses a 260px label column + px-6 — that overflows the
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
                  <SelectItem value="admin">Admin — manage everything</SelectItem>
                  <SelectItem value="editor">Editor — create/modify data</SelectItem>
                  <SelectItem value="viewer">Viewer — read-only</SelectItem>
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

// ─── API KEYS tab (provider keys + Spanlens keys) ─────────────────────────────

function ApiKeysTab() {
  const keysQuery   = useProviderKeys()
  const createKey   = useCreateProviderKey()
  const revokeKey   = useRevokeProviderKey()
  const rotateKey   = useRotateProviderKey()
  const currentMember = useCurrentMember()
  const canEdit = currentMember?.role === 'admin' || currentMember?.role === 'editor'

  const [addOpen, setAddOpen]       = useState(false)
  const [provider, setProvider]     = useState('openai')
  const [newKey, setNewKey]         = useState('')
  const [keyName, setKeyName]       = useState('')
  const [rotateId, setRotateId]     = useState<string | null>(null)
  const [rotateVal, setRotateVal]   = useState('')
  const [autoExpireEnabled, setAutoExpireEnabled] = useState(true)
  const [autoExpireDays, setAutoExpireDays]       = useState('90')
  const [leakDetectionEnabled, setLeakDetectionEnabled] = useState(true)

  async function handleAdd() {
    await createKey.mutateAsync({ provider, key: newKey, name: keyName || `${provider} key` })
    setNewKey(''); setKeyName(''); setAddOpen(false)
  }

  async function handleRotate() {
    if (!rotateId || !rotateVal.trim()) return
    await rotateKey.mutateAsync({ id: rotateId, key: rotateVal })
    setRotateId(null); setRotateVal('')
  }

  // Org-level default keys only. Per-project overrides live on the Projects page.
  const keys = (keysQuery.data ?? []).filter((k) => k.project_id === null)

  return (
    <div className="max-w-[980px]">
      <TabHeader
        title="Provider keys"
        description="Default OpenAI / Anthropic / Gemini keys for this workspace. Projects can override individually from the Projects page."
        action={
          canEdit ? (
            <GhostBtn onClick={() => setAddOpen(true)}><Plus className="h-3.5 w-3.5 mr-1.5" /> Add provider key</GhostBtn>
          ) : null
        }
      />

      <div className="mb-4 border border-accent-border bg-accent-bg rounded-lg px-4 py-3 flex items-center gap-3">
        <span className="w-5 h-5 rounded-full border border-accent text-accent flex items-center justify-center font-mono text-[10px] shrink-0">!</span>
        <div className="flex-1 text-[12.5px] text-text-muted">
          Keys are encrypted at rest (AES-256-GCM). Used as fallback when a project has no override.
        </div>
      </div>

      <Section
        title="Default provider keys"
        action={<Hint>{keys.filter((k) => k.is_active).length} active</Hint>}
        className="mb-5"
      >
        {keys.length === 0 ? (
          <div className="px-6 py-8 text-center font-mono text-[12.5px] text-text-faint">
            No provider keys yet. Add one to start proxying.
          </div>
        ) : (
          <div className="divide-y divide-border">
            <div className="grid grid-cols-[1.8fr_140px_140px_130px_80px] gap-4 px-6 py-3 font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
              {['Name', 'Provider', 'Added', 'Status', ''].map((h, i) => <span key={i}>{h}</span>)}
            </div>
            {keys.map((key) => (
              <div key={key.id} className="grid grid-cols-[1.8fr_140px_140px_130px_80px] gap-4 px-6 py-3 items-center">
                <span className={cn('text-[13px] font-medium', !key.is_active && 'line-through text-text-faint')}>
                  {key.name}
                </span>
                <MonoPill variant="neutral" dot>{key.provider}</MonoPill>
                <span className="font-mono text-[11px] text-text-muted">
                  {new Date(key.created_at).toLocaleDateString()}
                </span>
                <MonoPill variant={key.is_active ? 'good' : 'faint'} dot>
                  {key.is_active ? 'active' : 'revoked'}
                </MonoPill>
                {key.is_active && canEdit && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      title="Rotate"
                      onClick={() => setRotateId(key.id)}
                      className="p-1.5 rounded hover:bg-bg-muted text-text-faint hover:text-text transition-colors"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Revoke"
                      disabled={revokeKey.isPending}
                      onClick={() => void revokeKey.mutateAsync(key.id)}
                      className="p-1.5 rounded hover:bg-accent-bg text-text-faint hover:text-accent transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Security" description="Applies to all keys" className="mb-5">
        <FormRow label="Auto-expire stale keys" hint="A key idle this long is revoked automatically.">
          <div className="flex items-center gap-3">
            <NativeInput
              value={autoExpireDays}
              onChange={(e) => setAutoExpireDays(e.target.value)}
              disabled={!autoExpireEnabled}
              className="w-20 font-mono text-[12.5px]"
            />
            <span className="font-mono text-[11px] text-text-faint">days</span>
            <Toggle on={autoExpireEnabled} onToggle={() => setAutoExpireEnabled((v) => !v)} />
          </div>
        </FormRow>
        <FormRow label="Leaked-key detection" hint="Scan public sources for key prefixes and auto-revoke on match.">
          <Toggle on={leakDetectionEnabled} onToggle={() => setLeakDetectionEnabled((v) => !v)} />
        </FormRow>
      </Section>

      {/* Add key dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add provider key</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <label className="text-[12.5px] text-text-muted font-medium">Provider</label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="gemini">Gemini</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[12.5px] text-text-muted font-medium">API key</label>
              <NativeInput type="password" value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="sk-..." />
            </div>
            <div className="space-y-1.5">
              <label className="text-[12.5px] text-text-muted font-medium">Name (optional)</label>
              <NativeInput value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder={`${provider} production key`} />
            </div>
            <PrimaryBtn onClick={() => void handleAdd()} disabled={!newKey.trim() || createKey.isPending}>
              {createKey.isPending ? 'Saving…' : 'Save key'}
            </PrimaryBtn>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rotate dialog */}
      <Dialog open={rotateId !== null} onOpenChange={(o) => !o && setRotateId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rotate provider key</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <p className="text-[13px] text-text-muted">Enter the new API key to replace the current one.</p>
            <NativeInput type="password" value={rotateVal} onChange={(e) => setRotateVal(e.target.value)} placeholder="New API key" />
            <PrimaryBtn onClick={() => void handleRotate()} disabled={!rotateVal.trim() || rotateKey.isPending}>
              {rotateKey.isPending ? 'Rotating…' : 'Rotate key'}
            </PrimaryBtn>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── AUDIT LOG tab ────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

/**
 * Severity inferred from the action string. High = destructive / billing /
 * auth-critical. Medium = creation / modification. Low = the rest.
 */
function inferSeverity(action: string): 'high' | 'med' | 'low' {
  if (/\.(delete|revoke|rotate)$|billing\.|workspace\.|member\.remove/.test(action)) return 'high'
  if (/\.(create|add|update|change|invite)$/.test(action)) return 'med'
  return 'low'
}

function AuditLogTab() {
  const { data, isLoading } = useAuditLogs({ limit: 100 })
  const events = data ?? []

  const bySev = {
    high: events.filter((e) => inferSeverity(e.action) === 'high').length,
    med:  events.filter((e) => inferSeverity(e.action) === 'med').length,
    low:  events.filter((e) => inferSeverity(e.action) === 'low').length,
  }

  return (
    <div className="max-w-[980px]">
      <TabHeader
        title="Audit log"
        description="Every state change in the workspace. Immutable · service-role writes only."
      />

      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { k: 'HIGH', n: bySev.high, sub: 'billing · auth · destructive', accent: true },
          { k: 'MED',  n: bySev.med,  sub: 'create · update · invite',     accent: false },
          { k: 'LOW',  n: bySev.low,  sub: 'other events',                 accent: false },
        ].map((s) => (
          <div key={s.k} className={cn('border rounded-lg p-3', s.accent ? 'border-accent-border bg-accent-bg' : 'border-border bg-bg-elev')}>
            <div className="flex items-baseline justify-between">
              <span className={cn('font-mono text-[10px] tracking-[0.05em]', s.accent ? 'text-accent' : 'text-text-faint')}>{s.k}</span>
              <span className="font-mono text-[22px] font-medium text-text">{s.n}</span>
            </div>
            <div className="font-mono text-[10.5px] text-text-muted mt-1">{s.sub}</div>
          </div>
        ))}
      </div>

      <Section title="Events" action={<Hint>Newest first · last 100</Hint>} className="mb-5">
        {isLoading ? (
          <div className="px-6 py-8 text-center font-mono text-[12.5px] text-text-faint">Loading…</div>
        ) : events.length === 0 ? (
          <div className="px-6 py-8 text-center font-mono text-[12.5px] text-text-faint">
            No audit events yet.
          </div>
        ) : (
          <div className="divide-y divide-border">
            <div className="grid grid-cols-[100px_60px_180px_1fr] gap-4 px-6 py-3 font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
              <span>Time</span>
              <span>Sev</span>
              <span>Action</span>
              <span>Resource</span>
            </div>
            {events.map((e) => {
              const sev = inferSeverity(e.action)
              return (
                <div key={e.id} className="grid grid-cols-[100px_60px_180px_1fr] gap-4 px-6 py-3 items-center">
                  <span className="font-mono text-[11.5px] text-text-muted">{formatTime(e.created_at)}</span>
                  <span className={cn('font-mono text-[9px] uppercase tracking-[0.04em]', sev === 'high' ? 'text-accent' : sev === 'med' ? 'text-text' : 'text-text-faint')}>
                    ● {sev}
                  </span>
                  <span className={cn('font-mono text-[11.5px] font-medium', sev === 'high' ? 'text-accent' : 'text-text')}>{e.action}</span>
                  <span className="font-mono text-[11.5px] text-text-muted truncate">
                    {e.resource_type}{e.resource_id ? ` · ${e.resource_id.slice(0, 12)}` : ''}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </Section>
    </div>
  )
}

// ─── BILLING tab ──────────────────────────────────────────────────────────────

function BillingTab() {
  const { data: subscription, isLoading } = useSubscription()
  const { data: quota } = useQuota()

  const planName = subscription?.plan ?? 'free'
  const planLabel = planName.charAt(0).toUpperCase() + planName.slice(1)

  const usedThisMonth = quota?.usedThisMonth ?? 0
  const limit = quota?.limit ?? 10_000
  const pct = limit > 0 ? Math.min(1, usedThisMonth / limit) : 0

  return (
    <div className="max-w-[920px]">
      <TabHeader title="Billing" description="Per-request pricing. What ingests this month is what you pay." />

      <QuotaBanner />

      {/* Hero card */}
      <div className="border border-border rounded-xl bg-bg-elev p-6 grid grid-cols-2 gap-8 mb-5">
        <div>
          <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] mb-3">Current plan</div>
          {isLoading ? (
            <div className="h-8 w-32 bg-bg-muted rounded animate-pulse mb-4" />
          ) : (
            <>
              <div className="flex items-center gap-3 mb-1">
                <span className="text-[30px] font-medium tracking-[-0.6px]">{planLabel}</span>
                <span className={cn(
                  'font-mono text-[10px] uppercase tracking-[0.04em] px-2 py-0.5 rounded-full border',
                  subscription?.status === 'active'
                    ? 'bg-good-bg border-good/20 text-good'
                    : subscription?.status === 'past_due'
                      ? 'bg-accent-bg border-accent-border text-accent'
                      : 'bg-bg border-border text-text-muted',
                )}>
                  {subscription?.status ?? 'free'}
                </span>
              </div>
              <div className="text-[12.5px] text-text-muted mb-4">
                {subscription?.current_period_end
                  ? subscription.cancel_at_period_end
                    ? `Access until ${formatDate(subscription.current_period_end)}`
                    : `Renews on ${formatDate(subscription.current_period_end)}`
                  : 'No active subscription'}
              </div>
            </>
          )}
        </div>
        <div>
          <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] mb-3">This cycle</div>
          <div className="h-2.5 bg-bg-muted rounded-full overflow-hidden mb-2">
            <div className="h-full bg-text rounded-full" style={{ width: `${(pct * 100).toFixed(1)}%` }} />
          </div>
          <div className="flex justify-between font-mono text-[11px] text-text-muted">
            <span><span className="text-text">{usedThisMonth.toLocaleString()}</span> / {limit.toLocaleString()} req</span>
            <span>{(pct * 100).toFixed(0)}% used</span>
          </div>
        </div>
      </div>

      <Section title="Payment" className="mb-5">
        <div className="px-6 py-4 text-[13px] text-text-muted leading-relaxed">
          Payments are processed by Paddle. To update your payment method or cancel your subscription, use the link Paddle sent when you subscribed.
        </div>
      </Section>

      <Section title="Budget alerts" className="mb-5">
        <div className="px-6 py-4 text-[13px] text-text-muted">
          Set cost and request thresholds in the{' '}
          <Link href="/alerts" className="text-accent font-medium hover:opacity-80 transition-opacity">
            Alerts →
          </Link>{' '}
          tab to get notified before spend exceeds your quota.
        </div>
      </Section>
    </div>
  )
}

// ─── PLAN & LIMITS tab ────────────────────────────────────────────────────────

function PlanLimitsTab() {
  const { data: org } = useOrganization()
  const { data: subscription, isLoading: subLoading } = useSubscription()
  const { data: quota } = useQuota()
  const createCheckout = useCreateCheckout()
  const refreshSubscription = useRefreshSubscription()
  const update = useUpdateOverageSettings()
  const currentMember = useCurrentMember()
  const isAdmin = currentMember?.role === 'admin'
  const [multiplierDraft, setMultiplierDraft] = useState(String(org?.overage_cap_multiplier ?? 2))
  const [paddle, setPaddle] = useState<Paddle | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)

  const clientToken = process.env['NEXT_PUBLIC_PADDLE_CLIENT_TOKEN']
  const paddleEnv = (process.env['NEXT_PUBLIC_PADDLE_ENVIRONMENT'] ?? 'sandbox') as 'sandbox' | 'production'

  useEffect(() => {
    if (!clientToken) return
    let cancelled = false
    void initializePaddle({
      environment: paddleEnv,
      token: clientToken,
      eventCallback: (event) => {
        if (event.name === 'checkout.completed') {
          setTimeout(() => refreshSubscription(), 1500)
        }
      },
    }).then((instance) => {
      if (!cancelled && instance) setPaddle(instance)
    })
    return () => { cancelled = true }
  }, [clientToken, paddleEnv, refreshSubscription])

  const handleUpgrade = useCallback(async (plan: 'starter' | 'team') => {
    setCheckoutError(null)
    if (!paddle) {
      setCheckoutError('Paddle.js is not ready yet. Please try again in a moment.')
      return
    }
    try {
      const res = await createCheckout.mutateAsync({ plan })
      paddle.Checkout.open({ transactionId: res.transactionId })
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Failed to start checkout')
    }
  }, [paddle, createCheckout])

  const currentPlan: BillingPlan = subscription?.plan ?? 'free'
  const isFree = currentPlan === 'free'
  const isEnterprise = currentPlan === 'enterprise'

  const usedThisMonth = quota?.usedThisMonth ?? 0
  const planLimit = PLAN_REQUEST_LIMITS[currentPlan]
  const limitLabel = planLimit != null ? planLimit.toLocaleString() : 'unlimited'
  const headroom = planLimit != null
    ? `${Math.max(0, Math.round((1 - usedThisMonth / planLimit) * 100))}%`
    : '∞'

  return (
    <div className="max-w-[1040px]">
      <TabHeader title="Plan & limits" description="Compare plans. Hard limits apply per-workspace; can be lifted on Enterprise." />

      {checkoutError && (
        <div className="rounded-lg border border-accent-border bg-accent-bg px-4 py-3 mb-5 text-[13px] text-accent">
          {checkoutError}
        </div>
      )}

      {/* Plan cards */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {PLANS.map((plan) => {
          const isCurrent = currentPlan === plan.id
          const isUpgradeInFlight = createCheckout.isPending && createCheckout.variables?.plan === plan.id
          return (
            <div
              key={plan.id}
              className={cn(
                'border rounded-xl p-4 flex flex-col gap-3 min-h-[280px]',
                isCurrent ? 'border-accent bg-accent-bg' : 'border-border bg-bg-elev',
              )}
            >
              <div className="flex items-start justify-between">
                <span className="text-[15px] font-medium text-text">{plan.name}</span>
                {isCurrent && <MonoPill variant="accent" dot>current</MonoPill>}
              </div>
              <div>
                {plan.priceUsd !== null ? (
                  <div className="flex items-baseline gap-1">
                    <span className="font-mono text-[20px] font-medium tracking-[-0.2px] text-text">${plan.priceUsd}</span>
                    <span className="font-mono text-[10.5px] text-text-muted">/ {plan.pricePeriod}</span>
                  </div>
                ) : (
                  <div className="font-mono text-[20px] font-medium text-text">Custom</div>
                )}
                <div className="font-mono text-[10.5px] text-text-muted mt-1">{plan.description}</div>
              </div>
              <ul className="flex-1 space-y-1.5">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 font-mono text-[10.5px] text-text-muted">
                    <Check className="h-3 w-3 mt-0.5 text-good shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <div>
                {plan.id === 'free' ? (
                  <button type="button" disabled className="w-full h-8 rounded-[6px] border border-border bg-bg text-[12.5px] font-medium text-text-faint cursor-not-allowed">
                    Default
                  </button>
                ) : plan.id === 'enterprise' ? (
                  <GhostBtn className="w-full justify-center" onClick={() => window.open('mailto:sales@spanlens.io', '_blank')}>
                    Contact sales
                  </GhostBtn>
                ) : isCurrent ? (
                  <button type="button" disabled className="w-full h-8 rounded-[6px] border border-border bg-bg text-[12.5px] font-medium text-text-faint cursor-not-allowed">
                    Current plan
                  </button>
                ) : !isAdmin ? (
                  <button type="button" disabled className="w-full h-8 rounded-[6px] border border-border bg-bg text-[12.5px] font-medium text-text-faint cursor-not-allowed" title="Only admins can change the plan">
                    Admin only
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={createCheckout.isPending || !paddle || subLoading}
                    onClick={() => void handleUpgrade(plan.id as 'starter' | 'team')}
                    className="w-full h-8 rounded-[6px] bg-text text-bg text-[12.5px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                  >
                    {isUpgradeInFlight ? 'Opening checkout…' : !paddle ? 'Loading…' : `Upgrade to ${plan.name}`}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <Section title="Hard limits" action={<Hint>{currentPlan} plan</Hint>} className="mb-5">
        <div className="divide-y divide-border">
          <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-4 px-6 py-3 font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
            {['Resource', 'Limit', 'Used now', 'Headroom'].map((h) => <span key={h}>{h}</span>)}
          </div>
          {[
            ['Requests / month', limitLabel, usedThisMonth.toLocaleString(), headroom],
            ['Team seats',       '10',       '—',                            '—'],
            ['API keys',         '25',       '—',                            '—'],
            ['Alert rules',      '100',      '—',                            '—'],
          ].map(([res, lim, used, head]) => (
            <div key={res} className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-4 px-6 py-3">
              <span className="font-mono text-[12px] text-text-muted">{res}</span>
              <span className="font-mono text-[12px] text-text">{lim}</span>
              <span className="font-mono text-[12px] text-text">{used}</span>
              <span className="font-mono text-[12px] text-text">{head}</span>
            </div>
          ))}
        </div>
      </Section>

      {!isEnterprise && (
        <Section title="Overage billing" description="Applies when your monthly quota is reached" className="mb-5">
          {isFree ? (
            <div className="px-6 py-4 text-[13px] text-text-muted">
              Overage is not available on the Free plan. Upgrade to Starter or Team to continue serving requests past your quota.
            </div>
          ) : (
            <>
              <FormRow label="Allow overage charges" hint="When quota is reached, continue serving and bill overage. Off = 429 past the limit.">
                <Toggle
                  on={org?.allow_overage ?? false}
                  disabled={update.isPending || !isAdmin}
                  onToggle={() => void update.mutateAsync({ allow_overage: !(org?.allow_overage ?? false) })}
                />
              </FormRow>
              <FormRow label="Max overage multiplier" hint="Hard cap = monthly limit × this value. Requests past the cap return 429.">
                <div className="flex items-center gap-2">
                  <NativeInput
                    type="number"
                    min={1}
                    max={100}
                    disabled={!(org?.allow_overage ?? false) || update.isPending || !isAdmin}
                    value={multiplierDraft}
                    onChange={(e) => setMultiplierDraft(e.target.value)}
                    className="w-20 font-mono text-[12.5px]"
                  />
                  <span className="font-mono text-[11.5px] text-text-faint">×</span>
                  {isAdmin && (
                    <GhostBtn
                      disabled={
                        !(org?.allow_overage ?? false) ||
                        update.isPending ||
                        Number(multiplierDraft) === (org?.overage_cap_multiplier ?? 2) ||
                        !Number.isInteger(Number(multiplierDraft)) ||
                        Number(multiplierDraft) < 1 ||
                        Number(multiplierDraft) > 100
                      }
                      onClick={() => void update.mutateAsync({ overage_cap_multiplier: Number(multiplierDraft) })}
                    >
                      {update.isPending ? 'Saving…' : 'Save'}
                    </GhostBtn>
                  )}
                </div>
              </FormRow>
              {!isAdmin && (
                <div className="px-6 pb-4 text-[11.5px] text-text-faint">Only admins can change overage settings.</div>
              )}
            </>
          )}
        </Section>
      )}
    </div>
  )
}

// ─── INVOICES tab ─────────────────────────────────────────────────────────────

function InvoicesTab() {
  const { data: subscription } = useSubscription()

  return (
    <div className="max-w-[980px]">
      <TabHeader
        title="Invoices"
        description="Invoices are issued and delivered by Paddle, our payment processor."
      />

      <Section title="Where to find your invoices" className="mb-5">
        <div className="px-6 py-5 space-y-4 text-[13px] text-text-muted leading-relaxed">
          <p>
            Every invoice lands in your inbox from <span className="font-mono text-text">noreply@paddle.com</span> as
            a PDF attachment, usually within minutes of each renewal or top-up charge.
          </p>
          <p>
            To browse past invoices, update your payment method, or cancel, use the self-service link that
            Paddle emailed when you first subscribed. Paddle&apos;s customer portal is the source of truth for
            billing history.
          </p>
          {subscription ? (
            <p className="font-mono text-[11.5px] text-text-faint">
              Current subscription · {subscription.plan} · renews {subscription.current_period_end ? new Date(subscription.current_period_end).toLocaleDateString() : '—'}
            </p>
          ) : (
            <p className="font-mono text-[11.5px] text-text-faint">
              You&apos;re on the free plan — no invoices generated.
            </p>
          )}
        </div>
      </Section>
    </div>
  )
}

// ─── PROFILE tab ──────────────────────────────────────────────────────────────

function ProfileTab() {
  const { data: user, isLoading } = useCurrentUser()
  return (
    <div className="max-w-[920px]">
      <TabHeader
        title="Profile"
        description="Your sign-in identity. Managed by Supabase Auth."
      />

      <Section title="Account" className="mb-5">
        {isLoading ? (
          <div className="px-6 py-4 font-mono text-[12.5px] text-text-faint">Loading…</div>
        ) : user ? (
          <>
            <FormRow label="Email">
              <div className="font-mono text-[12.5px] text-text">{user.email ?? '—'}</div>
            </FormRow>
            <FormRow label="User ID">
              <div className="font-mono text-[11px] text-text-muted truncate">{user.id}</div>
            </FormRow>
            <FormRow label="Account created">
              <div className="font-mono text-[12px] text-text-muted">
                {new Date(user.created_at).toLocaleDateString()}
              </div>
            </FormRow>
          </>
        ) : (
          <div className="px-6 py-4 font-mono text-[12.5px] text-text-faint">Not signed in.</div>
        )}
      </Section>

      <Section title="Change sign-in details" className="mb-5">
        <div className="px-6 py-4 text-[13px] text-text-muted leading-relaxed">
          Email changes, password resets, and two-factor setup go through Supabase&apos;s auth flows.
          Use the <span className="font-mono text-text">&quot;Forgot password?&quot;</span> link on the login
          page to trigger a reset email.
        </div>
      </Section>
    </div>
  )
}

// ─── NOTIFICATIONS tab ────────────────────────────────────────────────────────

function NotificationsTab() {
  return (
    <div className="max-w-[980px]">
      <TabHeader
        title="Notifications"
        description="Alert routing lives on the Alerts page, where each rule is bound to a channel."
      />

      <Section title="How notifications work today" className="mb-5">
        <div className="px-6 py-5 space-y-3 text-[13px] text-text-muted leading-relaxed">
          <p>
            Each alert rule targets one channel (email, Slack, or Discord webhook). Channels are configured
            on the <a href="/alerts" className="text-accent hover:opacity-80 transition-opacity">Alerts page</a>.
          </p>
          <p>
            Personal notification preferences (per-event mute, quiet hours, mobile push) aren&apos;t built yet —
            every rule fires according to the thresholds you set on it.
          </p>
        </div>
      </Section>
    </div>
  )
}

// ─── PREFERENCES tab ──────────────────────────────────────────────────────────

type ThemeOption = 'system' | 'light' | 'dark'

interface ThemeOptionDef {
  value: ThemeOption
  label: string
  Icon: LucideIcon
}

const THEME_OPTIONS: ThemeOptionDef[] = [
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'light',  label: 'Light',  Icon: Sun },
  { value: 'dark',   label: 'Dark',   Icon: Moon },
]

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const current = (theme ?? 'system') as ThemeOption

  return (
    <div className="flex items-center gap-1 rounded-[6px] border border-border bg-bg-muted p-1">
      {THEME_OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => setTheme(value)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-[5px] rounded-[4px] text-[12.5px] transition-colors',
            current === value
              ? 'bg-bg text-text font-medium shadow-sm'
              : 'text-text-muted hover:text-text',
          )}
        >
          <Icon className="h-3.5 w-3.5 shrink-0" />
          {label}
        </button>
      ))}
    </div>
  )
}

function PreferencesTab() {
  return (
    <div className="max-w-[920px]">
      <TabHeader
        title="Preferences"
        description="Personal UI preferences stored in your browser."
      />

      <Section title="Theme" className="mb-5">
        <FormRow label="Color theme" hint="Override your system preference. Stored locally in your browser.">
          <ThemeToggle />
        </FormRow>
      </Section>
    </div>
  )
}

// ─── WEBHOOKS tab ─────────────────────────────────────────────────────────────

const ALL_WEBHOOK_EVENTS: { value: WebhookEvent; label: string }[] = [
  { value: 'request.created',  label: 'request.created'  },
  { value: 'trace.completed',  label: 'trace.completed'  },
  { value: 'alert.triggered',  label: 'alert.triggered'  },
]

function SecretField({ secret }: { secret: string }) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    void navigator.clipboard.writeText(secret).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[11px] text-text-muted bg-bg-muted px-2 py-1 rounded border border-border">
        {revealed ? secret : '•'.repeat(Math.min(secret.length, 32))}
      </span>
      <button
        type="button"
        onClick={() => setRevealed((v) => !v)}
        className="text-[11px] text-text-faint hover:text-text transition-colors"
      >
        {revealed ? 'Hide' : 'Show'}
      </button>
      <button
        type="button"
        onClick={handleCopy}
        className="text-[11px] text-text-faint hover:text-text transition-colors"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  )
}

function DeliveryHistory({ webhookId }: { webhookId: string }) {
  const { data: deliveries, isLoading } = useWebhookDeliveries(webhookId)

  if (isLoading) {
    return <div className="px-6 py-3 font-mono text-[11.5px] text-text-faint">Loading…</div>
  }
  if (!deliveries || deliveries.length === 0) {
    return <div className="px-6 py-3 font-mono text-[11.5px] text-text-faint">No deliveries yet.</div>
  }

  return (
    <div className="divide-y divide-border">
      <div className="grid grid-cols-[140px_80px_80px_1fr] gap-4 px-6 py-2 font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
        <span>Time</span>
        <span>Status</span>
        <span>HTTP</span>
        <span>Error</span>
      </div>
      {deliveries.map((d) => (
        <div key={d.id} className="grid grid-cols-[140px_80px_80px_1fr] gap-4 px-6 py-2 items-center">
          <span className="font-mono text-[11px] text-text-muted">
            {new Date(d.delivered_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
          </span>
          <MonoPill variant={d.status === 'success' ? 'good' : 'faint'} dot>
            {d.status}
          </MonoPill>
          <span className="font-mono text-[11px] text-text-muted">{d.http_status ?? '—'}</span>
          <span className="font-mono text-[11px] text-text-faint truncate">{d.error_message ?? '—'}</span>
        </div>
      ))}
    </div>
  )
}

function WebhooksTab() {
  const { data: webhooks, isLoading } = useWebhooks()
  const createWebhook = useCreateWebhook()
  const updateWebhook = useUpdateWebhook()
  const deleteWebhook = useDeleteWebhook()
  const testWebhook = useTestWebhook()

  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newEvents, setNewEvents] = useState<WebhookEvent[]>(['request.created'])
  const [newActive, setNewActive] = useState(true)
  const [createError, setCreateError] = useState('')

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, string>>({})

  const currentMember = useCurrentMember()
  const canEdit = currentMember?.role === 'admin' || currentMember?.role === 'editor'

  function toggleEvent(ev: WebhookEvent) {
    setNewEvents((prev) =>
      prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev],
    )
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreateError('')
    try {
      await createWebhook.mutateAsync({ name: newName, url: newUrl, events: newEvents, is_active: newActive })
      setCreateOpen(false)
      setNewName('')
      setNewUrl('')
      setNewEvents(['request.created'])
      setNewActive(true)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create webhook')
    }
  }

  async function handleTest(webhook: WebhookRow) {
    try {
      const result = await testWebhook.mutateAsync(webhook.id)
      setTestResult((prev) => ({
        ...prev,
        [webhook.id]: result
          ? `${result.status} · HTTP ${result.http_status ?? '—'} · ${result.duration_ms}ms`
          : 'Sent',
      }))
      setSelectedId(webhook.id)
    } catch (err) {
      setTestResult((prev) => ({
        ...prev,
        [webhook.id]: err instanceof Error ? err.message : 'Test failed',
      }))
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this webhook?')) return
    await deleteWebhook.mutateAsync(id)
    if (selectedId === id) setSelectedId(null)
  }

  return (
    <div className="max-w-[980px]">
      <TabHeader
        title="Webhooks"
        description="Receive real-time HTTP callbacks when events occur in your workspace."
        action={
          canEdit ? (
            <PrimaryBtn onClick={() => { setCreateOpen(true); setCreateError('') }}>
              <Plus className="w-3.5 h-3.5" /> New webhook
            </PrimaryBtn>
          ) : null
        }
      />

      <Section title="Webhook endpoints" className="mb-5">
        {isLoading ? (
          <div className="px-6 py-8 text-center font-mono text-[12.5px] text-text-faint">Loading…</div>
        ) : (webhooks ?? []).length === 0 ? (
          <div className="px-6 py-8 text-center font-mono text-[12.5px] text-text-faint">
            No webhooks yet. Add one to start receiving events.
          </div>
        ) : (
          <div className="divide-y divide-border">
            <div className="grid grid-cols-[1.8fr_1.2fr_1fr_110px_90px] gap-4 px-6 py-3 font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
              {['Name', 'URL', 'Events', 'Status', ''].map((h, i) => <span key={i}>{h}</span>)}
            </div>
            {(webhooks ?? []).map((wh) => (
              <div key={wh.id} className="grid grid-cols-[1.8fr_1.2fr_1fr_110px_90px] gap-4 px-6 py-3 items-center">
                <button
                  type="button"
                  onClick={() => setSelectedId(wh.id === selectedId ? null : wh.id)}
                  className="text-[13px] font-medium text-left hover:text-accent transition-colors truncate"
                >
                  {wh.name}
                </button>
                <span className="font-mono text-[11px] text-text-muted truncate" title={wh.url}>
                  {wh.url}
                </span>
                <div className="flex flex-wrap gap-1">
                  {wh.events.map((ev) => (
                    <MonoPill key={ev} variant="neutral">{ev}</MonoPill>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Toggle
                    on={wh.is_active}
                    disabled={!canEdit || updateWebhook.isPending}
                    onToggle={() => void updateWebhook.mutateAsync({ id: wh.id, is_active: !wh.is_active })}
                  />
                  <MonoPill variant={wh.is_active ? 'good' : 'faint'} dot>
                    {wh.is_active ? 'active' : 'off'}
                  </MonoPill>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      title="Send test event"
                      disabled={testWebhook.isPending}
                      onClick={() => void handleTest(wh)}
                      className="px-2 py-1 rounded text-[11px] border border-border text-text-muted hover:text-text hover:border-border-strong transition-colors disabled:opacity-40"
                    >
                      Test
                    </button>
                    <button
                      type="button"
                      title="Delete"
                      disabled={deleteWebhook.isPending}
                      onClick={() => void handleDelete(wh.id)}
                      className="p-1.5 rounded hover:bg-accent-bg text-text-faint hover:text-accent transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {selectedId && (
        <Section title="Webhook details" className="mb-5">
          {(() => {
            const wh = (webhooks ?? []).find((w) => w.id === selectedId)
            if (!wh) return null
            return (
              <>
                <FormRow label="Signing secret" hint="Used to verify X-Spanlens-Signature on incoming events.">
                  <SecretField secret={wh.secret} />
                </FormRow>
                {testResult[selectedId] && (
                  <FormRow label="Last test result">
                    <span className="font-mono text-[11.5px] text-text-muted">{testResult[selectedId]}</span>
                  </FormRow>
                )}
              </>
            )
          })()}
        </Section>
      )}

      {selectedId && (
        <Section title="Delivery history" action={<Hint>Last 10</Hint>} className="mb-5">
          <DeliveryHistory webhookId={selectedId} />
        </Section>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New webhook</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void handleCreate(e)} className="mt-3 space-y-4">
            <div>
              <label className="block text-[12px] text-text-muted mb-1.5">Name</label>
              <input
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="My webhook"
                className="w-full px-3 py-2 border border-border-strong rounded-[6px] bg-bg text-[13px] outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-[12px] text-text-muted mb-1.5">URL</label>
              <input
                required
                type="url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://example.com/webhook"
                className="w-full px-3 py-2 border border-border-strong rounded-[6px] bg-bg text-[13px] outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-[12px] text-text-muted mb-2">Events</label>
              <div className="space-y-2">
                {ALL_WEBHOOK_EVENTS.map(({ value, label }) => (
                  <label key={value} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newEvents.includes(value)}
                      onChange={() => toggleEvent(value)}
                      className="rounded border-border"
                    />
                    <span className="font-mono text-[12px] text-text-muted">{label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-[12px] text-text-muted">Active</label>
              <Toggle on={newActive} onToggle={() => setNewActive((v) => !v)} />
            </div>
            {createError && <div className="text-[12.5px] text-bad">{createError}</div>}
            <div className="flex gap-2 justify-end pt-1">
              <GhostBtn type="button" onClick={() => setCreateOpen(false)}>Cancel</GhostBtn>
              <PrimaryBtn type="submit" disabled={createWebhook.isPending || newEvents.length === 0}>
                {createWebhook.isPending ? 'Creating…' : 'Create webhook'}
              </PrimaryBtn>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── INTEGRATIONS tab ─────────────────────────────────────────────────────────

function StatusPill({ connected }: { connected: boolean }) {
  return (
    <MonoPill variant={connected ? 'good' : 'neutral'} dot>
      {connected ? 'Connected' : 'Not connected'}
    </MonoPill>
  )
}

function IntegrationsTab() {
  const { data: channels } = useNotificationChannels()
  const hasSlack   = (channels ?? []).some((ch) => ch.kind === 'slack')
  const hasDiscord = (channels ?? []).some((ch) => ch.kind === 'discord')

  const integrations = [
    {
      id: 'slack',
      name: 'Slack',
      description: 'Send alert notifications to a Slack channel via incoming webhook.',
      connected: hasSlack,
    },
    {
      id: 'discord',
      name: 'Discord',
      description: 'Send alert notifications to a Discord channel via incoming webhook.',
      connected: hasDiscord,
    },
    {
      id: 'pagerduty',
      name: 'PagerDuty',
      description: 'Route critical alerts to on-call engineers.',
      coming: true,
    },
    {
      id: 'datadog',
      name: 'Datadog',
      description: 'Forward metrics and traces to your Datadog account.',
      coming: true,
    },
  ] as const

  return (
    <div className="max-w-[980px]">
      <TabHeader
        title="Integrations"
        description="Connect Spanlens with the tools your team already uses."
      />

      <div className="grid grid-cols-2 gap-4">
        {integrations.map((integration) => (
          <div
            key={integration.id}
            className="rounded-[8px] border border-border bg-bg-elev p-5 flex flex-col gap-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[15px] font-medium text-text mb-1">{integration.name}</div>
                <div className="text-[12.5px] text-text-muted leading-relaxed">{integration.description}</div>
              </div>
              {'coming' in integration && integration.coming ? (
                <MonoPill variant="faint">coming soon</MonoPill>
              ) : (
                <StatusPill connected={('connected' in integration) ? integration.connected : false} />
              )}
            </div>
            {'coming' in integration && integration.coming ? null : (
              <div className="mt-auto">
                {('connected' in integration) && integration.connected ? (
                  <GhostBtn
                    className="text-[12px]"
                    onClick={() => { window.location.href = '/alerts' }}
                  >
                    Manage in Alerts
                  </GhostBtn>
                ) : (
                  <GhostBtn
                    className="text-[12px]"
                    onClick={() => { window.location.href = '/alerts' }}
                  >
                    Connect
                  </GhostBtn>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── DESTINATIONS tab ─────────────────────────────────────────────────────────

function DestinationsTab() {
  const destinations = [
    {
      id: 'bigquery',
      name: 'BigQuery',
      description: 'Export requests and traces to a Google BigQuery dataset for custom analytics.',
      placeholder: 'project-id.dataset_id',
      label: 'Dataset ID',
    },
    {
      id: 's3',
      name: 'Amazon S3',
      description: 'Archive raw request logs to an S3 bucket for long-term retention.',
      placeholder: 's3://my-bucket/spanlens-exports/',
      label: 'Bucket URL',
    },
    {
      id: 'snowflake',
      name: 'Snowflake',
      description: 'Sync data to a Snowflake table for your data warehouse pipelines.',
      placeholder: 'account.region.snowflakecomputing.com',
      label: 'Account URL',
    },
  ]

  return (
    <div className="max-w-[980px]">
      <TabHeader
        title="Destinations"
        description="Export data to external data warehouses and storage systems."
      />

      <div className="mb-5 border border-accent-border bg-accent-bg rounded-lg px-4 py-3 flex items-start gap-3">
        <span className="w-5 h-5 rounded-full border border-accent text-accent flex items-center justify-center font-mono text-[10px] shrink-0 mt-0.5">!</span>
        <div className="text-[12.5px] text-text-muted leading-relaxed">
          Data export destinations are in beta. Configuration is saved but actual sync runs once the backend is wired up.
        </div>
      </div>

      <div className="space-y-4">
        {destinations.map((dest) => (
          <Section key={dest.id} title={dest.name} description={dest.description} className="mb-0">
            <div className="px-6 pb-5 space-y-4">
              <div className="flex items-center gap-3 mt-2">
                <MonoPill variant="faint">Beta</MonoPill>
              </div>
              <FormRow label={dest.label}>
                <div className="flex items-center gap-3 w-full max-w-[460px]">
                  <NativeInput
                    placeholder={dest.placeholder}
                    className="flex-1 font-mono text-[12px]"
                  />
                  <GhostBtn>Save configuration</GhostBtn>
                </div>
              </FormRow>
            </div>
          </Section>
        ))}
      </div>
    </div>
  )
}

// ─── OPENTELEMETRY tab ────────────────────────────────────────────────────────

const OTEL_ENDPOINT = 'https://spanlens-server.vercel.app/ingest/traces'

const OTEL_CODE_EXAMPLE = `import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: '${OTEL_ENDPOINT}',
    headers: {
      Authorization: 'Bearer <your-api-key>',
    },
  }),
})

sdk.start()`

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="text-[11px] text-text-faint hover:text-text transition-colors shrink-0"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

function OpenTelemetryTab() {
  const [healthStatus, setHealthStatus] = useState<'idle' | 'ok' | 'error'>('idle')

  async function handleTestConnection() {
    setHealthStatus('idle')
    try {
      const res = await fetch('/health')
      setHealthStatus(res.ok ? 'ok' : 'error')
    } catch {
      setHealthStatus('error')
    }
  }

  return (
    <div className="max-w-[920px]">
      <TabHeader
        title="OpenTelemetry"
        description="Ingest OTLP traces directly from any OpenTelemetry-compatible SDK."
      />

      <Section title="OTLP endpoint" className="mb-5">
        <FormRow label="Endpoint URL" hint="Use this as the OTLP HTTP exporter endpoint.">
          <div className="flex items-center gap-3 w-full max-w-[560px]">
            <div className="flex-1 font-mono text-[12px] text-text bg-bg-muted px-3 py-2 rounded border border-border truncate">
              {OTEL_ENDPOINT}
            </div>
            <CopyButton value={OTEL_ENDPOINT} />
          </div>
        </FormRow>
        <FormRow label="Authentication" hint="Pass your Spanlens API key as a Bearer token.">
          <div className="font-mono text-[12px] text-text-muted">
            <span className="text-text">Authorization:</span> Bearer &lt;your-api-key&gt;
          </div>
        </FormRow>
      </Section>

      <Section title="SDK setup example" className="mb-5">
        <div className="px-6 pb-5">
          <div className="relative">
            <pre className="rounded-[6px] bg-bg-muted border border-border px-4 py-4 font-mono text-[11.5px] text-text-muted overflow-x-auto leading-relaxed whitespace-pre">
              {OTEL_CODE_EXAMPLE}
            </pre>
            <div className="absolute top-3 right-3">
              <CopyButton value={OTEL_CODE_EXAMPLE} />
            </div>
          </div>
        </div>
      </Section>

      <Section title="Connection" className="mb-5">
        <div className="px-6 py-4 flex items-center gap-4">
          <GhostBtn onClick={() => void handleTestConnection()}>
            Test connection
          </GhostBtn>
          {healthStatus === 'ok' && (
            <MonoPill variant="good" dot>Server reachable</MonoPill>
          )}
          {healthStatus === 'error' && (
            <MonoPill variant="faint" dot>Unreachable</MonoPill>
          )}
        </div>
      </Section>
    </div>
  )
}

// ─── tab renderer ─────────────────────────────────────────────────────────────

function TabContent({ tab }: { tab: TabId }) {
  switch (tab) {
    case 'general':       return <GeneralTab />
    case 'members':       return <MembersTab />
    case 'api-keys':      return <ApiKeysTab />
    case 'audit-log':     return <AuditLogTab />
    case 'billing':       return <BillingTab />
    case 'plan':          return <PlanLimitsTab />
    case 'invoices':      return <InvoicesTab />
    case 'profile':       return <ProfileTab />
    case 'notifications': return <NotificationsTab />
    case 'preferences':   return <PreferencesTab />
    case 'integrations':  return <IntegrationsTab />
    case 'destinations':  return <DestinationsTab />
    case 'webhooks':      return <WebhooksTab />
    case 'opentelemetry': return <OpenTelemetryTab />
  }
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const searchParams = useSearchParams()
  const initialTab = (searchParams.get('tab') as TabId | null) ?? 'general'
  const [tab, setTab] = useState<TabId>(
    ALL_ITEMS.some((i) => i.id === initialTab) ? initialTab : 'general',
  )
  const active = ALL_ITEMS.find((i) => i.id === tab) ?? ALL_ITEMS[0]!

  return (
    <div className="-m-7 flex h-screen overflow-hidden">
      {/* Settings inner nav */}
      <aside className="w-[260px] shrink-0 border-r border-border bg-bg-elev overflow-y-auto">
        <div className="px-5 py-4 font-mono text-[10px] text-text-faint uppercase tracking-[0.05em]">Settings</div>
        {NAV.map((group) => (
          <div key={group.group} className="mb-4">
            <div className="px-5 py-1.5 font-mono text-[9.5px] text-text-faint uppercase tracking-[0.05em]">
              {group.group}
            </div>
            {group.items.map((item) => {
              const isActive = item.id === tab
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={cn(
                    'w-full text-left px-5 py-2 text-[13px] transition-colors border-l-2 -ml-px',
                    isActive
                      ? 'border-accent bg-bg text-text font-medium'
                      : 'border-transparent text-text-muted hover:text-text hover:bg-bg/50',
                  )}
                >
                  {item.label}
                </button>
              )
            })}
          </div>
        ))}
      </aside>

      {/* Content area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <Topbar crumbs={active.crumbs} />
        <div className="flex-1 overflow-y-auto bg-bg px-8 py-6">
          <TabContent tab={tab} />
        </div>
      </main>
    </div>
  )
}
