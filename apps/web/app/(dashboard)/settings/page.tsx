'use client'
import { useCallback, useEffect, useState } from 'react'
import { Plus, RotateCcw, Trash2, Copy, Check } from 'lucide-react'
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
  | 'integrations' | 'destinations' | 'webhooks' | 'opentelemetry'
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
      { id: 'destinations',  label: 'Destinations',  crumbs: [{ label: 'Workspace' }, { label: 'Settings' }, { label: 'Destinations' }] },
      { id: 'webhooks',      label: 'Webhooks',       crumbs: [{ label: 'Workspace' }, { label: 'Settings' }, { label: 'Webhooks' }] },
      { id: 'opentelemetry', label: 'OpenTelemetry',  crumbs: [{ label: 'Workspace' }, { label: 'Settings' }, { label: 'OpenTelemetry' }] },
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

      <Section title="Locale & data" description="Applies to UI and stored spans" className="mb-5">
        <FormRow label="Time zone" hint="All timestamps in the UI are rendered in this zone.">
          <div className="font-mono text-[12.5px] text-text-muted">Asia/Seoul · UTC+9</div>
        </FormRow>
        <FormRow label="Retention window" hint="Spans older than this are evicted to cold archive.">
          <div className="flex items-center gap-2">
            <NativeInput defaultValue="30" className="w-20 font-mono text-[12.5px]" />
            <span className="font-mono text-[11.5px] text-text-faint">days</span>
          </div>
        </FormRow>
      </Section>

      <Section title="Danger zone" description="These actions cannot be undone" danger className="mb-5">
        <div className="divide-y divide-accent-border/50">
          {[
            { label: 'Transfer ownership', sub: 'Hand this workspace to another owner. You remain an admin.', action: 'Transfer →' },
            { label: 'Purge ingested data', sub: 'Drop every span, trace, and prompt version. Cannot be recovered.', action: 'Purge data' },
            { label: 'Delete workspace', sub: 'Permanently delete this workspace. Billing stops at end of cycle.', action: 'Delete workspace' },
          ].map((d) => (
            <div key={d.label} className="flex items-center justify-between px-6 py-4">
              <div>
                <div className="text-[13px] font-medium text-text">{d.label}</div>
                <div className="text-[12px] text-text-muted mt-0.5">{d.sub}</div>
              </div>
              <GhostBtn danger className="shrink-0 ml-6">{d.action}</GhostBtn>
            </div>
          ))}
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

const INTEGRATIONS = [
  { name: 'Slack',       glyph: 'SL', tag: 'notify', note: '#llm-ops · #oncall',           connected: true  },
  { name: 'PagerDuty',   glyph: 'PD', tag: 'notify', note: 'service · llm-platform · P3',  connected: true  },
  { name: 'Email',       glyph: '@',  tag: 'notify', note: '3 recipients',                 connected: true  },
  { name: 'Teams',       glyph: 'MS', tag: 'notify', note: '—',                            connected: false },
  { name: 'Amazon S3',   glyph: 'S3', tag: 'export', note: 's3://acme-lens-archive',       connected: true  },
  { name: 'BigQuery',    glyph: 'BQ', tag: 'export', note: 'acme-warehouse.llm.spans',     connected: true  },
  { name: 'Snowflake',   glyph: 'SF', tag: 'export', note: '—',                            connected: false },
  { name: 'Datadog',     glyph: 'DD', tag: 'export', note: 'span-forward · errors only',   connected: true  },
  { name: 'GitHub',      glyph: 'GH', tag: 'link',   note: 'acme/app · auto-open anomaly', connected: true  },
]

function IntegrationsTab() {
  const connectedCount = INTEGRATIONS.filter((i) => i.connected).length
  return (
    <div className="max-w-[980px]">
      <TabHeader
        title="Integrations"
        description="Send alerts out. Stream spans to your warehouse. Link anomalies to issues."
        action={<Hint>{connectedCount} connected · {INTEGRATIONS.length - connectedCount} available</Hint>}
      />
      <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] mb-3">Notifications</div>
      <div className="grid grid-cols-3 gap-3 mb-6">
        {INTEGRATIONS.filter((i) => i.tag === 'notify').map((it) => (
          <IntCard key={it.name} it={it} />
        ))}
      </div>
      <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] mb-3">Data sinks · warehouses · links</div>
      <div className="grid grid-cols-3 gap-3 mb-5">
        {INTEGRATIONS.filter((i) => i.tag !== 'notify').map((it) => (
          <IntCard key={it.name} it={it} />
        ))}
      </div>
    </div>
  )
}

