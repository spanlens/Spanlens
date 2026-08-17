'use client'
import Image from 'next/image'
import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTheme } from '@/components/providers/theme-provider'
import {
  Sun, Moon, Monitor, X, PanelLeftClose, TriangleAlert, LogOut,
  LayoutDashboard, ArrowLeftRight, Waypoints, MessagesSquare, Users,
  Activity, ShieldCheck, PiggyBank, FileText, ClipboardCheck, Database,
  FlaskConical, Bell, Highlighter, KeyRound, Link2, Settings, BookOpen,
  ChevronDown, MessageSquarePlus,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { clearQueryClient } from '@/lib/query-client'
import { useStatsOverview } from '@/lib/queries/use-stats'
import { useQuota } from '@/lib/queries/use-billing'
import { formatPlanLabel } from '@/lib/billing-plans'
import { useSidebar } from '@/lib/sidebar-context'
import { useAnomalies } from '@/lib/queries/use-anomalies'
import { useAlerts } from '@/lib/queries/use-alerts'
import { useRecommendations } from '@/lib/queries/use-recommendations'
import { useStaleKeyCounts } from '@/lib/queries/use-stale-keys'
import { useIsAdmin } from '@/lib/queries/use-current-role'
import { useOrganization } from '@/lib/queries/use-organization'
import { useWorkspaces, useCreateWorkspace } from '@/lib/queries/use-workspaces'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { writeWorkspaceCookie } from '@/lib/workspace-cookie'
import { clearWelcomeStash } from '@/lib/welcome-stash'

// Unified compact request-count formatter so the "used / limit" pair always
// uses the same unit. Picks the largest unit that keeps the larger of the
// two numbers under 1000 — avoids the "1,120 / 1000k" mismatch where one
// side was raw and the other abbreviated.
function formatRequestCount(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000
    return m >= 10 ? `${m.toFixed(0)}M` : `${m.toFixed(1)}M`
  }
  if (n >= 1_000) {
    const k = n / 1_000
    return k >= 10 ? `${k.toFixed(0)}k` : `${k.toFixed(1)}k`
  }
  return n.toLocaleString()
}

/* ── Logo mark ── */
function LogoMark() {
  return (
    <Link
      href="/"
      aria-label="Spanlens home"
      className="flex items-center gap-2 pl-1.5 hover:opacity-80 transition-opacity"
    >
      <Image src="/icon.png" alt="Spanlens" width={20} height={20} className="shrink-0 rounded-md" priority />
      <span className="font-display text-[15px] tracking-[-0.02em] text-text">
        spanlens
      </span>
    </Link>
  )
}

/* ── Workspace switcher ──
 *
 * Switches between workspaces by writing the `sb-ws` cookie and doing a full
 * page reload so middleware/authJwt pick up the new scope and TanStack caches
 * start fresh. Project scope is always "All projects" (null) — project
 * filtering is done per-page, not here.
 */
