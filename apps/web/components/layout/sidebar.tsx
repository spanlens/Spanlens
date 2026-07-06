'use client'
import Image from 'next/image'
import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTheme } from '@/components/providers/theme-provider'
import { Sun, Moon, Monitor, X, MessageSquarePlus, PanelLeftClose, TriangleAlert } from 'lucide-react'
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
      className="flex items-center gap-2 px-1 py-1 hover:opacity-80 transition-opacity"
    >
      <Image src="/icon.png" alt="Spanlens" width={20} height={20} className="shrink-0 rounded-[5px]" priority />
      <span className="font-semibold text-[15px] tracking-[-0.3px] text-text">
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
        className="w-full flex items-center justify-between px-[10px] py-[7px] rounded-[5px] border border-border bg-bg-muted text-[12px] font-mono text-text-muted hover:bg-bg-muted/80 transition-colors"
      >
        <span className="truncate text-text">{orgName}</span>
        <span className="text-text-faint text-[10px] shrink-0 ml-2">⌄</span>
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

/* ── Nav groups ── */
type NavItem = { href: string; label: string }

const NAV_GROUPS: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [
      { href: '/dashboard',  label: 'Dashboard' },
      { href: '/requests',   label: 'Requests' },
      { href: '/traces',     label: 'Traces' },
      { href: '/sessions',   label: 'Sessions' },
      { href: '/users',      label: 'Users' },
    ],
  },
  {
    label: 'Observe',
    items: [
      { href: '/anomalies',  label: 'Anomalies' },
      { href: '/security',   label: 'Security' },
      { href: '/savings',    label: 'Savings' },
    ],
  },
  {
    label: 'Build',
    items: [
      { href: '/prompts',     label: 'Prompts' },
      { href: '/evals',       label: 'Evals' },
      { href: '/datasets',    label: 'Datasets' },
      { href: '/experiments', label: 'Experiments' },
      { href: '/alerts',      label: 'Alerts' },
    ],
  },
  {
    label: 'Review',
    items: [
      { href: '/annotation', label: 'Annotation' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { href: '/projects',  label: 'Projects & Keys' },
      // Public share tokens live in the same Admin section as API keys —
      // both are externally-issued credentials with the same operator
      // workflow (list / inspect / revoke). Sitting them next to each
      // other keeps the leak-audit flow ("rotate the key, revoke the
      // share") one cursor move apart.
      { href: '/shares',    label: 'Shared links' },
      { href: '/settings',  label: 'Settings' },
      { href: '/docs',      label: 'Docs' },
    ],
  },
]

/* ── Theme toggle ── */
type ThemeOption = 'system' | 'light' | 'dark'

const THEME_CYCLE: ThemeOption[] = ['system', 'light', 'dark']

