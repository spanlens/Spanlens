import { HydrationBoundary } from '@tanstack/react-query'
import { prefetchAll } from '@/lib/server/dehydrate'
import { alertsSpec, channelsSpec, deliveriesSpec } from '@/lib/server/queries/alerts'
import { AlertsClient } from './alerts-client'

export default async function AlertsPage() {
  const state = await prefetchAll([
    alertsSpec(),
    channelsSpec(),
    deliveriesSpec(),
  ])

  return (
    <HydrationBoundary state={state}>
      <AlertsClient />
    </HydrationBoundary>
  )
}
