import { HydrationBoundary } from '@tanstack/react-query'
import { prefetchAll } from '@/lib/server/dehydrate'
import { promptVersionsSpec, promptExperimentsSpec } from '@/lib/server/queries/prompts'
import { PromptDetailClient } from './prompt-detail-client'

export default async function PromptDetailPage({ params }: { params: { name: string } }) {
  const name = decodeURIComponent(params.name)
  const state = await prefetchAll([
    promptVersionsSpec(name),
    promptExperimentsSpec(name),
  ])

  return (
    <HydrationBoundary state={state}>
      <PromptDetailClient params={params} />
    </HydrationBoundary>
  )
}
