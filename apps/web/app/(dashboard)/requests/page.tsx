import { Suspense } from 'react'
import { HydrationBoundary } from '@tanstack/react-query'
import { prefetchAll } from '@/lib/server/dehydrate'
import { requestsListSpec } from '@/lib/server/queries/requests'
import { RequestsClient } from './requests-client'

export default async function RequestsPage() {
  // Prefetch default page-1 list. If the user has URL filters, TanStack Query
  // fetches the filtered data client-side from the cache miss.
  const state = await prefetchAll([requestsListSpec()])

  return (
    <HydrationBoundary state={state}>
      {/* Suspense required because RequestsClient uses useSearchParams() */}
      <Suspense>
        <RequestsClient />
      </Suspense>
    </HydrationBoundary>
  )
}