function ThemeToggleButton() {
  const { theme, setTheme } = useTheme()

  function cycleTheme() {
    const current = (theme ?? 'system') as ThemeOption
    const idx = THEME_CYCLE.indexOf(current)
    const next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length] ?? 'system'
    setTheme(next)
  }

  const current = (theme ?? 'system') as ThemeOption
  const Icon = current === 'light' ? Sun : current === 'dark' ? Moon : Monitor

  return (
    <button
      onClick={cycleTheme}
      className="flex w-full items-center gap-2 px-[10px] py-[6px] rounded-[5px] text-[13px] text-text-muted hover:bg-bg-muted hover:text-text transition-colors"
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>Theme · {current}</span>
    </button>
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
          // Base
          'flex flex-col bg-bg-elev border-r border-border',
          // Mobile: fixed overlay drawer. `inset-y-0` already pins to the
          // full viewport height, so no `h-screen` here — on desktop the
          // sidebar lives inside the dashboard's `[zoom:1.25]` wrapper whose
          // height is `100vh/1.25`, and an explicit `h-screen` would overflow
          // that parent by 25% and hide the Plan widget / Feedback / Theme /
          // Sign out at the bottom. The flex parent gives us the height we need.
          'fixed inset-y-0 left-0 z-50 w-[272px]',
          'transition-transform duration-200 ease-in-out',
          isOpen ? 'translate-x-0' : '-translate-x-full',
          // Desktop: back in flow. Width animates between full (w-56) and
          // hidden (w-0) so the "hide sidebar" toggle collapses it smoothly;
          // overflow-hidden clips the content while it's at zero width.
          // `md:[zoom:0.8]` cancels the dashboard wrapper's `[zoom:1.25]`
          // (1.25 * 0.8 = 1.0) so the sidebar renders at its original 100%
          // size while the main content stays at 125%. Without this, 17 nav
          // items + plan widget + footer overflow on smaller laptop screens
          // and need to be scrolled. Scoped to md+ because mobile uses
          // `fixed` positioning, which interacts poorly with CSS `zoom`.
          'md:relative md:shrink-0 md:translate-x-0 md:[zoom:0.8]',
          'md:transition-[width] md:duration-200 md:ease-in-out',
          isCollapsed ? 'md:w-0 md:overflow-hidden md:border-r-0' : 'md:w-56',
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
      <div className="px-[18px] pt-[18px] pb-3 flex items-center justify-between gap-2">
        <LogoMark />
        <button
          type="button"
          onClick={toggleCollapsed}
          className="hidden md:inline-flex shrink-0 p-1 rounded-[5px] text-text-faint hover:text-text hover:bg-bg-muted transition-colors"
          aria-label="Hide sidebar"
          title="Hide sidebar"
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      {/* Workspace / project switcher */}
      <div className="mx-[14px] mb-3">
        <WorkspaceSwitcher />
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-[14px] space-y-0">
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi}>
            {group.label && (
              <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint px-[10px] pt-3 pb-1">
                {group.label}
              </div>
            )}
            {group.items.map(({ href, label }) => {
              const active = pathname === href || pathname.startsWith(href + '/')
              const badge = BADGES[href]
              return (
                <Link
                  key={href}
                  href={href}
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
                    'flex items-center justify-between px-[10px] py-[6px] rounded-[5px] text-[13px] transition-colors',
                    'border-l-2',
                    active
                      ? 'bg-bg-muted text-text font-medium border-accent'
                      : 'text-text-muted hover:bg-bg-muted hover:text-text border-transparent',
                  )}
                >
                  <span>{label}</span>
                  {badge?.label && (
                    <span
                      className={cn(
                        'inline-flex items-center gap-[3px] font-mono text-[10px] px-[6px] py-[1px] rounded-[3px] border',
                        badge.warn
                          ? 'bg-accent-bg text-accent border-accent-border'
                          : 'bg-bg text-text-faint border-border',
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
      <div className="mx-[18px] mb-[14px] mt-2 p-3 rounded-md border border-border bg-bg-muted">
        <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-1.5">
          Plan · {formatPlanLabel(quota.data?.plan)}
        </div>
        <div className="text-[13px] text-text mb-1.5">
          {quota.data
            ? `${formatRequestCount(quota.data.usedThisMonth)} / ${
                quota.data.limit != null ? formatRequestCount(quota.data.limit) : '∞'
              } requests`
            : '— / — requests'}
        </div>
        <div className="h-1 rounded-full bg-bg overflow-hidden">
          <div
            className="h-full rounded-full bg-text transition-all"
            style={{
              width: quota.data?.limit != null && quota.data.limit > 0
                ? `${Math.min(100, (quota.data.usedThisMonth / quota.data.limit) * 100).toFixed(1)}%`
                : '0%',
            }}
          />
        </div>
        {isAdmin && (
          <button
            onClick={() => router.push('/settings')}
            className="mt-2.5 text-[12px] font-medium text-accent hover:opacity-80 transition-opacity"
          >
            {/* Upgrade only makes sense below Team. On Team/Enterprise the
                same widget links to plan management instead. */}
            {(quota.data?.plan === 'team' || quota.data?.plan === 'enterprise')
              ? 'Manage plan →'
              : 'Upgrade →'}
          </button>
        )}
      </div>

      {/* Feedback + Theme toggle + Sign out */}
      <div className="px-[14px] pb-[14px] space-y-0.5">
        <Link
          href="/feedback"
          prefetch={false}
          className={cn(
            'flex w-full items-center gap-2 px-[10px] py-[6px] rounded-[5px] text-[13px] transition-colors',
            pathname === '/feedback' || pathname.startsWith('/feedback/')
              ? 'bg-bg-muted text-text font-medium'
              : 'text-text-muted hover:bg-bg-muted hover:text-text',
          )}
        >
          <MessageSquarePlus className="h-3.5 w-3.5 shrink-0" />
          <span>Feedback</span>
        </Link>
        <ThemeToggleButton />
        <button
          onClick={handleSignOut}
          className="flex w-full items-center px-[10px] py-[6px] rounded-[5px] text-[13px] text-text-muted hover:bg-bg-muted hover:text-text transition-colors"
        >
          Sign out
        </button>
      </div>
    </aside>
    </>
  )
}
