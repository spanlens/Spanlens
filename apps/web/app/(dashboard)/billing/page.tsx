import { Suspense } from 'react'
import { HydrationBoundary } from '@tanstack/react-query'
import { prefetchAll } from '@/lib/server/dehydrate'
import { subscriptionSpec, quotaSpec } from '@/lib/server/queries/billing'
import { BillingClient } from './billing-client'

export default async function BillingPage() {
  const state = await prefetchAll([subscriptionSpec(), quotaSpec()])

  return (
    <HydrationBoundary state={state}>
      {/* Suspense required because BillingClient uses useSearchParams() */}
      <Suspense>
        <BillingClient />
      </Suspense>
    </HydrationBoundary>
  )
}
