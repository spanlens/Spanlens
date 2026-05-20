import { HydrationBoundary } from '@tanstack/react-query'
import { prefetchAll } from '@/lib/server/dehydrate'
import { promptVersionsSpec, promptExperimentsSpec } from '@/lib/server/queries/prompts'
import { PromptDetailClient } from './prompt-detail-client'

// Next.js 15+ — `params` is a Promise (see traces/[id]/page.tsx for the same fix).
export default async function PromptDetailPage({
  params,
}: {
  params: Promise<{ name: string }>
}) {
  const resolved = await params
  const name = decodeURIComponent(resolved.name)
  const state = await prefetchAll([
    promptVersionsSpec(name),
    promptExperimentsSpec(name),
  ])

  return (
    <HydrationBoundary state={state}>
      <PromptDetailClient params={resolved} />
    </HydrationBoundary>
  )
}
