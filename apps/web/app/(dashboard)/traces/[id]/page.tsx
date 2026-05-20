import { HydrationBoundary } from '@tanstack/react-query'
import { prefetchAll } from '@/lib/server/dehydrate'
import { traceDetailSpec } from '@/lib/server/queries/traces'
import { TraceDetailClient } from './trace-detail-client'

// Next.js 15+ — dynamic route `params` is a Promise that must be awaited.
// Treating it as sync makes `.id` resolve to undefined, sending the SSR
// prefetch to `/api/v1/traces/undefined` → 404 → "Trace not found" page.
export default async function TraceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const state = await prefetchAll([traceDetailSpec(id)])

  return (
    <HydrationBoundary state={state}>
      <TraceDetailClient id={id} />
    </HydrationBoundary>
  )
}
