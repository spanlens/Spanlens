import { HydrationBoundary } from '@tanstack/react-query'
import { prefetchAll } from '@/lib/server/dehydrate'
import { alertsSpec, channelsSpec, deliveriesSpec } from '@/lib/server/queries/alerts'
import { AlertDetailClient } from './alert-detail-client'

export default async function AlertDetailPage() {
  const state = await prefetchAll([alertsSpec(), channelsSpec(), deliveriesSpec()])

  return (
    <HydrationBoundary state={state}>
      <AlertDetailClient />
    </HydrationBoundary>
  )
}
