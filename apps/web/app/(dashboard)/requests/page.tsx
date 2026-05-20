import { Suspense } from 'react'
import { HydrationBoundary } from '@tanstack/react-query'
import { prefetchAll } from '@/lib/server/dehydrate'
import { requestsListSpec } from '@/lib/server/queries/requests'
import { RequestsClient } from './requests-client'

export default async function RequestsPage() {
  // Prefetch default page-1 list. If the user has URL filters, TanStack Query
  // fetches the filtered data client-side from the cache miss.
  //
  // Timing instrumentation (temporary — investigating the /requests SSR slow
  // first-paint reported on 2026-05-20; see docs/plans/dashboard-ssr-suspense-stuck-2026-05.md).
  // Remove after the root cause lands.
  const t0 = Date.now()
  const state = await prefetchAll([requestsListSpec()])
  console.log(`[ssr-timing] /requests prefetchAll=${Date.now() - t0}ms`)

  return (
    <HydrationBoundary state={state}>
      {/* Suspense required because RequestsClient uses useSearchParams() */}
      <Suspense>
        <RequestsClient />
      </Suspense>
    </HydrationBoundary>
  )
}
