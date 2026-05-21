import { HydrationBoundary } from '@tanstack/react-query'
import { prefetchAll } from '@/lib/server/dehydrate'
import { dismissalsSpec } from '@/lib/server/queries/dismissals'
import { statsOverviewSpec, statsTimeseriesSpec } from '@/lib/server/queries/stats'
import { DashboardClient } from './dashboard-client'

/**
 * Above-the-fold critical path only. The other 7 queries (models, forecast,
 * anomalies, alerts, recommendations, security, audit logs) mount as client
 * useQuery() hooks inside DashboardClient — each section already renders a
 * Skeleton while loading. Cuts TTFB by removing 7 awaits from the page
 * render's critical path while keeping the KPI row + traffic chart instant.
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
