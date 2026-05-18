import { HydrationBoundary } from '@tanstack/react-query'
import { prefetchAll } from '@/lib/server/dehydrate'
import { requestSpec } from '@/lib/server/queries/requests'
import { RequestDetailClient } from './request-detail-client'

export default async function RequestDetailPage({ params }: { params: { id: string } }) {
  const state = await prefetchAll([requestSpec(params.id)])

  return (
    <HydrationBoundary state={state}>
      {/* key={params.id} remounts the client component on id change so
          internal tab state resets without a setState-in-effect. */}
      <RequestDetailClient key={params.id} id={params.id} />
    </HydrationBoundary>
  )
}
