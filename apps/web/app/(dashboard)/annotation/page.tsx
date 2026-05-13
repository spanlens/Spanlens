import { HydrationBoundary } from '@tanstack/react-query'
import { prefetchAll } from '@/lib/server/dehydrate'
import { annotationQueueSpec } from '@/lib/server/queries/human-evals'
import { AnnotationClient } from './annotation-client'

export default async function AnnotationPage() {
  const state = await prefetchAll([annotationQueueSpec()])
  return (
    <HydrationBoundary state={state}>
      <AnnotationClient />
    </HydrationBoundary>
  )
}