function WorkspaceSwitcher() {
  const org = useOrganization()
  const workspaces = useWorkspaces()
  const createWorkspace = useCreateWorkspace()
  const [open, setOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newError, setNewError] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [open])

  function switchWorkspace(id: string) {
    if (id === org.data?.id) { setOpen(false); return }
    setOpen(false)
    writeWorkspaceCookie(id)

    // Visual feedback during the hard reload.
    // WorkspaceSwitchOverlay listens for this event and renders a top
    // progress bar + dim layer for the duration of the SSR round-trip.
    window.dispatchEvent(new CustomEvent('spanlens:workspace-switching'))

    // Double rAF so the browser actually paints the overlay BEFORE we
    // navigate away. A single rAF only schedules a paint; the second one
    // runs after layout/paint commits, guaranteeing the user sees the
    // transition UI rather than a frozen-then-blank flash.
    //
    // Hard reload (not router.push) is required so SSR middleware re-resolves
    // the workspace and every TanStack query starts fresh. See CLAUDE.md
    // gotcha #15 — router.push would keep the RSC tree cache and miss the
    // new x-spanlens-organization header.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.location.href = '/dashboard'
      })
    })
  }

  async function handleCreateWorkspace(e: React.FormEvent) {
    e.preventDefault()
    setNewError('')
    const trimmed = newName.trim()
    if (!trimmed) return
    try {
      const created = await createWorkspace.mutateAsync(trimmed)
      // Switch to the new workspace — cookie + hard reload mirrors the
      // existing switch path so there's exactly one code path for "active
      // workspace changed".
      writeWorkspaceCookie(created.id)
      window.dispatchEvent(new CustomEvent('spanlens:workspace-switching'))
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.location.href = '/dashboard'
        })
      })
    } catch (err) {
      setNewError(err instanceof Error ? err.message : 'Failed to create workspace')
    }
  }

  const orgName = org.data?.name ?? 'workspace'
  const allWorkspaces = workspaces.data ?? []

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Switch workspace"
        className="w-full h-9 flex items-center justify-between gap-2 px-[10px] rounded-md border border-border bg-bg-elev hover:border-border-strong transition-colors"
      >
        <span className="flex min-w-0 items-center gap-2">
          {/* Initial-only avatar: the workspace name is right next to it, so the
              tile is decorative and carries no accessible text of its own. */}
          <span
            aria-hidden="true"
            className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-chip bg-text text-[10px] font-semibold text-bg"
          >
            {orgName.charAt(0).toUpperCase()}
          </span>
          <span className="truncate text-[13px] font-medium text-text">{orgName}</span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-faint" aria-hidden="true" />
      </button>
      {open && (
        <div
          className="absolute left-0 right-0 mt-1 z-20 rounded-[6px] border border-border-strong bg-bg-elev shadow-lg overflow-hidden"
          role="menu"
        >
          {/* Workspaces section: always renders the list, even with a
              single workspace, so the user sees "I am here" instead of an
              empty list with just a "+ New workspace" button (which used to
              read as "my workspace disappeared"). The current workspace
              shows a check mark; switching is a no-op when only one exists. */}
          <div className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-text-faint px-[10px] pt-[7px] pb-[3px]">
            Workspaces
          </div>
          {allWorkspaces.map((w) => {
            const selected = w.id === org.data?.id
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => switchWorkspace(w.id)}
                className={cn(
                  'w-full text-left px-[10px] py-[6px] text-[12px] font-mono transition-colors flex items-center justify-between',
                  selected ? 'bg-bg-muted text-text' : 'text-text-muted hover:bg-bg-muted hover:text-text',
                )}
                role="menuitem"
              >
                <span className="truncate">
                  {w.name}{' '}
                  <span className="text-text-faint">· {w.role}</span>
                </span>
                {selected && <span className="text-accent ml-2">✓</span>}
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => { setOpen(false); setNewName(''); setNewError(''); setNewOpen(true) }}
            className="w-full text-left px-[10px] py-[6px] text-[12px] font-mono text-text-faint hover:bg-bg-muted hover:text-text transition-colors"
            role="menuitem"
          >
            + New workspace
          </button>
        </div>
      )}

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create workspace</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void handleCreateWorkspace(e)} className="mt-3 space-y-3">
            <div>
              <label className="block text-[12px] text-text-muted mb-1.5">Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Acme Inc."
                autoFocus
                required
                className="w-full px-3 py-2 border border-border-strong rounded-[6px] bg-bg text-[13px] outline-none focus:border-accent"
              />
              <p className="text-[11.5px] text-text-faint mt-1.5">
                Creates a new isolated workspace with its own projects, keys, and billing.
              </p>
            </div>
            {newError && <p className="text-[12.5px] text-bad">{newError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setNewOpen(false)}
                className="font-mono text-[11.5px] px-3 py-[5px] border border-border rounded-[5px] text-text-muted hover:text-text transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createWorkspace.isPending || !newName.trim()}
                className="font-mono text-[11.5px] px-3 py-[5px] rounded-[5px] bg-text text-bg font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {createWorkspace.isPending ? 'Creating…' : 'Create'}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/* ── Nav groups ──
 *
 * The Figma sidebar carries a 13px glyph in front of every label, which is
 * what makes the collapsed groups readable at a glance. The icon is decorative
 * (the label is always visible next to it), so each one is aria-hidden.
 */
type NavItem = { href: string; label: string; icon: LucideIcon }

const NAV_GROUPS: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [
      { href: '/dashboard',  label: 'Dashboard', icon: LayoutDashboard },
      { href: '/requests',   label: 'Requests',  icon: ArrowLeftRight },
      { href: '/traces',     label: 'Traces',    icon: Waypoints },
      { href: '/sessions',   label: 'Sessions',  icon: MessagesSquare },
      { href: '/users',      label: 'Users',     icon: Users },
    ],
  },
  {
    label: 'Observe',
    items: [
      { href: '/anomalies',  label: 'Anomalies', icon: Activity },
      { href: '/security',   label: 'Security',  icon: ShieldCheck },
      { href: '/savings',    label: 'Savings',   icon: PiggyBank },
    ],
  },
  {
    label: 'Build',
    items: [
      { href: '/prompts',     label: 'Prompts',     icon: FileText },
      { href: '/evals',       label: 'Evals',       icon: ClipboardCheck },
      { href: '/datasets',    label: 'Datasets',    icon: Database },
      { href: '/experiments', label: 'Experiments', icon: FlaskConical },
      { href: '/alerts',      label: 'Alerts',      icon: Bell },
    ],
  },
  {
    label: 'Review',
    items: [
      { href: '/annotation', label: 'Annotation', icon: Highlighter },
    ],
  },
  {
    label: 'Admin',
    items: [
      { href: '/projects',  label: 'Projects & Keys', icon: KeyRound },
      // Public share tokens live in the same Admin section as API keys —
      // both are externally-issued credentials with the same operator
      // workflow (list / inspect / revoke). Sitting them next to each
      // other keeps the leak-audit flow ("rotate the key, revoke the
      // share") one cursor move apart.
      { href: '/shares',    label: 'Shared links', icon: Link2 },
      { href: '/settings',  label: 'Settings',     icon: Settings },
      { href: '/docs',      label: 'Docs',         icon: BookOpen },
    ],
  },
]

