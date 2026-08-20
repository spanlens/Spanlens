'use client'
import { useMemo, useState, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { cn } from '@/lib/utils'

type TabId =
  | 'general' | 'members' | 'security' | 'audit-log' | 'system'
  | 'billing' | 'plan' | 'invoices'
  | 'profile' | 'auth-methods' | 'notifications' | 'preferences'
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
      { id: 'profile', label: 'Profile', crumbs: [{ label: 'Demo' }, { label: 'Settings' }, { label: 'Profile' }] },
      { id: 'auth-methods', label: 'Sign-in methods', crumbs: [{ label: 'Demo' }, { label: 'Settings' }, { label: 'Sign-in methods' }] },
      { id: 'notifications', label: 'Notifications', crumbs: [{ label: 'Demo' }, { label: 'Settings' }, { label: 'Notifications' }] },
      { id: 'preferences', label: 'Preferences', crumbs: [{ label: 'Demo' }, { label: 'Settings' }, { label: 'Preferences' }] },
    ],
  },
  {
    group: 'Connect',
    items: [
      { id: 'integrations', label: 'Integrations', crumbs: [{ label: 'Demo' }, { label: 'Settings' }, { label: 'Integrations' }] },
      { id: 'webhooks', label: 'Webhooks', crumbs: [{ label: 'Demo' }, { label: 'Settings' }, { label: 'Webhooks' }] },
      { id: 'opentelemetry', label: 'OpenTelemetry', crumbs: [{ label: 'Demo' }, { label: 'Settings' }, { label: 'OpenTelemetry' }] },
    ],
  },
]

const ALL_ITEMS = NAV.flatMap((g) => g.items)

// Mirrors the live settings page's v2 ramp: the breadcrumb names the page and
// each section card carries its own title, so this dropped from a 26px page
// heading to the card-title ramp.
// Eyebrow ramp, not the card-title ramp: the section cards below already carry
// 13.5px SemiBold titles, and on tabs whose first card shares this name the two
// would read as one duplicated title.
function TabHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-4">
      <h1 className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-faint">{title}</h1>
      <p className="text-[12.5px] text-text-muted mt-1">{description}</p>
    </div>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-border bg-bg-elev shadow-card overflow-hidden mb-4">
      <div className="px-5 py-[18px] border-b border-border">
        <h2 className="text-[13.5px] font-semibold text-text">{title}</h2>
        {description && <p className="text-[11.5px] text-text-muted mt-0.5">{description}</p>}
      </div>
      <div className="px-5">{children}</div>
    </div>
  )
}

function FormRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-3 md:gap-6 py-3.5 border-b border-border last:border-b-0 items-center">
      <div>
        <div className="text-[12.5px] text-text font-medium">{label}</div>
        {hint && <div className="text-[11.5px] text-text-muted mt-0.5">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  )
}

/** Pill ramps from the D17 board, matching the live settings page. */
const PILL_SECONDARY = 'rounded-full border border-border bg-bg-elev px-3.5 py-2 text-[12px] font-medium text-text'
const PILL_PRIMARY = 'rounded-full bg-text px-3.5 py-2 text-[12px] font-medium text-bg'

