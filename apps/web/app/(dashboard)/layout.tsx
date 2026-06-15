import { Suspense } from 'react'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { HydrationBoundary } from '@tanstack/react-query'
import { Sidebar } from '@/components/layout/sidebar'
import { SidebarShowToggle } from '@/components/layout/sidebar-show-toggle'
import { DashboardContent } from '@/components/layout/dashboard-content'
import { DashboardShellSkeleton } from '@/components/layout/sidebar-skeleton'
import { PendingInvitationsBanner } from '@/components/layout/pending-invitations-banner'
import { WorkspaceSwitchOverlay } from '@/components/layout/workspace-switch-overlay'
import { SidebarProvider } from '@/lib/sidebar-context'
import { SIDEBAR_COLLAPSED_COOKIE } from '@/lib/sidebar-cookie'
import { OverlayContainerProvider, OverlayContainerTarget } from '@/lib/overlay-container'
import { CommandPaletteProvider } from '@/components/command-palette'
import { prefetchAll } from '@/lib/server/dehydrate'
import { sidebarSpecs } from '@/lib/server/queries/sidebar'

/**
 * Dashboard layout. Reads auth state from the `x-spanlens-*` headers the
 * root middleware set after validating the session — no second `getUser()`
 * call here, which used to double the Supabase round-trip on every
 * dashboard navigation.
 *
 * If middleware ran and the user is authenticated, `x-spanlens-user-id` is
 * guaranteed present. Missing header + hitting /dashboard means middleware
 * didn't run for some reason (misconfig) OR we're in a dev-time edge case —
 * we fall back to a login redirect to fail safe.
 *
 * Two onboarding gates:
 *   • `x-spanlens-org-id` missing = bootstrap (workspace creation) hasn't run.
 *   • `x-spanlens-onboarded` missing = survey hasn't been completed/skipped.
 * Either case routes to /onboarding; the page handles both states (resumes
 * at the survey step if the workspace already exists).
 *
 * Sidebar + PendingInvitationsBanner prefetch
 * -------------------------------------------
 * The Sidebar (workspace switcher, role-gated nav, anomalies/alerts/
 * recommendations badge counts) and the PendingInvitationsBanner each mount
 * a useQuery() hook the moment the layout hydrates. Without server-side
 * prefetch + a HydrationBoundary in scope, every dashboard page paid 6-7
 * client-side waterfall fetches after hydration (measured: ~2-5s on cold
 * visits, ~1-2s warm).
 *
 * We prefetch the seven layout-level queries here and wrap the actual layout
 * subtree (Sidebar + main) in a HydrationBoundary so the hooks find their
 * data in the cache immediately on mount and skip the network round-trip.
 *
 * Trade-off: layout SSR now blocks on `await prefetchAll(sidebarSpecs())`.
 * In RSC, layout awaits run sequentially BEFORE the page's awaits — so the
 * page's own prefetch starts only after layout's resolves. Total SSR =
 * max(sidebar specs) + max(page specs). The page-specific path is
 * unavoidably longer, but eliminating the client-side waterfall makes
 * time-to-data shorter end-to-end.
 *
 * Earlier attempt (commit 906b4c2) tried to spread sidebarSpecs() into each
 * page's prefetchAll instead. That failed because the page-level
 * HydrationBoundary only scopes the page subtree — Sidebar lives in the
 * layout, OUTSIDE that boundary, so the prefetched cache was never visible
 * to the components that needed it. The boundary MUST wrap the consumers.
 *
 * PT-1 (2026-06-15): instead of blocking the whole layout on that prefetch,
 * the prefetch + the HydrationBoundary now live in a `<PrefetchedShell>`
 * sub-component wrapped in `<Suspense fallback={<DashboardShellSkeleton/>}>`.
 * The auth headers + cookie reads (cheap) still run synchronously in the
 * layout. Result: the browser sees the shell skeleton within ~50ms of the
 * click instead of waiting for the 1-3s prefetch.
 *
 * Why this avoids the #425 race that killed 16d83e6's streaming attempt:
 * that revert had TWO sibling HydrationBoundaries on the same QueryClient
 * (one resolved synchronously, one streamed via Suspense). Here we have a
 * single boundary inside the Suspended sub-component, with the page-level
 * boundary nested below it. Nested boundaries hydrate in tree order within
 * one reconciliation pass — no sibling race.
 */

