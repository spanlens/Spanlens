import { HydrationBoundary } from '@tanstack/react-query'
import { prefetchAll } from '@/lib/server/dehydrate'
import { projectsSpec, apiKeysSpec, providerKeysSpec } from '@/lib/server/queries/projects'
import { ProjectsClient } from './projects-client'

export default async function ProjectsPage() {
  const state = await prefetchAll([
    projectsSpec(),
    apiKeysSpec(),
    providerKeysSpec(),
  ])

  return (
    <HydrationBoundary state={state}>
      <ProjectsClient />
    </HydrationBoundary>
  )
}
