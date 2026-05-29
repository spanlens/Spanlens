import 'server-only'
import type { QuerySpec } from '@/lib/server/dehydrate'
import { alertsSpec } from './alerts'
import { anomaliesSpec } from './anomalies'
import { currentRoleSpec, pendingInvitationsSpec } from './me'
import { organizationSpec } from './organization'
import { recommendationsSpec } from './recommendations'
import { workspacesSpec } from './workspaces'

/**
 * The set of queries the dashboard layout's Sidebar + PendingInvitationsBanner
 * always reads. Spread into every dashboard page's `prefetchAll([...])` so
 * these fire in parallel with the page's own data fetches.
 *
 * Why pages, not the layout?
 *   Next.js Server Components render the layout's awaits SEQUENTIALLY before
 *   children. Awaiting these 6 specs in the layout would block page-level
 *   prefetches by 1-3s. Inlining them into each page's prefetchAll lets ALL
 *   ~10 queries run as one Promise.allSettled batch, so the slowest one
 *   bounds total prefetch latency instead of the sum.
 *
 * What's inside (and why each must be prefetched, not left for client mount)
 * -------------------------------------------------------------------------
 *   • anomalies (24h)        — sidebar badge count
 *   • alerts                 — sidebar badge count
 *   • recommendations (24h)  — sidebar badge count (savings nudge)
 *   • organization (me)      — workspace switcher current label, plan tier
 *   • workspaces             — workspace switcher dropdown
 *   • current role           — admin-gated nav items
 *   • pending invitations    — top-of-page banner
 *
 * staleTime is set per-spec to match the corresponding client hook. After
 * hydration, the client QueryClient picks up the cached data and avoids
 * refetching until staleness — 60s for live data, 5min for role.
 *
 * Call as `prefetchAll([...sidebarSpecs(), ...pageSpecs])`.
 */
export function sidebarSpecs(): QuerySpec[] {
  return [
    anomaliesSpec({ observationHours: 24 }),
    alertsSpec(),
    recommendationsSpec({ hours: 24 }),
    organizationSpec(),
    workspacesSpec(),
    currentRoleSpec(),
    pendingInvitationsSpec(),
  ]
}
