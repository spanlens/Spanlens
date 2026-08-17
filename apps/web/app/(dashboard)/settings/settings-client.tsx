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
    <>
      {/* The topbar is the only full-bleed row: it cancels the padding
          `DashboardContent` applies so its hairline spans the whole main
          column. Everything below sits flush inside that padding, which is
          also why the horizontal cancel isn't repeated further down —
          DashboardContent widens the left gutter while the sidebar is
          collapsed, and a blanket negative margin would eat that clearance.
          Mobile gets the tab picker in the right slot so there's no second
          header row. */}
      <div className="sticky top-0 z-30 -mx-4 -mt-4 md:-mx-7 md:-mt-5 bg-bg">
        <Topbar
          crumbs={active.crumbs}
          right={
            <div className="md:hidden min-w-[200px]">
              <Select value={tab} onValueChange={(v) => setTab(v as TabId)}>
                <SelectTrigger className="h-8 rounded-md text-[12.5px] font-sans">
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

      {/* Two cards side by side: the nav rail and the section stack. The rail
          used to be a full-height bordered <aside> flush against the viewport
          edge; v2 pulls it inside the content frame.

          `zoom` scales the whole settings body to 125%. Settings is denser than
          the other boards — long label/description pairs at 12.5px read small
          on a wide monitor — and zooming the rail together with the sections
          keeps the two cards at the same text scale. The global chrome
          (sidebar, topbar) deliberately stays at 100%.

          Two values inside have to be divided by the same factor, because
          viewport units resolve against the real viewport and are then scaled
          by the zoom: the rail's sticky offset and its max height. Change the
          factor here and those two follow. */}
      <div className="pt-4 md:pt-5 flex flex-col md:flex-row gap-4 items-start [zoom:1.25]">
        {/* Settings inner nav (desktop only — mobile uses the Topbar select) */}
        {/* top-[61.6px] and the max-height below are 77px and 100vh-160px
            divided by the 1.25 zoom on the wrapper, so the rail still sticks
            just under the topbar and still fits the screen. */}
        <aside className="hidden md:flex md:flex-col w-full md:w-[230px] shrink-0 md:sticky md:top-[61.6px] rounded-card border border-border bg-bg-elev shadow-card overflow-hidden">
          <div className="p-2.5 pb-1.5">
            <input
              type="text"
              value={navSearch}
              onChange={(e) => setNavSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setNavSearch('')
              }}
              placeholder="Filter settings…"
              className="w-full rounded-md border border-border bg-bg-elev px-3 py-2 text-[12.5px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors"
            />
          </div>

          <div className="px-2 pb-2 max-h-[calc((100vh-230px)/1.25)] overflow-y-auto">
            {filteredNav.length === 0 ? (
              <div className="px-2.5 py-2 text-[11.5px] text-text-faint">No matches.</div>
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
              href="/docs/features/settings"
              className="font-mono text-[11px] text-text-faint hover:text-text-muted transition-colors"
              title="Settings docs"
            >
              Docs →
            </Link>
          </div>
        </aside>

        {/* Section stack. A plain div, not <main>: the dashboard layout already
            renders the page's single main landmark, and nesting a second one
            leaves assistive tech with two "main" regions to choose between. */}
        <div className="flex-1 min-w-0 space-y-4">
          <TabContent tab={tab} />
        </div>
      </div>
    </>
  )
}
