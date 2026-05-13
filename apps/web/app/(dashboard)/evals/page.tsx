import { HydrationBoundary } from '@tanstack/react-query'
import { prefetchAll } from '@/lib/server/dehydrate'
import { evaluatorsSpec } from '@/lib/server/queries/evals'
import { EvalsClient } from './evals-client'

export default async function EvalsPage() {
  const state = await prefetchAll([evaluatorsSpec()])
  return (
    <HydrationBoundary state={state}>
      <EvalsClient />
    </HydrationBoundary>
  )
}
