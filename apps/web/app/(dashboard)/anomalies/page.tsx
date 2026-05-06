import { HydrationBoundary } from '@tanstack/react-query'
import { prefetchAll } from '@/lib/server/dehydrate'
import { anomaliesSpec, anomalyHistorySpec } from '@/lib/server/queries/anomalies'
import { AnomaliesClient } from './anomalies-client'

export default async function AnomaliesPage() {
  const state = await prefetchAll([
    anomaliesSpec({ observationHours: 1, referenceHours: 24 * 7, sigma: 3 }),
    anomalyHistorySpec(30),
  ])

  return (
    <HydrationBoundary state={state}>
      <AnomaliesClient />
    </HydrationBoundary>
  )
}