/* ── Theme toggle ──
 *
 * A three-way segmented pill, matching the sidebar footer in Figma. It
 * replaces the old cycling button: the same three values are still written
 * through `setTheme`, but each one is now reachable in a single click and the
 * current value is visible without reading a label.
 */
type ThemeOption = 'system' | 'light' | 'dark'

const THEME_OPTIONS: { value: ThemeOption; label: string; Icon: LucideIcon }[] = [
  { value: 'light', label: 'Light theme', Icon: Sun },
  { value: 'dark', label: 'Dark theme', Icon: Moon },
  { value: 'system', label: 'Match system theme', Icon: Monitor },
]

function ThemeToggleButton() {
  const { theme, setTheme } = useTheme()
  const current = (theme ?? 'system') as ThemeOption

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex items-center gap-[2px] rounded-full bg-bg-chip p-[3px]"
    >
      {THEME_OPTIONS.map(({ value, label, Icon }) => {
        const selected = current === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={cn(
              'flex h-5 w-5 items-center justify-center rounded-full transition-colors',
              selected
                ? 'bg-bg-elev text-text shadow-card'
                : 'text-text-faint hover:text-text-muted',
            )}
          >
            <Icon className="h-3 w-3" aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const overview = useStatsOverview({ hours: 24, compare: true })
  const isAdmin = useIsAdmin()
  const anomalies = useAnomalies({ observationHours: 24 })
  const alerts = useAlerts()
  const recommendations = useRecommendations({ hours: 24 })
  const staleKeys = useStaleKeyCounts()
  const { isOpen, close, isCollapsed, toggleCollapsed } = useSidebar()
  // Capture "now" once at mount — drives the "firing in last hour" badge.
  // Tanstack query refetches refresh `alerts.data`, so a fixed anchor here
  // is fine for the small UI sliver this affects.
  const [mountNow] = useState(() => Date.now())

  // Close sidebar when navigating on mobile
  useEffect(() => {
    close()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  const quota = useQuota()

  const reqCount = overview.data?.totalRequests
  const anomalyCount = (anomalies.data?.data ?? []).length
  // Firing = active rule whose last_triggered_at is within the past hour.
  // Matches the Firing group on the Alerts page.
  const firingCount = (alerts.data ?? []).filter(
    (a) =>
      a.is_active &&
      a.last_triggered_at &&
      mountNow - new Date(a.last_triggered_at).getTime() < 60 * 60 * 1000,
  ).length
  const savingsTotal = (recommendations.data ?? []).reduce((s, r) => s + r.estimatedMonthlySavingsUsd, 0)

  // `aria` spells out what the badge means so screen-reader users are not
  // left decoding a bare number whose severity is otherwise carried by hue.
  const BADGES: Record<string, { label?: string; warn?: boolean; aria?: string }> = {
    '/requests':   reqCount != null ? {
      label: reqCount > 999 ? (reqCount / 1000).toFixed(0) + 'k' : String(reqCount),
      aria: `${reqCount} requests in the last 24 hours`,
    } : {},
    '/anomalies':  anomalyCount > 0 ? {
      label: String(anomalyCount),
      warn: true,
      aria: `${anomalyCount} active ${anomalyCount === 1 ? 'anomaly' : 'anomalies'}`,
    } : {},
    '/security':   {},
    '/savings': savingsTotal > 0 ? {
      label: '$' + (savingsTotal >= 1000 ? (savingsTotal / 1000).toFixed(0) + 'k' : savingsTotal.toFixed(0)),
      aria: `estimated savings of $${savingsTotal.toFixed(0)} per month available`,
    } : {},
    '/alerts':     firingCount > 0 ? {
      label: String(firingCount),
      warn: true,
      aria: `${firingCount} firing ${firingCount === 1 ? 'alert' : 'alerts'}`,
    } : {},
    // Sum stale + revoke so the badge surfaces both tiers in one glance.
    // We don't separate them here — the dashboard "Needs Attention" card
    // and the in-row badges on /projects already split them.
    '/projects':   staleKeys.revoke + staleKeys.stale > 0
      ? {
          label: String(staleKeys.revoke + staleKeys.stale),
          warn: staleKeys.revoke > 0,
          aria: `${staleKeys.revoke + staleKeys.stale} API ${staleKeys.revoke + staleKeys.stale === 1 ? 'key needs' : 'keys need'} attention`,
        }
      : {},
  }

  async function handleSignOut() {
    // Wipe the post-signup welcome stash before tearing down the auth
    // session. If the user signed up, never opened /dashboard (so the
    // banner never consumed the stash) and then logged out, the next
    // person to sign in on the same browser tab would otherwise see the
    // previous user's sl_live_ key on /dashboard. See lib/welcome-stash.ts.
    clearWelcomeStash()
    const supabase = createClient()
    await supabase.auth.signOut()
    // Drop the previous account's TanStack cache. The browser QueryClient is a
    // singleton that survives navigation and query keys don't include orgId, so
    // without this the next account to sign in on this tab would render account
    // A's cached stats / quota / org name until staleTime elapses.
    clearQueryClient()
    // Hard nav (not router.push) so the next session boots in a fresh JS
    // context with fully re-evaluated middleware. See CLAUDE.md gotcha #15.
    window.location.href = '/login'
  }

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={close}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          // Base. The sidebar is the one band surface in the dashboard: the
          // page and every card are white, so the band is what reads as chrome.
          'flex flex-col bg-bg-muted border-r border-border',
          // Mobile: fixed overlay drawer. `inset-y-0` already pins to the
          // full viewport height, so no `h-screen` here — on desktop the
          // sidebar lives inside the dashboard's `[zoom:1.25]` wrapper whose
          // height is `100vh/1.25`, and an explicit `h-screen` would overflow
          // that parent by 25% and hide the Plan widget / Feedback / Theme /
          // Sign out at the bottom. The flex parent gives us the height we need.
          'fixed inset-y-0 left-0 z-50 w-[272px]',
          'transition-transform duration-200 ease-in-out',
          isOpen ? 'translate-x-0' : '-translate-x-full',
          // Desktop: back in flow at the 232px the Figma board specifies.
          // Width animates between full and hidden (w-0) so the "hide sidebar"
          // toggle collapses it smoothly; overflow-hidden clips the content
          // while it's at zero width.
          'md:relative md:shrink-0 md:translate-x-0',
          'md:transition-[width] md:duration-200 md:ease-in-out',
          isCollapsed ? 'md:w-0 md:overflow-hidden md:border-r-0' : 'md:w-[232px]',
        )}
      >
      {/* Mobile close button */}
      <button
        type="button"
        onClick={close}
        className="absolute right-3 top-3.5 md:hidden p-1.5 rounded-[5px] text-text-faint hover:text-text hover:bg-bg-muted transition-colors"
        aria-label="Close navigation"
      >
        <X size={16} />
      </button>

      {/* Logo + desktop hide toggle. The hide button is desktop-only
          (md:inline-flex) because mobile already closes via the drawer X
          above; on desktop it collapses the sidebar to zero width. */}
      <div className="px-[14px] pt-4 pb-3.5 flex items-center justify-between gap-2">
        <LogoMark />
        <button
          type="button"
          onClick={toggleCollapsed}
          className="hidden md:inline-flex shrink-0 p-1 rounded-chip text-text-faint hover:text-text hover:bg-bg-chip transition-colors"
          aria-label="Hide sidebar"
          title="Hide sidebar"
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      {/* Workspace / project switcher */}
      <div className="mx-[14px] mb-3.5">
        <WorkspaceSwitcher />
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-[14px] space-y-0">
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi}>
            {group.label && (
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-faint px-[10px] pt-4 pb-2">
                {group.label}
              </div>
            )}
            {group.items.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(href + '/')
              const badge = BADGES[href]
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  // All sidebar links skip prefetch entirely. Production
                  // measurement showed 18 sibling-page RSC requests firing on
                  // every dashboard mount, each costing ~327ms middleware
                  // overhead, with ~17% returning 503 when Vercel ran out of
                  // function concurrency. Trade-off: the first click to any
                  // sidebar page now pays a one-time ~300-500ms cold cost
                  // instead of being instant. Acceptable for users who
                  // actively navigate between pages anyway.
                  // KpiCard + inline drill-down Links still use linkPrefetchFor
                  // for heavy-page filtering.
                  prefetch={false}
                  className={cn(
                    // The transparent border on the resting state keeps every
                    // row the same height as the active one, which draws a real
                    // 1px hairline.
                    'flex items-center justify-between gap-[10px] pl-[10px] pr-2 py-[6px] rounded text-[13px] leading-[18px] border transition-colors',
                    active
                      ? 'bg-bg-elev text-text font-semibold border-border'
                      : 'text-text-muted border-transparent hover:bg-bg-muted/60 hover:text-text',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-[10px]">
                    <Icon
                      aria-hidden="true"
                      className={cn(
                        'h-[13px] w-[13px] shrink-0',
                        active ? 'text-text' : 'text-text-faint',
                      )}
                    />
                    <span className="truncate">{label}</span>
                  </span>
                  {badge?.label && (
                    <span
                      className={cn(
                        'inline-flex shrink-0 items-center gap-[3px] font-mono text-[11px] leading-[15px] px-[7px] py-[2px] rounded-full',
                        badge.warn ? 'bg-accent-bg text-bad' : 'bg-bg-chip text-text-faint',
                      )}
                      aria-label={badge.aria ?? badge.label}
                    >
                      {/* Warn badges carry a small icon so severity is not
                          conveyed by color alone (WCAG 1.4.1). */}
                      {badge.warn && (
                        <TriangleAlert aria-hidden="true" className="h-[9px] w-[9px] shrink-0" />
                      )}
                      {badge.label}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Usage + upgrade widget */}
      <div className="mx-[14px] mb-2.5 mt-2 p-3 rounded-lg border border-border bg-bg-elev">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[13px] font-medium text-text">
            {formatPlanLabel(quota.data?.plan)}
          </span>
          <span className="font-mono text-[11.5px] text-text-faint">
            {quota.data
              ? `${formatRequestCount(quota.data.usedThisMonth)} / ${
                  quota.data.limit != null ? formatRequestCount(quota.data.limit) : '∞'
                }`
              : '— / —'}
          </span>
        </div>
        <div className="mt-2 h-[5px] rounded-full bg-track overflow-hidden">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{
              width: quota.data?.limit != null && quota.data.limit > 0
                ? `${Math.min(100, (quota.data.usedThisMonth / quota.data.limit) * 100).toFixed(1)}%`
                : '0%',
            }}
          />
        </div>
        {isAdmin && (
          <button
            /* Straight to Plan & limits, not the Settings landing page: the
               reader clicked this because of the usage bar above it, and
               General has nothing to say about their quota. */
            onClick={() => router.push('/settings?tab=plan')}
            className="mt-2.5 text-[12px] font-medium text-accent hover:text-accent-strong transition-colors"
          >
            {/* Upgrade only makes sense below Team. On Team/Enterprise the
                same widget links to plan management instead. */}
            {(quota.data?.plan === 'team' || quota.data?.plan === 'enterprise')
              ? 'Manage plan →'
              : 'Upgrade →'}
          </button>
        )}
      </div>

      {/* Footer strip: Feedback, sign out, theme. The Figma board puts these on
          one 26px row, which is why sign out is an icon here rather than a
          labelled row of its own. */}
      <div className="flex items-center gap-2 px-[14px] pb-[14px] pl-[18px]">
        <Link
          href="/feedback"
          prefetch={false}
          aria-current={
            pathname === '/feedback' || pathname.startsWith('/feedback/') ? 'page' : undefined
          }
          className={cn(
            'inline-flex items-center gap-1.5 text-[12px] font-medium transition-colors',
            pathname === '/feedback' || pathname.startsWith('/feedback/')
              ? 'text-text'
              : 'text-text-faint hover:text-text',
          )}
        >
          <MessageSquarePlus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Feedback</span>
        </Link>
        <div className="flex-1" />
        <button
          onClick={handleSignOut}
          aria-label="Sign out"
          title="Sign out"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-text-faint hover:bg-bg-chip hover:text-text transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <ThemeToggleButton />
      </div>
    </aside>
    </>
  )
}
