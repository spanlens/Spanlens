'use client'
import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Topbar } from '@/components/layout/topbar'
import { cn } from '@/lib/utils'

type TabId =
  | 'general' | 'members' | 'security' | 'audit-log' | 'system'
  | 'billing' | 'plan' | 'invoices'
  | 'profile' | 'notifications' | 'preferences'
  | 'integrations' | 'webhooks' | 'opentelemetry'

type NavItem = { id: TabId; label: string; crumbs: { label: string }[] }

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Workspace',
    items: [
      { id: 'general', label: 'General', crumbs: [{ label: 'Demo' }, { label: 'Settings' }, { label: 'General' }] },
      { id: 'members', label: 'Members', crumbs: [{ label: 'Demo' }, { label: 'Settings' }, { label: 'Members' }] },
      { id: 'security', label: 'Security', crumbs: [{ label: 'Demo' }, { label: 'Settings' }, { label: 'Security' }] },
      { id: 'audit-log', label: 'Audit log', crumbs: [{ label: 'Demo' }, { label: 'Settings' }, { label: 'Audit log' }] },
      { id: 'system', label: 'System', crumbs: [{ label: 'Demo' }, { label: 'Settings' }, { label: 'System' }] },
    ],
  },
  {
    group: 'Usage',
    items: [
      { id: 'billing', label: 'Billing', crumbs: [{ label: 'Demo' }, { label: 'Settings' }, { label: 'Billing' }] },
      { id: 'plan', label: 'Plan & limits', crumbs: [{ label: 'Demo' }, { label: 'Settings' }, { label: 'Plan & limits' }] },
      { id: 'invoices', label: 'Invoices', crumbs: [{ label: 'Demo' }, { label: 'Settings' }, { label: 'Invoices' }] },
    ],
  },
  {
    group: 'Account',
    items: [
      { id: 'profile', label: 'Profile', crumbs: [{ label: 'Demo' }, { label: 'Profile' }] },
      { id: 'notifications', label: 'Notifications', crumbs: [{ label: 'Demo' }, { label: 'Notifications' }] },
      { id: 'preferences', label: 'Preferences', crumbs: [{ label: 'Demo' }, { label: 'Preferences' }] },
    ],
  },
  {
    group: 'Connect',
    items: [
      { id: 'integrations', label: 'Integrations', crumbs: [{ label: 'Demo' }, { label: 'Integrations' }] },
      { id: 'webhooks', label: 'Webhooks', crumbs: [{ label: 'Demo' }, { label: 'Webhooks' }] },
      { id: 'opentelemetry', label: 'OpenTelemetry', crumbs: [{ label: 'Demo' }, { label: 'OpenTelemetry' }] },
    ],
  },
]

const ALL_ITEMS = NAV.flatMap((g) => g.items)

function TabHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-[26px] font-medium tracking-[-0.6px] mb-1">{title}</h1>
      <p className="text-[13px] text-text-muted">{description}</p>
    </div>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-bg-elev p-5 mb-5">
      <div className="mb-4">
        <h2 className="text-[14px] font-semibold text-text">{title}</h2>
        {description && <p className="text-[12px] text-text-muted mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  )
}

function FormRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-3 md:gap-6 py-3 border-t border-border first:border-t-0">
      <div>
        <div className="text-[13px] text-text font-medium">{label}</div>
        {hint && <div className="text-[11.5px] text-text-faint mt-0.5">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  )
}

function DemoInput({ value, mono }: { value: string; mono?: boolean }) {
  return (
    <input
      value={value}
      disabled
      readOnly
      className={cn(
        'h-9 px-3 rounded-[6px] border border-border bg-bg text-[13px] text-text-muted w-full max-w-[460px] cursor-not-allowed',
        mono && 'font-mono text-[12.5px]',
      )}
    />
  )
}

