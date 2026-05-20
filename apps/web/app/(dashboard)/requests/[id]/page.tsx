import { HydrationBoundary } from '@tanstack/react-query'
import { prefetchAll } from '@/lib/server/dehydrate'
import { requestSpec } from '@/lib/server/queries/requests'
import { RequestDetailClient } from './request-detail-client'

// Next.js 15+ — `params` is a Promise (see traces/[id]/page.tsx for the same fix).
export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const state = await prefetchAll([requestSpec(id)])

  return (
    <HydrationBoundary state={state}>
      {/* key={id} remounts the client component on id change so
          internal tab state resets without a setState-in-effect. */}
      <RequestDetailClient key={id} id={id} />
    </HydrationBoundary>
  )
}
