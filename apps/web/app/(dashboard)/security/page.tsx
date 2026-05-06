import { HydrationBoundary } from '@tanstack/react-query'
import { prefetchAll } from '@/lib/server/dehydrate'
import {
  securitySummarySpec,
  securityFlaggedSpec,
  securitySettingsSpec,
} from '@/lib/server/queries/security'
import { SecurityClient } from './security-client'

export default async function SecurityPage() {
  const state = await prefetchAll([
    securitySummarySpec(24),
    securityFlaggedSpec({ limit: 50 }),
    securitySettingsSpec(),
  ])

  return (
    <HydrationBoundary state={state}>
      <SecurityClient />
    </HydrationBoundary>
  )
}