function DemoToggle({ on }: { on: boolean }) {
  return (
    <button
      type="button"
      disabled
      title="Disabled in demo"
      className={cn(
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-not-allowed opacity-80',
        on ? 'bg-text' : 'bg-border-strong',
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

function GeneralTab() {
  return (
    <div className="max-w-[920px]">
      <TabHeader title="General" description="Workspace identity, storage region, and retention." />
      <Section title="Identity">
        <FormRow label="Workspace name" hint="Shown in the app header and on shared traces.">
          <DemoInput value="Acme Corp" mono />
        </FormRow>
        <FormRow label="Workspace ID">
          <DemoInput value="org_01HZX8K4N7M2R3T5V6W7X8Y9Z0" mono />
        </FormRow>
      </Section>
      <Section title="Data residency" description="Where requests are stored.">
        <FormRow label="Region">
          <DemoInput value="us-east-1" mono />
        </FormRow>
        <FormRow label="Retention" hint="Defined by your plan.">
          <DemoInput value="14 days · Free" />
        </FormRow>
      </Section>
    </div>
  )
}

function MembersTab() {
  const members = [
    { email: 'haeseong@acme.com', role: 'admin', joined: '2026-03-12' },
    { email: 'eng-lead@acme.com', role: 'admin', joined: '2026-03-14' },
    { email: 'support@acme.com', role: 'member', joined: '2026-04-02' },
    { email: 'analyst@acme.com', role: 'viewer', joined: '2026-04-19' },
  ]
  return (
    <div className="max-w-[920px]">
      <TabHeader title="Members" description="Invite teammates and manage roles." />
      <Section title="Invite member">
        <FormRow label="Email">
          <div className="flex gap-2 max-w-[460px]">
            <DemoInput value="teammate@example.com" />
            <button disabled className="h-9 px-4 rounded-[6px] bg-text text-bg text-[13px] font-medium opacity-60 cursor-not-allowed">
              Send invite
            </button>
          </div>
        </FormRow>
      </Section>
      <Section title="Active members">
        <div className="divide-y divide-border -my-2">
          {members.map((m) => (
            <div key={m.email} className="flex items-center justify-between py-3">
              <div>
                <div className="text-[13px] text-text">{m.email}</div>
                <div className="text-[11px] text-text-faint mt-0.5">Joined {m.joined}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.04em] px-2 py-0.5 rounded-full border border-border text-text-muted">
                  {m.role}
                </span>
                <button disabled className="text-[12px] text-text-faint opacity-60 cursor-not-allowed">Remove</button>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}

function SecurityTab() {
  return (
    <div className="max-w-[920px]">
      <TabHeader title="Security" description="Workspace-wide security controls." />
      <Section title="API key rotation">
        <FormRow label="Stale key threshold" hint="Notify when keys haven't rotated in N days.">
          <DemoInput value="90 days" />
        </FormRow>
        <FormRow label="Require 2FA for admins" hint="Admins must enable 2FA to sign in.">
          <DemoToggle on={true} />
        </FormRow>
      </Section>
      <Section title="Sign-in">
        <FormRow label="Allowed providers">
          <div className="flex gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.04em] px-2 py-0.5 rounded-full border border-good/20 bg-good-bg text-good">Email</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.04em] px-2 py-0.5 rounded-full border border-good/20 bg-good-bg text-good">Google</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.04em] px-2 py-0.5 rounded-full border border-border text-text-faint">GitHub</span>
          </div>
        </FormRow>
      </Section>
    </div>
  )
}

function AuditLogTab() {
  const logs = [
    { time: '2026-05-22 09:14', actor: 'haeseong@acme.com', action: 'api_key.create', sev: 'med' as const },
    { time: '2026-05-21 17:42', actor: 'eng-lead@acme.com', action: 'provider_key.rotate', sev: 'high' as const },
    { time: '2026-05-21 11:08', actor: 'haeseong@acme.com', action: 'member.invite', sev: 'med' as const },
    { time: '2026-05-20 22:33', actor: 'system', action: 'subscription.update', sev: 'low' as const },
    { time: '2026-05-20 14:01', actor: 'analyst@acme.com', action: 'dataset.create', sev: 'low' as const },
  ]
  return (
    <div className="max-w-[920px]">
      <TabHeader title="Audit log" description="Workspace activity from the last 90 days." />
      <div className="rounded-xl border border-border bg-bg-elev overflow-hidden">
        <div className="grid grid-cols-[150px_1fr_180px_80px] gap-4 px-5 py-2.5 border-b border-border font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
          <span>Time</span>
          <span>Actor</span>
          <span>Action</span>
          <span>Severity</span>
        </div>
        {logs.map((l, i) => (
          <div key={i} className="grid grid-cols-[150px_1fr_180px_80px] gap-4 px-5 py-2.5 border-b border-border last:border-b-0 items-center">
            <span className="font-mono text-[11.5px] text-text-muted">{l.time}</span>
            <span className="text-[12.5px] text-text truncate">{l.actor}</span>
            <span className="font-mono text-[11.5px] text-text-muted">{l.action}</span>
            <span
              className={cn(
                'font-mono text-[10px] uppercase tracking-[0.04em] px-2 py-0.5 rounded-full border w-fit',
                l.sev === 'high' && 'border-accent-border bg-accent-bg text-accent',
                l.sev === 'med' && 'border-border bg-bg-elev text-text-muted',
                l.sev === 'low' && 'border-border bg-transparent text-text-faint',
              )}
            >
              {l.sev}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SystemTab() {
  return (
    <div className="max-w-[920px]">
      <TabHeader title="System" description="Background jobs and infrastructure." />
      <Section title="Background jobs">
        <div className="divide-y divide-border -my-2">
          {[
            { name: 'Replay fallback queue', cadence: 'every 5 min', last: '2 min ago', healthy: true },
            { name: 'Aggregate hourly stats', cadence: 'every 1 hour', last: '12 min ago', healthy: true },
            { name: 'Stale key digest', cadence: 'daily', last: '8 hours ago', healthy: true },
            { name: 'Anomaly detector', cadence: 'every 15 min', last: '4 min ago', healthy: true },
          ].map((j) => (
            <div key={j.name} className="flex items-center justify-between py-3">
              <div>
                <div className="text-[13px] text-text">{j.name}</div>
                <div className="text-[11px] text-text-faint mt-0.5">Runs {j.cadence}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[11px] text-text-muted">last: {j.last}</span>
                <span className="font-mono text-[10px] uppercase px-2 py-0.5 rounded-full border border-good/20 bg-good-bg text-good">healthy</span>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}

function BillingTab() {
  return (
    <div className="max-w-[920px]">
      <TabHeader title="Billing" description="Payment method and billing contact." />
      <Section title="Payment method">
        <FormRow label="Card on file">
          <div className="text-[13px] text-text-muted">No card on file (Free plan)</div>
        </FormRow>
        <FormRow label="Billing email">
          <DemoInput value="billing@acme.com" />
        </FormRow>
      </Section>
      <Section title="Plan">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[14px] font-semibold text-text">Free</div>
            <div className="text-[12px] text-text-muted mt-0.5">2,400 of 50,000 requests this month</div>
          </div>
          <button disabled className="h-9 px-4 rounded-[6px] bg-accent text-bg text-[13px] font-medium opacity-60 cursor-not-allowed">
            Upgrade to Pro
          </button>
        </div>
      </Section>
    </div>
  )
}

function PlanTab() {
  return (
    <div className="max-w-[920px]">
      <TabHeader title="Plan & limits" description="Compare plans and configure overage behavior." />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        {[
          { name: 'Free', price: '$0', reqs: '50k', retention: '14d', cur: true },
          { name: 'Pro', price: '$49', reqs: '500k', retention: '90d', cur: false },
          { name: 'Team', price: '$199', reqs: '2.5M', retention: '365d', cur: false },
        ].map((p) => (
          <div
            key={p.name}
            className={cn(
              'rounded-xl border p-5',
              p.cur ? 'border-accent bg-accent-bg/30' : 'border-border bg-bg-elev',
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[15px] font-semibold text-text">{p.name}</h3>
              {p.cur && (
                <span className="font-mono text-[9px] uppercase tracking-[0.05em] px-1.5 py-0.5 rounded-full border border-accent-border bg-accent-bg text-accent">
                  current
                </span>
              )}
            </div>
            <div className="text-[24px] font-medium text-text mb-3">
              {p.price}
              <span className="text-[12px] text-text-muted">/mo</span>
            </div>
            <ul className="text-[12.5px] text-text-muted space-y-1">
              <li>{p.reqs} requests/mo</li>
              <li>{p.retention} retention</li>
            </ul>
          </div>
        ))}
      </div>
      <Section title="Overage">
        <FormRow label="Allow overage" hint="Charge per extra 1k requests past the monthly cap.">
          <DemoToggle on={false} />
        </FormRow>
        <FormRow label="Max overage multiplier" hint="Hard cap = monthly limit × this value. Requests past return 429.">
          <DemoInput value="2.0" />
        </FormRow>
      </Section>
    </div>
  )
}

function InvoicesTab() {
  return (
    <div className="max-w-[920px]">
      <TabHeader title="Invoices" description="Past invoices and download links." />
      <div className="rounded-xl border border-border bg-bg-elev overflow-hidden">
        <div className="grid grid-cols-[120px_1fr_120px_100px] gap-4 px-5 py-2.5 border-b border-border font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
          <span>Date</span>
          <span>Description</span>
          <span>Amount</span>
          <span>Status</span>
        </div>
        {[
          { date: '2026-05-01', desc: 'No invoices on Free plan', amount: '—', status: '—' },
        ].map((inv, i) => (
          <div key={i} className="grid grid-cols-[120px_1fr_120px_100px] gap-4 px-5 py-3 items-center">
            <span className="font-mono text-[11.5px] text-text-faint">{inv.date}</span>
            <span className="text-[12.5px] text-text-faint">{inv.desc}</span>
            <span className="font-mono text-[12px] text-text-faint">{inv.amount}</span>
            <span className="font-mono text-[10px] text-text-faint">{inv.status}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ProfileTab() {
  return (
    <div className="max-w-[920px]">
      <TabHeader title="Profile" description="Your personal account info." />
      <Section title="Identity">
        <FormRow label="Email">
          <DemoInput value="haeseong@acme.com" />
        </FormRow>
        <FormRow label="Display name">
          <DemoInput value="Haeseong" />
        </FormRow>
      </Section>
      <Section title="Password">
        <FormRow label="Change password">
          <button disabled className="h-9 px-4 rounded-[6px] border border-border bg-bg-elev text-[13px] text-text-muted opacity-60 cursor-not-allowed">
            Send reset email
          </button>
        </FormRow>
      </Section>
    </div>
  )
}

function NotificationsTab() {
  return (
    <div className="max-w-[920px]">
      <TabHeader title="Notifications" description="Email me when…" />
      <Section title="Email notifications">
        {[
          { label: 'A new anomaly is detected', on: true },
          { label: 'A budget alert fires', on: true },
          { label: 'A new teammate joins', on: true },
          { label: 'Weekly digest', on: false },
        ].map((n) => (
          <FormRow key={n.label} label={n.label}>
            <DemoToggle on={n.on} />
          </FormRow>
        ))}
      </Section>
    </div>
  )
}

function PreferencesTab() {
  return (
    <div className="max-w-[920px]">
      <TabHeader title="Preferences" description="Personal UI preferences." />
      <Section title="Appearance">
        <FormRow label="Theme">
          <div className="flex gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.04em] px-2 py-0.5 rounded-full border border-border text-text-muted">Light</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.04em] px-2 py-0.5 rounded-full border border-border text-text-muted">Dark</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.04em] px-2 py-0.5 rounded-full border border-accent-border bg-accent-bg text-accent">System</span>
          </div>
        </FormRow>
        <FormRow label="Compact tables" hint="Tighter row spacing in Requests, Traces, etc.">
          <DemoToggle on={false} />
        </FormRow>
      </Section>
    </div>
  )
}

function IntegrationsTab() {
  const ints = [
    { name: 'Slack', desc: 'Send alerts to a channel.', connected: true },
    { name: 'PagerDuty', desc: 'Page on-call when alerts fire.', connected: false },
    { name: 'Datadog', desc: 'Forward metrics & traces.', connected: false },
    { name: 'Discord', desc: 'Send alerts via webhook.', connected: false },
  ]
  return (
    <div className="max-w-[920px]">
      <TabHeader title="Integrations" description="Connect Spanlens to your existing stack." />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {ints.map((it) => (
          <div key={it.name} className="rounded-xl border border-border bg-bg-elev p-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[14px] font-semibold text-text">{it.name}</h3>
              {it.connected ? (
                <span className="font-mono text-[10px] uppercase tracking-[0.04em] px-2 py-0.5 rounded-full border border-good/20 bg-good-bg text-good">connected</span>
              ) : (
                <span className="font-mono text-[10px] uppercase tracking-[0.04em] px-2 py-0.5 rounded-full border border-border text-text-faint">not connected</span>
              )}
            </div>
            <p className="text-[12.5px] text-text-muted mb-3">{it.desc}</p>
            <button disabled className="text-[12.5px] text-accent opacity-60 cursor-not-allowed">
              {it.connected ? 'Manage' : 'Connect'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function WebhooksTab() {
  return (
    <div className="max-w-[920px]">
      <TabHeader title="Webhooks" description="Subscribe to workspace events." />
      <Section title="Endpoints">
        <div className="divide-y divide-border -my-2">
          {[
            { url: 'https://api.acme.com/hooks/spanlens', events: 4, status: 'active' },
            { url: 'https://hooks.zapier.com/...', events: 2, status: 'paused' },
          ].map((w) => (
            <div key={w.url} className="flex items-center justify-between py-3">
              <div>
                <div className="font-mono text-[12px] text-text truncate max-w-[400px]">{w.url}</div>
                <div className="text-[11px] text-text-faint mt-0.5">{w.events} event types subscribed</div>
              </div>
              <span
                className={cn(
                  'font-mono text-[10px] uppercase tracking-[0.04em] px-2 py-0.5 rounded-full border',
                  w.status === 'active'
                    ? 'border-good/20 bg-good-bg text-good'
                    : 'border-border bg-bg text-text-faint',
                )}
              >
                {w.status}
              </span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}

function OtelTab() {
  return (
    <div className="max-w-[920px]">
      <TabHeader title="OpenTelemetry" description="Export Spanlens traces to your existing OTel collector." />
      <Section title="OTLP endpoint">
        <FormRow label="Endpoint">
          <DemoInput value="https://api.spanlens.io/otel/v1/traces" mono />
        </FormRow>
        <FormRow label="Headers">
          <DemoInput value="Authorization: Bearer sl_live_…" mono />
        </FormRow>
      </Section>
    </div>
  )
}

function TabContent({ tab }: { tab: TabId }) {
  switch (tab) {
    case 'general': return <GeneralTab />
    case 'members': return <MembersTab />
    case 'security': return <SecurityTab />
    case 'audit-log': return <AuditLogTab />
    case 'system': return <SystemTab />
    case 'billing': return <BillingTab />
    case 'plan': return <PlanTab />
    case 'invoices': return <InvoicesTab />
    case 'profile': return <ProfileTab />
    case 'notifications': return <NotificationsTab />
    case 'preferences': return <PreferencesTab />
    case 'integrations': return <IntegrationsTab />
    case 'webhooks': return <WebhooksTab />
    case 'opentelemetry': return <OtelTab />
  }
}

function SettingsInner() {
  const searchParams = useSearchParams()
  const initialTab = (searchParams.get('tab') as TabId | null) ?? 'general'
  const [tab, setTab] = useState<TabId>(
    ALL_ITEMS.some((i) => i.id === initialTab) ? initialTab : 'general',
  )
  const active = ALL_ITEMS.find((i) => i.id === tab) ?? ALL_ITEMS[0]!

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col h-screen overflow-hidden">
      <div className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-border bg-bg-elev shrink-0">
        <span className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] shrink-0">Settings</span>
        <select
          value={tab}
          onChange={(e) => setTab(e.target.value as TabId)}
          className="flex-1 h-8 px-2 rounded-[6px] border border-border bg-bg text-[13px] text-text focus:outline-none focus:border-border-strong"
        >
          {NAV.map((group) => (
            <optgroup key={group.group} label={group.group}>
              {group.items.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="flex flex-1 overflow-hidden min-h-0">
        <aside className="hidden md:flex md:flex-col w-[260px] shrink-0 border-r border-border bg-bg-elev overflow-y-auto">
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

        <main className="flex-1 flex flex-col overflow-hidden">
          <Topbar crumbs={active.crumbs} />
          <div className="flex-1 overflow-y-auto bg-bg px-4 py-4 md:px-8 md:py-6">
            <TabContent tab={tab} />
          </div>
        </main>
      </div>
    </div>
  )
}

export default function DemoSettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsInner />
    </Suspense>
  )
}