/** Async data layer: awaits sidebarSpecs, wraps the layout interior in a
 *  HydrationBoundary so the Sidebar / PendingInvitationsBanner hooks find
 *  their cache on mount. Streamed in via the layout's Suspense. */
async function PrefetchedShell({ children }: { children: React.ReactNode }) {
  const sidebarState = await prefetchAll(sidebarSpecs())
  return (
    <HydrationBoundary state={sidebarState}>
      {children}
    </HydrationBoundary>
  )
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const h = await headers()
  const userId = h.get('x-spanlens-user-id')
  const orgId = h.get('x-spanlens-org-id')
  const onboarded = h.get('x-spanlens-onboarded') === '1'

  if (!userId) redirect('/login')
  if (!orgId || !onboarded) redirect('/onboarding')

  // Cheap synchronous read — seeds the SidebarProvider so SSR renders the
  // right desktop collapse state on first paint (no flash before hydration).
  const cookieStore = await cookies()
  const initialCollapsed = cookieStore.get(SIDEBAR_COLLAPSED_COOKIE)?.value === '1'

  return (
    // OverlayContainerProvider must sit above CommandPaletteProvider so the
    // palette (and Radix dialogs) can read the portal target; the target node
    // itself lives inside the zoom wrapper below, so overlays inherit the 125%
    // scale instead of rendering at 100% off the document body.
    <OverlayContainerProvider>
      <CommandPaletteProvider>
        <SidebarProvider initialCollapsed={initialCollapsed}>
          {/* PT-1: shell + sidebar/page render inside Suspense so the layout
              returns its HTML the moment the auth + cookie reads complete.
              The skeleton is shape-matched to the real Sidebar geometry so
              the swap is visually stable. */}
          <Suspense fallback={<DashboardShellSkeleton initialCollapsed={initialCollapsed} />}>
            <PrefetchedShell>
              {/* Dashboard renders at 125% scale (zoom) for a roomier default
                  view. Height is divided by the SAME factor so the zoomed
                  container still resolves to exactly one viewport height — without
                  the correction, 100vh * 1.25 would overflow and add a stray
                  scrollbar. The zoom factor and the height divisor must always
                  match. Scoped to the dashboard only; landing/docs/demo keep
                  their 100% scale. */}
              <div className="flex h-[calc(100vh/1.25)] overflow-hidden bg-bg [zoom:1.25]">
                <Sidebar />
                {/* Brings the sidebar back when it's collapsed to zero width.
                    Renders nothing while the sidebar is visible. */}
                <SidebarShowToggle />
                <main className="flex-1 overflow-y-auto min-w-0">
                  {/* Pending workspace invitations surface here: any dashboard
                      page renders this banner at the top, so a user who never
                      clicked the email link still sees the invite waiting for
                      them. Self-hides when there are none / after dismissal. */}
                  <PendingInvitationsBanner />
                  <DashboardContent>{children}</DashboardContent>
                </main>
                {/* Portal target for dialogs / command palette — inside the zoom
                    wrapper so overlays render at the same 125% scale. */}
                <OverlayContainerTarget />
                {/* Workspace-switch loading UI. Self-mounted because the sidebar
                    uses hard reload; this listens on a window event and renders
                    during the SSR round-trip. */}
                <WorkspaceSwitchOverlay />
              </div>
            </PrefetchedShell>
          </Suspense>
        </SidebarProvider>
      </CommandPaletteProvider>
    </OverlayContainerProvider>
  )
}
