'use client'
import { useState } from 'react'
import { Plus, RotateCcw, Trash2, Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
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
      { id: 'api-keys',   label: 'API keys',   crumbs: [{ label: 'Workspace' }, { label: 'Settings' }, { label: 'API keys' }] },
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

const MOCK_MEMBERS = [
  { name: 'You (owner)', email: 'you@workspace.com', role: 'owner',   last: 'just now', you: true },
  { name: 'Jisoo Park',  email: 'jisoo@workspace.com', role: 'admin', last: '11m ago' },
  { name: 'Min Lee',     email: 'min@workspace.com', role: 'member',   last: '2h ago' },
  { name: 'Eunji Choi',  email: 'eunji@workspace.com', role: 'member', last: 'yesterday' },
]

function MembersTab() {
  return (
    <div className="max-w-[980px]">
      <TabHeader
        title="Members"
        description="Human teammates and service accounts."
        action={<PrimaryBtn>+ Invite members</PrimaryBtn>}
      />
      <Section title="Active members" description="Last activity from span ingestion or UI use" className="mb-5">
        <div className="divide-y divide-border">
          <div className="grid grid-cols-[1.6fr_1.6fr_120px_130px_40px] gap-4 px-6 py-3 font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
            {['Member', 'Email', 'Role', 'Last active', ''].map((h, i) => <span key={i}>{h}</span>)}
          </div>
          {MOCK_MEMBERS.map((m) => (
            <div key={m.email} className="grid grid-cols-[1.6fr_1.6fr_120px_130px_40px] gap-4 px-6 py-3 items-center">
              <span className="text-[13px] font-medium text-text truncate">
                {m.name}
                {m.you && <span className="ml-2 font-mono text-[10px] text-accent">(you)</span>}
              </span>
              <span className="font-mono text-[11.5px] text-text-muted truncate">{m.email}</span>
              <MonoPill variant={m.role === 'owner' ? 'accent' : 'neutral'} dot>{m.role}</MonoPill>
              <span className="font-mono text-[11px] text-text-muted">{m.last}</span>
              <button type="button" className="font-mono text-[14px] text-text-faint hover:text-text">⋯</button>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Roles & permissions" description="Preset bundles · custom roles on Enterprise" className="mb-5">
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

  const keys = keysQuery.data ?? []

  return (
    <div className="max-w-[980px]">
      <TabHeader
        title="API keys"
        description="Provider keys authenticate calls to OpenAI, Anthropic, and Gemini through the Spanlens proxy."
        action={
          <GhostBtn onClick={() => setAddOpen(true)}><Plus className="h-3.5 w-3.5 mr-1.5" /> Add provider key</GhostBtn>
        }
      />

      <div className="mb-4 border border-accent-border bg-accent-bg rounded-lg px-4 py-3 flex items-center gap-3">
        <span className="w-5 h-5 rounded-full border border-accent text-accent flex items-center justify-center font-mono text-[10px] shrink-0">!</span>
        <div className="flex-1 text-[12.5px] text-text-muted">
          Provider keys are encrypted at rest (AES-256-GCM). Only the last 4 characters are ever shown.
        </div>
      </div>

      <Section
        title="Provider keys"
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

const AUDIT_EVENTS = [
  { time: '14:42:18', who: 'You',        action: 'prompt.deploy',       target: 'support-triage@v14 → production', sev: 'high' as const },
  { time: '14:40:02', who: 'oncall bot', action: 'alert.fire',          target: 'cost.spike · > 2σ',               sev: 'high' as const },
  { time: '14:32:04', who: 'Jisoo Park', action: 'key.create',          target: 'sl_live_…7f42 · prod',            sev: 'med'  as const },
  { time: '14:18:33', who: 'Min Lee',    action: 'member.invite',       target: 'daniel@acme.com · member',        sev: 'low'  as const },
  { time: '13:55:10', who: 'You',        action: 'billing.plan.change', target: 'Team → Pro',                      sev: 'high' as const },
  { time: '13:42:51', who: 'Jisoo Park', action: 'integration.connect', target: 'Slack · #llm-ops',                sev: 'med'  as const },
]

function AuditLogTab() {
  return (
    <div className="max-w-[980px]">
      <TabHeader
        title="Audit log"
        description="Every state change in the workspace. Streamed to SIEM, never mutated."
        action={<GhostBtn>Export JSON</GhostBtn>}
      />

      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { k: 'HIGH', n: 3,  sub: 'billing · deploy · fires', accent: true },
          { k: 'MED',  n: 12, sub: 'keys · members · integrations', accent: false },
          { k: 'LOW',  n: 48, sub: 'reads · runs · webhooks', accent: false },
        ].map((s) => (
          <div key={s.k} className={cn('border rounded-lg p-3', s.accent ? 'border-accent-border bg-accent-bg' : 'border-border bg-bg-elev')}>
            <div className="flex items-baseline justify-between">
              <span className={cn('font-mono text-[10px] tracking-[0.05em]', s.accent ? 'text-accent' : 'text-text-faint')}>{s.k} · 24h</span>
              <span className="font-mono text-[22px] font-medium text-text">{s.n}</span>
            </div>
            <div className="font-mono text-[10.5px] text-text-muted mt-1">{s.sub}</div>
          </div>
        ))}
      </div>

      <Section title="Events" action={<Hint>Newest first · UTC+9</Hint>} className="mb-5">
        <div className="divide-y divide-border">
          <div className="grid grid-cols-[80px_40px_160px_200px_1fr_60px] gap-4 px-6 py-3 font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
            {['Time', '', 'Actor', 'Action', 'Target', ''].map((h, i) => <span key={i}>{h}</span>)}
          </div>
          {AUDIT_EVENTS.map((e, i) => (
            <div key={i} className="grid grid-cols-[80px_40px_160px_200px_1fr_60px] gap-4 px-6 py-3 items-center">
              <span className="font-mono text-[11.5px] text-text-muted">{e.time}</span>
              <span className={cn('font-mono text-[9px] uppercase tracking-[0.04em]', e.sev === 'high' ? 'text-accent' : e.sev === 'med' ? 'text-text' : 'text-text-faint')}>
                ● {e.sev}
              </span>
              <span className="text-[12.5px] text-text">{e.who}</span>
              <span className={cn('font-mono text-[11.5px] font-medium', e.sev === 'high' ? 'text-accent' : 'text-text')}>{e.action}</span>
              <span className="font-mono text-[11.5px] text-text-muted truncate">{e.target}</span>
              <span className="font-mono text-[11px] text-text">view →</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}

// ─── BILLING tab ──────────────────────────────────────────────────────────────

function BillingTab() {
  const { data: org } = useOrganization()
  const planLabel = org?.plan ? org.plan.charAt(0).toUpperCase() + org.plan.slice(1) : '—'

  return (
    <div className="max-w-[920px]">
      <TabHeader title="Billing" description="Per-request pricing. What ingests this month is what you pay." />

      {/* Hero card */}
      <div className="border border-border rounded-xl bg-bg-elev p-6 grid grid-cols-2 gap-8 mb-5">
        <div>
          <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] mb-3">Current plan</div>
          <div className="flex items-baseline gap-3 mb-1">
            <span className="text-[30px] font-medium tracking-[-0.6px]">{planLabel}</span>
            <span className="font-mono text-[12px] text-text-muted">$0.20 / 1k req</span>
          </div>
          <div className="text-[12.5px] text-text-muted mb-4">Renews end of cycle · Visa •• 4242</div>
          <div className="flex gap-2">
            <GhostBtn>Change plan</GhostBtn>
          </div>
        </div>
        <div>
          <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] mb-3">This cycle</div>
          <div className="h-2.5 bg-bg-muted rounded-full overflow-hidden mb-2">
            <div className="h-full w-[68%] bg-text rounded-full" />
          </div>
          <div className="flex justify-between font-mono text-[11px] text-text-muted">
            <span><span className="text-text">6.8M</span> / 10M included</span>
            <span>day 23 / 30</span>
          </div>
          <div className="mt-3 flex gap-4 text-[12px] text-text-muted">
            <span><span className="font-mono text-text">$1,040</span> so far</span>
            <span><span className="font-mono text-text">$1,380</span> projected</span>
          </div>
        </div>
      </div>

      <Section title="Payment method" className="mb-5">
        <div className="flex items-center gap-4 px-6 py-4">
          <div className="w-12 h-8 border border-border rounded bg-bg-muted flex items-center justify-center font-mono text-[10px] font-semibold text-text">VISA</div>
          <div className="flex-1">
            <div className="text-[13px] font-medium text-text">Visa ending 4242</div>
            <div className="font-mono text-[11px] text-text-faint">expires 09 / 2028</div>
          </div>
          <GhostBtn>Update card</GhostBtn>
        </div>
      </Section>

      <Section title="Budget alerts" action={<Hint>Slack, email, webhook</Hint>} className="mb-5">
        <div className="divide-y divide-border">
          {[
            { pct: 50, to: 'finance@workspace.com', via: 'email', on: true },
            { pct: 80, to: '#llm-ops',              via: 'slack', on: true },
          ].map((a, i) => (
            <div key={i} className="grid grid-cols-[80px_1fr_140px_80px] gap-3 px-6 py-3 items-center">
              <span className="font-mono text-[13px] font-medium text-text">at {a.pct}%</span>
              <span className="font-mono text-[12px] text-text-muted">{a.to}</span>
              <span className="font-mono text-[10.5px] text-text-faint uppercase tracking-[0.04em]">via {a.via}</span>
              <Toggle on={a.on} />
            </div>
          ))}
          <div className="px-6 py-3">
            <GhostBtn>+ Add alert</GhostBtn>
          </div>
        </div>
      </Section>
    </div>
  )
}

// ─── PLAN & LIMITS tab (has real overage settings) ────────────────────────────

const PLAN_CARDS = [
  { name: 'Free',       price: '$0',           blurb: '1 project · 50k req/mo · 7d retention',    feat: ['1 project', '50,000 requests / month', '7-day retention', 'Community support'] },
  { name: 'Pro',        price: '$99 + usage',  blurb: '10M req included · 30d retention',         feat: ['Unlimited projects', '10M included requests', '30-day retention', 'All integrations', 'Slack support'] },
  { name: 'Team',       price: '$499 + usage', blurb: '50M included · 90d retention · SSO',       feat: ['Everything in Pro', '50M requests', '90-day retention', 'SSO + SAML', 'Audit log export'] },
  { name: 'Enterprise', price: 'custom',       blurb: 'self-host · custom DPA · SLA',             feat: ['Self-host or dedicated', 'Custom retention', 'DPA / BAA', 'Uptime SLA 99.9%', '24/7 priority'] },
]

function PlanLimitsTab() {
  const { data: org } = useOrganization()
  const update = useUpdateOverageSettings()
  const [multiplierDraft, setMultiplierDraft] = useState(String(org?.overage_cap_multiplier ?? 2))

  const isFree       = org?.plan === 'free'
  const isEnterprise = org?.plan === 'enterprise'

  return (
    <div className="max-w-[1040px]">
      <TabHeader title="Plan & limits" description="Compare plans. Hard limits apply per-workspace; can be lifted on Enterprise." />

      {/* Plan picker */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {PLAN_CARDS.map((p) => {
          const isCurrent = org?.plan === p.name.toLowerCase()
          return (
            <div
              key={p.name}
              className={cn(
                'border rounded-xl p-4 flex flex-col gap-3 min-h-[260px]',
                isCurrent ? 'border-accent bg-accent-bg' : 'border-border bg-bg-elev',
              )}
            >
              <div className="flex items-start justify-between">
                <span className="text-[15px] font-medium text-text">{p.name}</span>
                {isCurrent && <MonoPill variant="accent" dot>current</MonoPill>}
              </div>
              <div>
                <div className="font-mono text-[18px] font-medium tracking-[-0.2px] text-text">{p.price}</div>
                <div className="font-mono text-[10.5px] text-text-muted mt-1">{p.blurb}</div>
              </div>
              <ul className="flex-1 space-y-1.5">
                {p.feat.map((f) => <li key={f} className="font-mono text-[10.5px] text-text-muted">▸ {f}</li>)}
              </ul>
              <div>
                {isCurrent ? <GhostBtn>Manage</GhostBtn> : <PrimaryBtn>{p.name === 'Enterprise' ? 'Contact sales' : `Upgrade to ${p.name}`}</PrimaryBtn>}
              </div>
            </div>
          )
        })}
      </div>

      <Section title="Hard limits" action={<Hint>{org?.plan ?? 'free'} plan</Hint>} className="mb-5">
        <div className="divide-y divide-border">
          <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-4 px-6 py-3 font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
            {['Resource', 'Limit', 'Used now', 'Headroom'].map((h) => <span key={h}>{h}</span>)}
          </div>
          {[
            ['Requests / month', '10,000,000', '6,821,302', '32%'],
            ['Team seats',       '10',          '4',         '60%'],
            ['Retention',        '30 days',     '30 days',   'max'],
            ['API keys',         '25',           '5',         '80%'],
            ['Alert rules',      '100',          '18',        'ok'],
          ].map(([res, limit, used, head]) => (
            <div key={res} className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-4 px-6 py-3 text-[12.5px]">
              <span className="font-mono text-[12px] text-text-muted">{res}</span>
              <span className="font-mono text-[12px] text-text">{limit}</span>
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
              Overage is not available on the Free plan. Upgrade to Starter or Pro to continue serving requests past your quota.
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

const MOCK_INVOICES = [
  { id: 'inv_2026_04', date: 'Apr 01', period: 'Apr 01 – Apr 30 · 2026', amt: '$1,248.00', reqs: '6.24M', st: 'paid'     },
  { id: 'inv_2026_03', date: 'Mar 01', period: 'Mar 01 – Mar 31 · 2026', amt: '$1,102.40', reqs: '5.51M', st: 'paid'     },
  { id: 'inv_2026_02', date: 'Feb 01', period: 'Feb 01 – Feb 28 · 2026', amt: '$984.80',   reqs: '4.92M', st: 'paid'     },
  { id: 'inv_2025_12', date: 'Dec 01', period: 'Dec 01 – Dec 31 · 2025', amt: '$742.20',   reqs: '3.71M', st: 'refunded' },
]

function InvoicesTab() {
  return (
    <div className="max-w-[980px]">
      <TabHeader
        title="Invoices"
        description="Every invoice, in one place. PDFs are downloadable."
        action={<GhostBtn>Download all CSV</GhostBtn>}
      />
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { k: 'Lifetime',     v: '$4,077.40', s: 'across 4 invoices' },
          { k: 'Avg / month',  v: '$1,019',    s: '4-month average' },
          { k: 'Next invoice', v: 'May 01',    s: 'projected $1,380' },
          { k: 'Last payment', v: 'Apr 01',    s: 'visa 4242 · $1,248' },
        ].map((x) => (
          <div key={x.k} className="border border-border rounded-lg p-3 bg-bg-elev">
            <div className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em]">{x.k}</div>
            <div className="font-mono text-[18px] font-medium text-text mt-1">{x.v}</div>
            <div className="font-mono text-[10.5px] text-text-muted mt-1">{x.s}</div>
          </div>
        ))}
      </div>
      <Section title="History" className="mb-5">
        <div className="divide-y divide-border">
          <div className="grid grid-cols-[80px_140px_1.4fr_110px_110px_80px] gap-4 px-6 py-3 font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
            {['Date', 'Invoice', 'Period', 'Requests', 'Amount', 'Status'].map((h) => <span key={h}>{h}</span>)}
          </div>
          {MOCK_INVOICES.map((inv) => (
            <div key={inv.id} className="grid grid-cols-[80px_140px_1.4fr_110px_110px_80px] gap-4 px-6 py-3 items-center">
              <span className="font-mono text-[11.5px] text-text-muted">{inv.date}</span>
              <span className="font-mono text-[11.5px] text-text">{inv.id}</span>
              <span className="font-mono text-[11px] text-text-muted">{inv.period}</span>
              <span className="font-mono text-[12px] text-text">{inv.reqs}</span>
              <span className="font-mono text-[12px] font-medium text-text">{inv.amt}</span>
              <span className={cn('font-mono text-[10px] uppercase tracking-[0.04em]', inv.st === 'paid' ? 'text-good' : 'text-text-faint')}>
                ● {inv.st}
              </span>
            </div>
          ))}
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
