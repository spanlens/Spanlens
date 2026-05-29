import { Suspense } from 'react'
import { HydrationBoundary } from '@tanstack/react-query'
import { prefetchAll } from '@/lib/server/dehydrate'
import { requestsListSpec } from '@/lib/server/queries/requests'
import { statsOverviewSpec, statsTimeseriesSpec } from '@/lib/server/queries/stats'
import { RequestsClient } from './requests-client'

export default async function RequestsPage() {
  // Prefetch requests list + stat strip data in parallel.
  // statsOverviewSpec/statsTimeseriesSpec prevent a hydration mismatch: the
  // StatStrip uses overview.isLoading to decide between Skeleton and real
  // content, so SSR and client must agree on whether the data is present.
  // statsTimeseriesSpec(720) pre-loads the 30-day TrafficBars chart.
  //
  // Sidebar / banner data is prefetched at the (dashboard) layout level
  // because its consumers (Sidebar, PendingInvitationsBanner) live outside
  // this page's HydrationBoundary scope. Including those specs here only
  // inflates SSR time without populating the cache the sidebar reads.
  const state = await prefetchAll([
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
