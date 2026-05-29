import { HydrationBoundary } from '@tanstack/react-query'
import { prefetchAll } from '@/lib/server/dehydrate'
import { sidebarSpecs } from '@/lib/server/queries/sidebar'
import { tracesListSpec } from '@/lib/server/queries/traces'
import { TracesClient } from './traces-client'

export default async function TracesPage() {
  // Prefetch default page-1 list + sidebar/banner data. Filtered/paged views
  // load client-side. sidebarSpecs() fires in parallel so a cold visit gets
  // workspace switcher, badges, and banner filled on first paint.
  const state = await prefetchAll([...sidebarSpecs(), tracesListSpec()])

  return (
    <HydrationBoundary state={state}>
      <TracesClient />
    </HydrationBoundary>
  )
}
