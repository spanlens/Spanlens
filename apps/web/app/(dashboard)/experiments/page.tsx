import { HydrationBoundary } from '@tanstack/react-query'
import { prefetchAll } from '@/lib/server/dehydrate'
import { experimentsSpec } from '@/lib/server/queries/experiments'
import { ExperimentsClient } from './experiments-client'

export default async function ExperimentsPage() {
  const state = await prefetchAll([experimentsSpec()])
  return (
    <HydrationBoundary state={state}>
      <ExperimentsClient />
    </HydrationBoundary>
  )
}
