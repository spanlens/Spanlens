import { HydrationBoundary } from '@tanstack/react-query'
import { prefetchAll } from '@/lib/server/dehydrate'
import { dismissalsSpec } from '@/lib/server/queries/dismissals'
import { statsOverviewSpec, statsTimeseriesSpec } from '@/lib/server/queries/stats'
import { DashboardClient } from './dashboard-client'

/**
 * Above-the-fold critical path only. Everything below the fold mounts as a
 * client useQuery() hook inside DashboardClient — each section renders its
 * own Skeleton while loading. Cuts TTFB by keeping those awaits off the page
 * render's critical path while the KPI row + traffic chart stay instant.
 *
 * Below the fold there are now three hooks rather than nine: alerts,
 * recommendations, audit logs, prompts, security summary and spend forecast
 * are served together by `useDashboardSummary` (GET /api/v1/dashboard/summary),
 * leaving `useStatsModels` and `useAnomalies` on their own because both poll
 * on a 30s refetchInterval and must not drag the rest onto that cadence.
 *
 * Sidebar / banner data is NOT prefetched here. The components that read it
 * live in the (dashboard) layout — outside this page's HydrationBoundary
 * scope — so prefetching them at the page level only inflates SSR time
 * without populating the cache the sidebar actually reads from. Layout
 * handles that prefetch + boundary itself.
 *
 * No Suspense streaming here — that path was reverted in 16d83e6 due to a
 * TanStack Query hydration race with React #425/#422. Plain client query
 * lifecycle is simpler and proven.
 */
export default async function DashboardPage() {
  const state = await prefetchAll([
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
