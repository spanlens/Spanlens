import { HydrationBoundary } from '@tanstack/react-query'
import { prefetchAll } from '@/lib/server/dehydrate'
import { recommendationsSpec } from '@/lib/server/queries/recommendations'
import { SavingsClient } from './savings-client'

export default async function SavingsPage() {
  // Prefetch the default 7-day window. If the user changes the window,
  // TanStack Query will fetch the new window client-side as normal.
  const state = await prefetchAll([
    recommendationsSpec({ hours: 24 * 7, minSavings: 5 }),
  ])

  return (
    <HydrationBoundary state={state}>
      <SavingsClient />
    </HydrationBoundary>
  )
}
