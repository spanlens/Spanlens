import { HydrationBoundary } from '@tanstack/react-query'
import { prefetchAll } from '@/lib/server/dehydrate'
import { datasetsSpec } from '@/lib/server/queries/datasets'
import { DatasetsClient } from './datasets-client'

export default async function DatasetsPage() {
  const state = await prefetchAll([datasetsSpec()])
  return (
    <HydrationBoundary state={state}>
      <DatasetsClient />
    </HydrationBoundary>
  )
}
