import { HydrationBoundary } from '@tanstack/react-query'
import { prefetchAll } from '@/lib/server/dehydrate'
import { traceDetailSpec } from '@/lib/server/queries/traces'
import { TraceDetailClient } from './trace-detail-client'

export default async function TraceDetailPage({ params }: { params: { id: string } }) {
  const state = await prefetchAll([traceDetailSpec(params.id)])

  return (
    <HydrationBoundary state={state}>
      <TraceDetailClient id={params.id} />
    </HydrationBoundary>
  )
}
