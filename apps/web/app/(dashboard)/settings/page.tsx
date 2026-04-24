'use client'
import { useCallback, useEffect, useState } from 'react'
import { Plus, RotateCcw, Trash2, Check } from 'lucide-react'
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
import { PLANS, PLAN_REQUEST_LIMITS } from '@/lib/billing-plans'
import type { BillingPlan } from '@/lib/queries/types'

// ─── types ───────────────────────────────────────────────────────────────────

type TabId =
  | 'general' | 'members' | 'api-keys' | 'audit-log'
  | 'billing' | 'plan' | 'invoices'
  | 'integrations'
  | 'profile' | 'notifications' | 'preferences'

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
    group: 'Connect',
    items: [
      { id: 'integrations',  label: 'Integrations',  crumbs: [{ label: 'Workspace' }, { label: 'Settings' }, { label: 'Integrations' }] },
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
            />
            <GhostBtn
              disabled={updateOrg.isPending || !name.trim() || name === org?.name}
              onClick={() => org && void updateOrg.mutateAsync({ id: org.id, name })}
            >
              {updateOrg.isPending ? 'Saving…' : 'Save'}
            </GhostBtn>
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
  const { data: user, isLoading } = useCurrentUser()

  return (
    <div className="max-w-[980px]">
      <TabHeader
        title="Members"
        description="Workspace members. Multi-user collaboration is a planned feature."
      />

      <div className="mb-4 border border-accent-border bg-accent-bg rounded-lg px-4 py-3 flex items-center gap-3">
        <span className="w-5 h-5 rounded-full border border-accent text-accent flex items-center justify-center font-mono text-[10px] shrink-0">i</span>
        <div className="flex-1 text-[12.5px] text-text-muted">
          Team features (invites · roles · seat billing) are on the roadmap. Today every workspace has a single owner.
        </div>
      </div>

      <Section title="Owner" className="mb-5">
        {isLoading ? (
          <div className="px-6 py-4 text-[12.5px] text-text-faint">Loading…</div>
        ) : user ? (
          <div className="grid grid-cols-[1.6fr_1.6fr_120px] gap-4 px-6 py-4 items-center">
            <span className="text-[13px] font-medium text-text truncate">{user.email ?? '—'}</span>
            <span className="font-mono text-[11px] text-text-muted truncate">
              joined {new Date(user.created_at).toLocaleDateString()}
            </span>
            <MonoPill variant="accent" dot>owner</MonoPill>
          </div>
        ) : (
          <div className="px-6 py-4 text-[12.5px] text-text-faint">Not signed in.</div>
        )}
      </Section>

      <Section title="Roles & permissions" description="Reference · takes effect once team features ship" className="mb-5">
        <div className="grid grid-cols-4 gap-3 p-6">
          {[
            { r: 'Owner',  p: ['Billing & plan', 'Rotate API keys', 'Delete workspace', 'All admin powers'] },
            { r: 'Admin',  p: ['Manage members', 'Manage integrations', 'Manage projects', 'All member powers'] },
            { r: 'Member', p: ['Read all spans', 'Write prompts & evals', 'Deploy prompt versions', 'Create alerts'] },
            { r: 'Viewer', p: ['Read spans', 'Read prompts', 'Read dashboards', '— no writes'] },
          ].map((x) => (
            <div key={x.r} className="border border-border rounded-lg p-4 bg-bg-elev">
              <div className="text-[13px] font-medium text-text mb-3">{x.r}</div>
              <ul className="space-y-1.5">
                {x.p.map((li) => (
                  <li key={li} className={cn('font-mono text-[10.5px]', li.startsWith('—') ? 'text-text-faint' : 'text-text-muted')}>
                    {li.startsWith('—') ? li : `▸ ${li}`}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}

// ─── API KEYS tab (provider keys + Spanlens keys) ─────────────────────────────

function ApiKeysTab() {
  const keysQuery   = useProviderKeys()
  const createKey   = useCreateProviderKey()
  const revokeKey   = useRevokeProviderKey()
  const rotateKey   = useRotateProviderKey()

  const [addOpen, setAddOpen]       = useState(false)
  const [provider, setProvider]     = useState('openai')
  const [newKey, setNewKey]         = useState('')
  const [keyName, setKeyName]       = useState('')
  const [rotateId, setRotateId]     = useState<string | null>(null)
  const [rotateVal, setRotateVal]   = useState('')

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
          <GhostBtn onClick={() => setAddOpen(true)}><Plus className="h-3.5 w-3.5 mr-1.5" /> Add provider key</GhostBtn>
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
                {key.is_active && (
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
            <NativeInput defaultValue="90" className="w-20 font-mono text-[12.5px]" />
            <span className="font-mono text-[11px] text-text-faint">days</span>
            <Toggle on />
          </div>
        </FormRow>
        <FormRow label="Leaked-key detection" hint="Scan public sources for key prefixes and auto-revoke on match.">
          <Toggle on />
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

      <Section title="Budget alerts" action={<Hint>coming soon</Hint>} className="mb-5">
        <div className="px-6 py-4 text-[13px] text-text-muted">
          Configure budget alerts in the <span className="text-text font-medium">Alerts</span> tab to get notified when spend approaches your quota.
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
                  disabled={update.isPending}
                  onToggle={() => void update.mutateAsync({ allow_overage: !(org?.allow_overage ?? false) })}
                />
              </FormRow>
              <FormRow label="Max overage multiplier" hint="Hard cap = monthly limit × this value. Requests past the cap return 429.">
                <div className="flex items-center gap-2">
                  <NativeInput
                    type="number"
                    min={1}
                    max={100}
                    disabled={!(org?.allow_overage ?? false) || update.isPending}
                    value={multiplierDraft}
                    onChange={(e) => setMultiplierDraft(e.target.value)}
                    className="w-20 font-mono text-[12.5px]"
                  />
                  <span className="font-mono text-[11.5px] text-text-faint">×</span>
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
                </div>
              </FormRow>
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

// ─── INTEGRATIONS tab ─────────────────────────────────────────────────────────

const SUPPORTED_CHANNELS = [
  { name: 'Email',   glyph: '@',  desc: 'SMTP delivery to any address' },
  { name: 'Slack',   glyph: 'SL', desc: 'Incoming webhook URL' },
  { name: 'Discord', glyph: 'DC', desc: 'Incoming webhook URL' },
]

const PLANNED = [
  'PagerDuty · on-call escalation',
  'Microsoft Teams webhook',
  'Amazon S3 span archive',
  'BigQuery / Snowflake / Datadog forwarding',
  'GitHub issue auto-link for anomalies',
]

function IntegrationsTab() {
  return (
    <div className="max-w-[980px]">
      <TabHeader
        title="Integrations"
        description="Notification channels wire into alert rules on the Alerts page."
      />

      <Section title="Supported today" className="mb-5">
        <div className="grid grid-cols-3 gap-3 p-6">
          {SUPPORTED_CHANNELS.map((c) => (
            <div key={c.name} className="border border-border-strong bg-bg-elev rounded-xl p-4 min-h-[110px] flex flex-col gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg border border-border bg-text text-bg flex items-center justify-center font-mono text-[11px] font-bold">
                  {c.glyph}
                </div>
                <span className="text-[13.5px] font-medium text-text">{c.name}</span>
              </div>
              <div className="font-mono text-[11px] text-text-muted flex-1">{c.desc}</div>
            </div>
          ))}
        </div>
        <div className="px-6 pb-4">
          <a href="/alerts" className="font-mono text-[12px] text-accent hover:opacity-80 transition-opacity">
            Configure channels on the Alerts page →
          </a>
        </div>
      </Section>

      <Section title="On the roadmap" description="Vote on what we should build next" className="mb-5">
        <ul className="px-6 py-4 space-y-1.5">
          {PLANNED.map((p) => (
            <li key={p} className="font-mono text-[11.5px] text-text-muted">▸ {p}</li>
          ))}
        </ul>
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

function PreferencesTab() {
  return (
    <div className="max-w-[920px]">
      <TabHeader
        title="Preferences"
        description="Personal UI preferences are not yet persisted — coming with the next revision."
      />

      <Section title="Theme" className="mb-5">
        <div className="px-6 py-4 text-[13px] text-text-muted">
          The dashboard follows your system theme via CSS <code className="font-mono text-[12px] text-text">prefers-color-scheme</code>.
          A manual override toggle is on the roadmap.
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
    case 'integrations':  return <IntegrationsTab />
    case 'profile':       return <ProfileTab />
    case 'notifications': return <NotificationsTab />
    case 'preferences':   return <PreferencesTab />
  }
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [tab, setTab] = useState<TabId>('general')
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