function IntCard({ it }: { it: (typeof INTEGRATIONS)[number] }) {
  return (
    <div className={cn('border rounded-xl p-4 flex flex-col gap-3 min-h-[120px]', it.connected ? 'border-border-strong bg-bg-elev' : 'border-border bg-bg')}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className={cn('w-8 h-8 rounded-lg border border-border flex items-center justify-center font-mono text-[11px] font-bold', it.connected ? 'bg-text text-bg' : 'bg-bg-muted text-text-muted')}>
            {it.glyph}
          </div>
          <span className="text-[13.5px] font-medium text-text">{it.name}</span>
        </div>
        <MonoPill variant={it.connected ? 'good' : 'faint'} dot>{it.connected ? 'connected' : 'available'}</MonoPill>
      </div>
      <div className="font-mono text-[11px] text-text-muted flex-1">{it.note !== '—' ? it.note : <span className="text-text-faint">no setup yet</span>}</div>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-text-faint uppercase tracking-[0.04em]">{it.tag}</span>
        <span className={cn('font-mono text-[11px]', it.connected ? 'text-text' : 'text-accent')}>{it.connected ? 'Manage →' : 'Connect →'}</span>
      </div>
    </div>
  )
}

// ─── DESTINATIONS tab ─────────────────────────────────────────────────────────

