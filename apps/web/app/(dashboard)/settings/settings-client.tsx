'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Topbar } from '@/components/layout/topbar'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { NAV, ALL_ITEMS, type TabId } from './_shared/nav'
// `general` is the tab the page opens on when no `?tab=` is present, so it
// stays a static import: no extra round-trip before the first paint.
import { GeneralTab } from './_sections/general-tab'

// Every other section is pulled only when its tab is selected. Each one is a
// separate route-level chunk, so /settings no longer ships all sixteen tabs
// (plus Paddle, recharts-free but query-heavy panels, and every dialog) in one
// bundle. ssr:false because these never render on the server for the default
// tab anyway, and it keeps the fallback deterministic across SSR/hydration
// (CLAUDE.md gotcha #22).
const TabFallback = () => <div className="h-[320px]" />

const MembersTab = dynamic(
  () => import('./_sections/members-tab').then((m) => m.MembersTab),
  { ssr: false, loading: TabFallback },
)
const SecurityTab = dynamic(
  () => import('./_sections/security-tab').then((m) => m.SecurityTab),
  { ssr: false, loading: TabFallback },
)
const AuditLogTab = dynamic(
  () => import('./_sections/audit-log-tab').then((m) => m.AuditLogTab),
  { ssr: false, loading: TabFallback },
)
const SystemTab = dynamic(
  () => import('./_sections/system-tab').then((m) => m.SystemTab),
  { ssr: false, loading: TabFallback },
)
const BillingTab = dynamic(
  () => import('./_sections/billing-tab').then((m) => m.BillingTab),
  { ssr: false, loading: TabFallback },
)
const PlanLimitsTab = dynamic(
  () => import('./_sections/plan-limits-tab').then((m) => m.PlanLimitsTab),
  { ssr: false, loading: TabFallback },
)
const InvoicesTab = dynamic(
  () => import('./_sections/invoices-tab').then((m) => m.InvoicesTab),
  { ssr: false, loading: TabFallback },
)
const ProfileTab = dynamic(
  () => import('./_sections/profile-tab').then((m) => m.ProfileTab),
  { ssr: false, loading: TabFallback },
)
const SignInMethodsTab = dynamic(
  () => import('./_sections/sign-in-methods-tab').then((m) => m.SignInMethodsTab),
  { ssr: false, loading: TabFallback },
)
const NotificationsTab = dynamic(
  () => import('./_sections/notifications-tab').then((m) => m.NotificationsTab),
  { ssr: false, loading: TabFallback },
)
const PreferencesTab = dynamic(
  () => import('./_sections/preferences-tab').then((m) => m.PreferencesTab),
  { ssr: false, loading: TabFallback },
)
const IntegrationsTab = dynamic(
  () => import('./_sections/integrations-tab').then((m) => m.IntegrationsTab),
  { ssr: false, loading: TabFallback },
)
const DestinationsTab = dynamic(
  () => import('./_sections/destinations-tab').then((m) => m.DestinationsTab),
  { ssr: false, loading: TabFallback },
)
const WebhooksTab = dynamic(
  () => import('./_sections/webhooks-tab').then((m) => m.WebhooksTab),
  { ssr: false, loading: TabFallback },
)
const OpenTelemetryTab = dynamic(
  () => import('./_sections/opentelemetry-tab').then((m) => m.OpenTelemetryTab),
  { ssr: false, loading: TabFallback },
)

// ─── tab renderer ─────────────────────────────────────────────────────────────

function TabContent({ tab }: { tab: TabId }) {
  switch (tab) {
    case 'general':       return <GeneralTab />
    case 'members':       return <MembersTab />
    case 'security':      return <SecurityTab />
    case 'audit-log':     return <AuditLogTab />
    case 'system':        return <SystemTab />
    case 'billing':       return <BillingTab />
    case 'plan':          return <PlanLimitsTab />
    case 'invoices':      return <InvoicesTab />
    case 'profile':       return <ProfileTab />
    case 'auth-methods':  return <SignInMethodsTab />
    case 'notifications': return <NotificationsTab />
    case 'preferences':   return <PreferencesTab />
    case 'integrations':  return <IntegrationsTab />
    case 'destinations':  return <DestinationsTab />
    case 'webhooks':      return <WebhooksTab />
    case 'opentelemetry': return <OpenTelemetryTab />
  }
}

// ─── page ─────────────────────────────────────────────────────────────────────

export function SettingsClient() {
  const searchParams = useSearchParams()
  const initialTab = (searchParams.get('tab') as TabId | null) ?? 'general'
  const [tab, setTab] = useState<TabId>(
    ALL_ITEMS.some((i) => i.id === initialTab) ? initialTab : 'general',
  )
  const active = ALL_ITEMS.find((i) => i.id === tab) ?? ALL_ITEMS[0]!

  // Inner-nav search/filter. Empty input shows the full grouped nav.
  const [navSearch, setNavSearch] = useState('')
  const filteredNav = useMemo(() => {
    if (!navSearch.trim()) return NAV
    const needle = navSearch.toLowerCase()
    return NAV
      .map((g) => ({
        ...g,
        items: g.items.filter((i) =>
          i.label.toLowerCase().includes(needle) ||
          g.group.toLowerCase().includes(needle),
        ),
      }))
      .filter((g) => g.items.length > 0)
  }, [navSearch])

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col min-h-screen">
      {/* Sticky Topbar at the true viewport top. Mobile gets the tab
          picker in the right slot so there's no second header row. */}
      <div className="sticky top-0 z-30 bg-bg">
        <Topbar
          crumbs={active.crumbs}
          right={
            <div className="md:hidden min-w-[200px]">
              <Select value={tab} onValueChange={(v) => setTab(v as TabId)}>
                <SelectTrigger className="h-8 rounded-[6px] text-[12.5px] font-sans">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NAV.map((group) => (
                    <SelectGroup key={group.group}>
                      <SelectLabel>{group.group}</SelectLabel>
                      {group.items.map((item) => (
                        <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
          }
        />
      </div>

      {/* Body: sidebar + content */}
      <div className="flex flex-1 min-h-0">
        {/* Settings inner nav (desktop only) */}
        <aside className="hidden md:flex md:flex-col w-[260px] shrink-0 border-r border-border bg-bg-elev sticky top-[52px] self-start max-h-[calc(100vh-52px)] overflow-y-auto">
          <div className="px-5 py-4 font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] flex items-center justify-between">
            <span>Settings</span>
            <Link
              href="/docs/features/settings"
              className="text-[10px] text-text-faint hover:text-text-muted transition-colors normal-case tracking-normal"
              title="Settings docs"
            >
              Docs →
            </Link>
          </div>
          {/* Nav search */}
          <div className="px-3 pb-3">
            <input
              type="text"
              value={navSearch}
              onChange={(e) => setNavSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setNavSearch('')
              }}
              placeholder="Filter settings…"
              className="w-full px-2 py-1.5 font-mono text-[11.5px] bg-bg border border-border rounded-[5px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong"
            />
          </div>
          {filteredNav.length === 0 ? (
            <div className="px-5 py-2 font-mono text-[11px] text-text-faint">No matches.</div>
          ) : (
            filteredNav.map((group) => (
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
            ))
          )}
        </aside>

        {/* Content area */}
        <main className="flex-1 min-w-0">
          <div className="bg-bg px-4 py-4 md:px-8 md:py-6">
            <TabContent tab={tab} />
          </div>
        </main>
      </div>
    </div>
  )
}
