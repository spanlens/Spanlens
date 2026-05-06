import { HydrationBoundary } from '@tanstack/react-query'
import { prefetchAll } from '@/lib/server/dehydrate'
import { tracesListSpec } from '@/lib/server/queries/traces'
import { TracesClient } from './traces-client'

export default async function TracesPage() {
  // Prefetch default page-1 list. Filtered/paged views load client-side.
  const state = await prefetchAll([tracesListSpec()])

  return (
    <HydrationBoundary state={state}>
      <TracesClient />
    </HydrationBoundary>
  )
}