function DestinationsTab() {
  return (
    <div className="max-w-[980px]">
      <TabHeader
        title="Destinations"
        description="Where your data goes when it leaves Spanlens. Destinations stream continuously."
        action={<PrimaryBtn>+ New destination</PrimaryBtn>}
      />
      <Section title="Destinations" className="mb-5">
        <div className="divide-y divide-border">
          {[
            { name: 'Cold archive · S3',   uri: 's3://acme-lens-archive/spans/', filter: 'all spans · after 30d', rate: '3.2 GB / day', active: true  },
            { name: 'Warehouse · BigQuery',uri: 'acme-warehouse.llm.spans',      filter: 'sampled · 10%',         rate: '620 MB / day', active: true  },
            { name: 'SIEM · Datadog',      uri: 'intake.logs.datadoghq.com',     filter: 'errors + audit only',   rate: '84 MB / day',  active: true  },
            { name: 'Research · S3',       uri: 's3://acme-ds-lens-raw/',        filter: 'full spans · debug',    rate: '—',            active: false },
          ].map((d) => (
            <div key={d.name} className="grid grid-cols-[1.6fr_1fr_1fr_120px_40px] gap-4 px-6 py-4 items-center">
              <div>
                <div className={cn('text-[13px] font-medium', !d.active && 'text-text-faint')}>{d.name}</div>
                <div className="font-mono text-[11px] text-text-muted mt-0.5 truncate">{d.uri}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.04em]">filter</div>
                <div className="font-mono text-[11px] text-text-muted mt-1">{d.filter}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.04em]">rate</div>
                <div className={cn('font-mono text-[11px] mt-1', d.active ? 'font-medium text-text' : 'text-text-faint')}>{d.rate}</div>
              </div>
              <MonoPill variant={d.active ? 'good' : 'faint'} dot>{d.active ? 'active' : 'paused'}</MonoPill>
              <button type="button" className="font-mono text-[14px] text-text-faint hover:text-text text-right">⋯</button>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Redaction policy" description="Applied to every destination" className="mb-5">
        <FormRow label="Default PII redaction" hint="Email, phone, credit cards replaced with ⟨redacted⟩.">
          <div className="flex items-center gap-2"><Toggle on /><span className="font-mono text-[11.5px] text-text-muted">on egress only</span></div>
        </FormRow>
      </Section>
    </div>
  )
}

// ─── WEBHOOKS tab ─────────────────────────────────────────────────────────────

function WebhooksTab() {
  const hooks = [
    { url: 'https://hooks.acme.internal/lens/alerts',   ev: 'alert.*',    on: true,  code: 200, ms: 41   },
    { url: 'https://ops.acme.com/webhooks/span-audit',  ev: 'span.leaked', on: true,  code: 200, ms: 88   },
    { url: 'https://svc-a.acme.com/lens',               ev: '*',           on: false, code: 502, ms: 2100 },
  ]
  return (
    <div className="max-w-[980px]">
      <TabHeader
        title="Webhooks"
        description="POST JSON to your endpoints on subscribed events. Retries up to 6 times with exponential backoff."
        action={<PrimaryBtn>+ New webhook</PrimaryBtn>}
      />
      <Section title="Endpoints" className="mb-5">
        <div className="divide-y divide-border">
          {hooks.map((w, i) => {
            const ok = w.code >= 200 && w.code < 300
            return (
              <div key={i} className={cn('grid grid-cols-[1.8fr_160px_110px_80px_60px] gap-4 px-6 py-4 items-center', !ok && 'bg-accent-bg/30')}>
                <div className="min-w-0">
                  <div className="font-mono text-[12px] text-text truncate">{w.url}</div>
                </div>
                <MonoPill variant="accent" dot>{w.ev}</MonoPill>
                <span className={cn('font-mono text-[11.5px] font-medium', ok ? 'text-good' : 'text-accent')}>● HTTP {w.code}</span>
                <span className="font-mono text-[11px] text-text-muted">{w.ms}ms</span>
                <Toggle on={w.on} />
              </div>
            )
          })}
        </div>
      </Section>
      <Section title="Security" description="Applies to every endpoint" className="mb-5">
        <FormRow label="Signing secret" hint="Included in X-Spanlens-Signature (HMAC-SHA256) on every POST.">
          <div className="flex items-center gap-2">
            <div className="font-mono text-[12px] text-text px-3 py-2 border border-border-strong rounded-md bg-bg-elev">whsec_live_••••••••e8</div>
            <GhostBtn>Reveal</GhostBtn>
            <GhostBtn>Rotate</GhostBtn>
          </div>
        </FormRow>
        <FormRow label="Retry policy" hint="Exponential backoff 5s → 1h. Max 6 attempts.">
          <div className="flex items-center gap-2"><Toggle on /><span className="font-mono text-[11.5px] text-text-muted">enabled · max 6 attempts</span></div>
        </FormRow>
      </Section>
    </div>
  )
}

// ─── OPENTELEMETRY tab ────────────────────────────────────────────────────────

function OTelTab() {
  const [copied, setCopied] = useState<string | null>(null)
  function copy(key: string, val: string) {
    void navigator.clipboard.writeText(val)
    setCopied(key)
    setTimeout(() => setCopied(null), 1500)
  }
  return (
    <div className="max-w-[980px]">
      <TabHeader
        title="OpenTelemetry"
        description="Send spans from any OTel-compatible SDK. Spanlens accepts OTLP/HTTP and OTLP/gRPC."
      />
      <Section title="Endpoint" className="mb-5">
        {[
          { label: 'OTLP/HTTP', val: 'https://ingest.spanlens.io/otlp/v1/traces', key: 'http' },
          { label: 'OTLP/gRPC', val: 'grpcs://ingest.spanlens.io:4317',           key: 'grpc' },
        ].map((row) => (
          <FormRow key={row.key} label={row.label}>
            <div className="flex items-center gap-2 flex-1 max-w-[520px]">
              <div className="flex-1 font-mono text-[12px] text-text px-3 py-2 border border-border-strong rounded-md bg-bg-elev truncate">{row.val}</div>
              <button
                type="button"
                onClick={() => copy(row.key, row.val)}
                className="p-2 rounded hover:bg-bg-muted text-text-faint hover:text-text transition-colors"
              >
                {copied === row.key ? <Check className="h-3.5 w-3.5 text-good" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          </FormRow>
        ))}
      </Section>
      <div className="grid grid-cols-2 gap-4 mb-5">
        {[
          {
            title: 'OTEL env vars · shell',
            lines: [
              'export OTEL_EXPORTER_OTLP_ENDPOINT="https://ingest.spanlens.io"',
              'export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer sl_live_..7f42"',
              'export OTEL_SERVICE_NAME="my-api"',
            ],
          },
          {
            title: 'collector · YAML',
            lines: [
              'exporters:',
              '  otlphttp/spanlens:',
              '    endpoint: https://ingest.spanlens.io',
              '    headers:',
              '      Authorization: Bearer ${SPANLENS_KEY}',
            ],
          },
        ].map((block) => (
          <div key={block.title} className="border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border bg-bg-muted flex items-center justify-between">
              <span className="font-mono text-[10.5px] text-text-faint uppercase tracking-[0.05em]">{block.title}</span>
              <span className="font-mono text-[10px] text-text cursor-pointer">copy</span>
            </div>
            <pre className="m-0 px-4 py-3 font-mono text-[11.5px] text-text leading-[1.7] whitespace-pre-wrap overflow-x-auto">
              {block.lines.join('\n')}
            </pre>
          </div>
        ))}
      </div>
      <Section title="Sampling" description="Tail-based · applied server-side" className="mb-5">
        <FormRow label="Default sample rate" hint="Traces without a parent span follow this rate.">
          <div className="flex items-center gap-2">
            <NativeInput defaultValue="100" className="w-20 font-mono text-[12.5px]" />
            <span className="font-mono text-[11.5px] text-text-faint">%</span>
          </div>
        </FormRow>
        <FormRow label="Error trace retention" hint="Always keep traces that contain a span with status=ERROR.">
          <div className="flex items-center gap-2"><Toggle on /><span className="font-mono text-[11.5px] text-text-muted">keep 100% errors</span></div>
        </FormRow>
      </Section>
    </div>
  )
}

// ─── PROFILE tab ──────────────────────────────────────────────────────────────

function ProfileTab() {
  return (
    <div className="max-w-[920px]">
      <TabHeader title="Profile" description="Your personal identity across every workspace." />
      <Section title="Identity" className="mb-5">
        <FormRow label="Display name"><NativeInput defaultValue="Chanwoo Kim" className="max-w-[360px] font-mono text-[12.5px]" /></FormRow>
        <FormRow label="Primary email" hint="Sign-in and invoice email.">
          <div className="flex items-center gap-2">
            <NativeInput defaultValue="you@workspace.com" className="max-w-[320px] font-mono text-[12.5px]" />
            <MonoPill variant="good" dot>verified</MonoPill>
          </div>
        </FormRow>
        <div className="flex justify-end gap-2 px-6 py-4">
          <GhostBtn>Discard</GhostBtn>
          <PrimaryBtn>Save changes</PrimaryBtn>
        </div>
      </Section>
      <Section title="Sign-in & security" className="mb-5">
        <FormRow label="Sign-in method">
          <div className="font-mono text-[12px] text-text px-3 py-2 border border-border rounded-md bg-bg-elev">Google · SSO</div>
        </FormRow>
        <FormRow label="Two-factor" hint="TOTP via authenticator app.">
          <div className="flex items-center gap-2"><Toggle on /><span className="font-mono text-[11.5px] text-text-muted">on · 2 recovery codes remaining</span></div>
        </FormRow>
      </Section>
    </div>
  )
}

// ─── NOTIFICATIONS tab ────────────────────────────────────────────────────────

const NOTIF_ROWS = [
  { k: 'Anomaly detected',   d: 'Request rate, p95 latency, or cost drifts >2σ.', delivery: 'instant', email: true,  slack: true,  mobile: true  },
  { k: 'Cost spike',         d: 'Projected spend exceeds a budget alert.',         delivery: 'instant', email: true,  slack: true,  mobile: false },
  { k: 'Prompt deployed',    d: 'Someone promoted a prompt version.',              delivery: 'digest',  email: false, slack: true,  mobile: false },
  { k: 'Prompt rolled back', d: 'A production prompt version was reverted.',       delivery: 'instant', email: true,  slack: true,  mobile: true  },
  { k: 'Weekly summary',     d: 'Monday 9am · spend, usage, top anomalies.',       delivery: 'weekly',  email: true,  slack: false, mobile: false },
]

function NotificationsTab() {
  return (
    <div className="max-w-[980px]">
      <TabHeader title="Notifications" description="Your personal routing. Critical events default to instant." />
      <Section title="Routing matrix" action={<Hint>Per-channel, per-event</Hint>} className="mb-5">
        <div className="divide-y divide-border">
          <div className="grid grid-cols-[1.8fr_1fr_90px_90px_90px] gap-4 px-6 py-3 font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
            {['Event', 'Delivery', 'Email', 'Slack', 'Mobile'].map((h) => <span key={h}>{h}</span>)}
          </div>
          {NOTIF_ROWS.map((r) => (
            <div key={r.k} className="grid grid-cols-[1.8fr_1fr_90px_90px_90px] gap-4 px-6 py-3 items-center">
              <div>
                <div className="text-[13px] font-medium text-text">{r.k}</div>
                <div className="font-mono text-[10.5px] text-text-muted mt-0.5">{r.d}</div>
              </div>
              <MonoPill variant={r.delivery === 'instant' ? 'accent' : 'neutral'} dot>{r.delivery}</MonoPill>
              <div className="flex justify-start"><Toggle on={r.email} /></div>
              <div className="flex justify-start"><Toggle on={r.slack} /></div>
              <div className="flex justify-start"><Toggle on={r.mobile} /></div>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Quiet hours" description="Drops non-critical pings in this window" className="mb-5">
        <FormRow label="Enabled">
          <div className="flex items-center gap-2"><Toggle on /><span className="font-mono text-[11.5px] text-text-muted">Mon → Fri · 22:00 → 08:00</span></div>
        </FormRow>
        <FormRow label="Always push critical" hint="Anomaly, rollback, and cost-spike still come through.">
          <Toggle on />
        </FormRow>
      </Section>
    </div>
  )
}

// ─── PREFERENCES tab ──────────────────────────────────────────────────────────

function PreferencesTab() {
  const [theme, setTheme] = useState<'System' | 'Light' | 'Dark'>('Light')
  return (
    <div className="max-w-[920px]">
      <TabHeader title="Preferences" description="Visual and ergonomic choices, applied only to your account." />
      <Section title="Appearance" className="mb-5">
        <FormRow label="Theme" hint="Follow system or pin to one.">
          <div className="flex gap-2">
            {(['System', 'Light', 'Dark'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTheme(t)}
                className={cn(
                  'px-5 py-2 rounded-md font-mono text-[12px] border transition-colors',
                  theme === t ? 'border-border-strong bg-text text-bg' : 'border-border bg-bg-elev text-text-muted hover:text-text',
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </FormRow>
        <FormRow label="Density" hint="Comfy has more whitespace; compact squeezes more rows.">
          <div className="flex gap-2">
            {['Comfy', 'Compact'].map((d, i) => (
              <button
                key={d}
                type="button"
                className={cn(
                  'px-5 py-2 rounded-md font-mono text-[12px] border transition-colors',
                  i === 0 ? 'border-border-strong bg-text text-bg' : 'border-border bg-bg-elev text-text-muted hover:text-text',
                )}
              >
                {d}
              </button>
            ))}
          </div>
        </FormRow>
      </Section>
      <Section title="Productivity" className="mb-5">
        <FormRow label="Keyboard shortcuts" hint="Command palette is ⌘K.">
          <div className="flex items-center gap-2"><Toggle on /><span className="font-mono text-[11.5px] text-text-muted">enabled</span></div>
        </FormRow>
        <FormRow label="Reduce motion" hint="Disables sparkline animations and panel transitions.">
          <Toggle on={false} />
        </FormRow>
        <FormRow label="Show tips & new feature nudges" hint="One-time product hints above charts and tables.">
          <div className="flex items-center gap-2"><Toggle on /><span className="font-mono text-[11.5px] text-text-muted">on · 2 unread</span></div>
        </FormRow>
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
    case 'destinations':  return <DestinationsTab />
    case 'webhooks':      return <WebhooksTab />
    case 'opentelemetry': return <OTelTab />
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