function DemoInput({ value, mono }: { value: string; mono?: boolean }) {
  return (
    <input
      value={value}
      disabled
      readOnly
      className={cn(
        'rounded-md border border-border bg-bg-elev px-3 py-2 text-[12.5px] text-text-muted w-full max-w-[460px] cursor-not-allowed',
        mono && 'font-mono text-[12px]',
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
        on ? 'bg-accent' : 'bg-track',
      )}
    >
      <span
        className={cn(
          'inline-block h-3.5 w-3.5 rounded-full bg-bg-elev transition-transform',
          on ? 'translate-x-[18px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  )
}

function GeneralTab() {
  return (
    <div>
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
    <div>
      <TabHeader title="Members" description="Invite teammates and manage roles." />
      <Section title="Invite member">
        <FormRow label="Email">
          <div className="flex gap-2 max-w-[460px]">
            <DemoInput value="teammate@example.com" />
            <button disabled className={cn(PILL_PRIMARY, 'shrink-0 opacity-60 cursor-not-allowed')}>
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
                <div className="text-[12.5px] text-text">{m.email}</div>
                <div className="text-[11px] text-text-faint mt-0.5">Joined {m.joined}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center rounded-full px-2 py-[3px] font-mono text-[10.5px] bg-bg-chip text-text-muted">
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
    <div>
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
            <span className="inline-flex items-center rounded-full px-2 py-[3px] font-mono text-[10.5px] bg-good-bg text-good">Email</span>
            <span className="inline-flex items-center rounded-full px-2 py-[3px] font-mono text-[10.5px] bg-good-bg text-good">Google</span>
            <span className="inline-flex items-center rounded-full px-2 py-[3px] font-mono text-[10.5px] bg-bg-chip text-text-faint">GitHub</span>
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
    <div>
      <TabHeader title="Audit log" description="Workspace activity from the last 90 days." />
      <div className="rounded-card border border-border bg-bg-elev shadow-card overflow-hidden">
        <div className="grid grid-cols-[150px_1fr_180px_80px] gap-4 bg-bg-muted px-[18px] py-2.5 border-b border-border font-mono text-[10px] uppercase tracking-[0.1em] text-text-faint">
          <span>Time</span>
          <span>Actor</span>
          <span>Action</span>
          <span>Severity</span>
        </div>
        {logs.map((l, i) => (
          <div key={i} className="grid grid-cols-[150px_1fr_180px_80px] gap-4 px-[18px] py-3 border-b border-border last:border-b-0 items-center">
            <span className="font-mono text-[11.5px] text-text-muted">{l.time}</span>
            <span className="text-[12.5px] text-text truncate">{l.actor}</span>
            <span className="font-mono text-[11.5px] text-text-muted">{l.action}</span>
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-[3px] font-mono text-[10.5px] w-fit',
                l.sev === 'high' && 'bg-accent-bg text-accent',
                l.sev === 'med' && 'bg-bg-chip text-text-muted',
                l.sev === 'low' && 'bg-bg-chip text-text-faint',
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
    <div>
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
                <div className="text-[12.5px] text-text">{j.name}</div>
                <div className="text-[11px] text-text-faint mt-0.5">Runs {j.cadence}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[11px] text-text-muted">last: {j.last}</span>
                <span className="inline-flex items-center rounded-full px-2 py-[3px] font-mono text-[10.5px] bg-good-bg text-good">healthy</span>
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
    <div>
      <TabHeader title="Billing" description="Payment method and billing contact." />
      <Section title="Payment method">
        <FormRow label="Card on file">
          <div className="text-[12.5px] text-text-muted">No card on file (Free plan)</div>
        </FormRow>
        <FormRow label="Billing email">
          <DemoInput value="billing@acme.com" />
        </FormRow>
      </Section>
      <Section title="Plan">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13.5px] font-semibold text-text">Free</div>
            <div className="text-[11.5px] text-text-muted mt-0.5">2,400 of 50,000 requests this month</div>
          </div>
          <button disabled className="rounded-full bg-accent px-3.5 py-2 text-[12px] font-medium text-accent-fg opacity-60 cursor-not-allowed">
            Upgrade to Pro
          </button>
        </div>
      </Section>
    </div>
  )
}

function PlanTab() {
  return (
    <div>
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
              'rounded-card border p-5 shadow-card',
              p.cur ? 'border-accent-border bg-accent-bg' : 'border-border bg-bg-elev',
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[13.5px] font-semibold text-text">{p.name}</h3>
              {p.cur && (
                <span className="inline-flex items-center rounded-full px-2 py-[3px] font-mono text-[10.5px] bg-accent-bg text-accent">
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
    <div>
      <TabHeader title="Invoices" description="Past invoices and download links." />
      <div className="rounded-card border border-border bg-bg-elev shadow-card overflow-hidden">
        <div className="grid grid-cols-[120px_1fr_120px_100px] gap-4 bg-bg-muted px-[18px] py-2.5 border-b border-border font-mono text-[10px] uppercase tracking-[0.1em] text-text-faint">
          <span>Date</span>
          <span>Description</span>
          <span>Amount</span>
          <span>Status</span>
        </div>
        {[
          { date: '2026-05-01', desc: 'No invoices on Free plan', amount: '—', status: '—' },
        ].map((inv, i) => (
          <div key={i} className="grid grid-cols-[120px_1fr_120px_100px] gap-4 px-[18px] py-3 items-center">
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
    <div>
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
          <button disabled className={cn(PILL_SECONDARY, 'opacity-60 cursor-not-allowed')}>
            Send reset email
          </button>
        </FormRow>
      </Section>
    </div>
  )
}

function SignInMethodsTab() {
  const providers = [
    { label: 'Google', glyph: 'G', connected: true, lastUsed: 'May 21, 2026' },
    { label: 'GitHub', glyph: '⌥', connected: false, lastUsed: null as string | null },
  ]
  return (
    <div>
      <TabHeader
        title="Sign-in methods"
        description="Manage how you sign in to Spanlens. Connect multiple providers to the same account, then sign in with any of them."
      />
      <Section title="Linked providers">
        <FormRow label="Email">
          <div className="flex items-center justify-between gap-3 max-w-[460px]">
            <div className="font-mono text-[12.5px] text-text">haeseong@acme.com</div>
            <span className="inline-flex items-center rounded-full px-2 py-[3px] font-mono text-[10.5px] bg-accent-bg text-accent">Primary</span>
          </div>
        </FormRow>
        {providers.map((p) => (
          <FormRow key={p.label} label={p.label}>
            <div className="flex items-center justify-between gap-3 max-w-[460px]">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-[18px] h-[18px] rounded-[4px] bg-bg-muted flex items-center justify-center font-mono text-[10px] text-text-muted font-bold shrink-0">
                  {p.glyph}
                </span>
                {p.connected ? (
                  <span className="inline-flex items-center rounded-full px-2 py-[3px] font-mono text-[10.5px] bg-good-bg text-good">
                    Connected{p.lastUsed ? ` · last used ${p.lastUsed}` : ''}
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full px-2 py-[3px] font-mono text-[10.5px] bg-bg-chip text-text-faint">
                    Not connected
                  </span>
                )}
              </div>
              <button
                disabled
                title="Disabled in demo"
                className={cn(PILL_SECONDARY, 'shrink-0 opacity-60 cursor-not-allowed')}
              >
                {p.connected ? 'Disconnect' : 'Connect'}
              </button>
            </div>
          </FormRow>
        ))}
      </Section>
      <Section title="Why connect multiple providers?">
        <div className="text-[12.5px] text-text-muted leading-relaxed space-y-2">
          <p>
            One account, multiple ways in. Connect Google or GitHub to sign in faster the
            next time and keep email as a fallback if a provider is unavailable.
          </p>
          <p>
            Spanlens never receives your provider password. Disconnecting a provider
            removes its OAuth token from this account immediately and cannot be undone
            from the provider&apos;s side.
          </p>
        </div>
      </Section>
    </div>
  )
}

function NotificationsTab() {
  return (
    <div>
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
    <div>
      <TabHeader title="Preferences" description="Personal UI preferences." />
      <Section title="Appearance">
        <FormRow label="Theme">
          <div className="flex gap-2">
            <span className="inline-flex items-center rounded-full px-2 py-[3px] font-mono text-[10.5px] bg-bg-chip text-text-muted">Light</span>
            <span className="inline-flex items-center rounded-full px-2 py-[3px] font-mono text-[10.5px] bg-bg-chip text-text-muted">Dark</span>
            <span className="inline-flex items-center rounded-full px-2 py-[3px] font-mono text-[10.5px] bg-accent-bg text-accent">System</span>
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
    <div>
      <TabHeader title="Integrations" description="Connect Spanlens to your existing stack." />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {ints.map((it) => (
          <div key={it.name} className="rounded-card border border-border bg-bg-elev shadow-card p-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[13.5px] font-semibold text-text">{it.name}</h3>
              {it.connected ? (
                <span className="inline-flex items-center rounded-full px-2 py-[3px] font-mono text-[10.5px] bg-good-bg text-good">connected</span>
              ) : (
                <span className="inline-flex items-center rounded-full px-2 py-[3px] font-mono text-[10.5px] bg-bg-chip text-text-faint">not connected</span>
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
    <div>
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
                  'inline-flex items-center rounded-full px-2 py-[3px] font-mono text-[10.5px]',
                  w.status === 'active'
                    ? 'bg-good-bg text-good'
                    : 'bg-bg-chip text-text-faint',
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
    <div>
      <TabHeader title="OpenTelemetry" description="Export Spanlens traces to your existing OTel collector." />
      <Section title="OTLP endpoint">
        <FormRow label="Endpoint">
          <DemoInput value="https://api.spanlens.io/v1/traces" mono />
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
    case 'auth-methods': return <SignInMethodsTab />
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
  const [navSearch, setNavSearch] = useState('')
  const active = ALL_ITEMS.find((i) => i.id === tab) ?? ALL_ITEMS[0]!

  const filteredNav = useMemo(() => {
    const q = navSearch.trim().toLowerCase()
    if (!q) return NAV
    return NAV
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) => item.label.toLowerCase().includes(q) || group.group.toLowerCase().includes(q),
        ),
      }))
      .filter((group) => group.items.length > 0)
  }, [navSearch])

  return (
    <>
      {/* The topbar is the only full-bleed row: it cancels the demo layout's
          content padding so its hairline spans the whole main column.
          Everything below sits flush inside that padding. */}
      <div className="sticky top-0 z-20 -mx-4 -mt-4 md:-mx-7 md:-mt-5 bg-bg">
        <Topbar
          crumbs={active.crumbs}
          right={
            <div className="md:hidden">
              <select
                value={tab}
                onChange={(e) => setTab(e.target.value as TabId)}
                className="rounded-md border border-border bg-bg-elev px-3 py-2 text-[12.5px] font-medium text-text focus:outline-none focus:border-border-strong"
                aria-label="Select settings tab"
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
          }
        />
      </div>

      {/* Two cards side by side: the nav rail and the section stack, matching
          the live /settings shell. */}
      {/* 125% zoom, matching the real settings screen. The rail's sticky offset
          and max height below are divided by the same factor because viewport
          units resolve against the real viewport and are then scaled. */}
      <div className="pt-4 md:pt-5 flex flex-col md:flex-row gap-4 items-start [zoom:1.25]">
        <aside className="hidden md:flex md:flex-col w-full md:w-[230px] shrink-0 md:sticky md:top-[61.6px] rounded-card border border-border bg-bg-elev shadow-card overflow-hidden">
          <div className="p-2.5 pb-1.5">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-faint" />
              <input
                value={navSearch}
                onChange={(e) => setNavSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setNavSearch('')
                }}
                placeholder="Filter settings…"
                className="w-full rounded-md border border-border bg-bg-elev pl-8 pr-3 py-2 text-[12.5px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors"
              />
            </div>
          </div>

          <div className="px-2 pb-2 max-h-[calc((100vh-230px)/1.25)] overflow-y-auto">
            {filteredNav.length === 0 ? (
              <div className="px-2.5 py-2 text-[11.5px] text-text-faint">No settings match</div>
            ) : (
              filteredNav.map((group) => (
                <div key={group.group} className="mb-2 last:mb-0">
                  <div className="px-2.5 pt-2.5 pb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-text-faint">
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
                          'w-full text-left rounded-md px-2.5 py-2 text-[12.5px] transition-colors',
                          isActive
                            ? 'bg-bg-muted text-text font-medium'
                            : 'text-text-muted hover:text-text hover:bg-bg-muted',
                        )}
                      >
                        {item.label}
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>

          <div className="border-t border-border px-3 py-2.5">
            <Link
              href="/docs"
              className="font-mono text-[11px] text-text-faint hover:text-text-muted transition-colors"
            >
              Docs →
            </Link>
          </div>
        </aside>

        {/* A plain div, not <main>: the demo layout already renders the page's
            single main landmark. */}
        <div className="flex-1 min-w-0">
          <TabContent tab={tab} />
        </div>
      </div>
    </>
  )
}

export default function DemoSettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsInner />
    </Suspense>
  )
}
