import { HydrationBoundary } from '@tanstack/react-query'
import { prefetchAll } from '@/lib/server/dehydrate'
import { dismissalsSpec } from '@/lib/server/queries/dismissals'
import { sidebarSpecs } from '@/lib/server/queries/sidebar'
import { statsOverviewSpec, statsTimeseriesSpec } from '@/lib/server/queries/stats'
import { DashboardClient } from './dashboard-client'

/**
 * Above-the-fold critical path only. The other 7 queries (models, forecast,
 * anomalies, alerts, recommendations, security, audit logs) mount as client
 * useQuery() hooks inside DashboardClient — each section already renders a
 * Skeleton while loading. Cuts TTFB by removing 7 awaits from the page
 * render's critical path while keeping the KPI row + traffic chart instant.
 *
 * Sidebar specs are spread in so the workspace switcher / role-gated nav /
 * banner counts render filled on first paint instead of triggering 6-7
 * waterfall fetches client-side after hydration (~2-3s cold improvement).
 * All ~10 queries fire in one parallel Promise.allSettled batch — slowest
 * one bounds total prefetch latency, not the sum.
 *
 * No Suspense streaming here — that path was reverted in 16d83e6 due to a
 * TanStack Query hydration race with React #425/#422. Plain client query
 * lifecycle is simpler and proven.
 */
export default async function DashboardPage() {
  const state = await prefetchAll([
    ...sidebarSpecs(),       // Sidebar badges + workspace switcher + role + banner
    statsOverviewSpec(),     // KPI row (above-fold)
    statsTimeseriesSpec(),   // Traffic chart (above-fold)
    dismissalsSpec(),        // UI state, cheap PK lookup
  ])

  return (
    <HydrationBoundary state={state}>
      <DashboardClient />
    </HydrationBoundary>
  )
}
