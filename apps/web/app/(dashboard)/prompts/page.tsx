import { HydrationBoundary } from '@tanstack/react-query'
import { prefetchAll } from '@/lib/server/dehydrate'
import { promptsListSpec } from '@/lib/server/queries/prompts'
import { PromptsClient } from './prompts-client'

export default async function PromptsPage() {
  // Prefetch default 24-hour prompts list. Different dateRanges load client-side.
  const state = await prefetchAll([promptsListSpec()])

  return (
    <HydrationBoundary state={state}>
      <PromptsClient />
    </HydrationBoundary>
  )
}
