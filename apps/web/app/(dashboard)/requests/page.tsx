import { Suspense } from 'react'
import { HydrationBoundary } from '@tanstack/react-query'
import { prefetchAll } from '@/lib/server/dehydrate'
import { requestsListSpec } from '@/lib/server/queries/requests'
import { sidebarSpecs } from '@/lib/server/queries/sidebar'
import { statsOverviewSpec, statsTimeseriesSpec } from '@/lib/server/queries/stats'
import { RequestsClient } from './requests-client'

export default async function RequestsPage() {
  // Prefetch requests list + stat strip data in parallel.
  // statsOverviewSpec/statsTimeseriesSpec prevent a hydration mismatch: the
  // StatStrip uses overview.isLoading to decide between Skeleton and real
  // content, so SSR and client must agree on whether the data is present.
  // statsTimeseriesSpec(720) pre-loads the 30-day TrafficBars chart.
  //
  // sidebarSpecs() inlines the 7 layout-level queries (anomalies/alerts/
  // recommendations badges, workspace switcher, role, pending invites) so
  // a cold visit doesn't waterfall 6-7 extra client fetches after hydration.
  const state = await prefetchAll([
    ...sidebarSpecs(),
    requestsListSpec(),
    statsOverviewSpec(),
    statsTimeseriesSpec(),
    statsTimeseriesSpec(720),
  ])

  return (
    <HydrationBoundary state={state}>
      {/* Suspense required because RequestsClient uses useSearchParams() */}
      <Suspense>
        <RequestsClient />
      </Suspense>
    </HydrationBoundary>
  )
}
