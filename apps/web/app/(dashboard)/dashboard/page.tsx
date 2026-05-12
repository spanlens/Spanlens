import { Suspense } from 'react'
import { HydrationBoundary } from '@tanstack/react-query'
import { prefetchAll } from '@/lib/server/dehydrate'
import { alertsSpec } from '@/lib/server/queries/alerts'
import { recommendationsSpec } from '@/lib/server/queries/recommendations'
import { securitySummarySpec } from '@/lib/server/queries/security'
import { auditLogsSpec } from '@/lib/server/queries/audit-logs'
import { dismissalsSpec } from '@/lib/server/queries/dismissals'
import { statsOverviewSpec, statsTimeseriesSpec, statsModelsSpec, spendForecastSpec } from '@/lib/server/queries/stats'
import { anomaliesSpec } from '@/lib/server/queries/anomalies'
import { DashboardClient } from './dashboard-client'

// Below-the-fold queries — prefetched in parallel but streamed in via Suspense
// so they don't block the initial HTML. The dashboard renders with skeletons
// in these slots and React Query swaps in real data when the stream arrives.
async function DeferredHydration() {
  const state = await prefetchAll([
    statsModelsSpec(),
    spendForecastSpec(),
    anomaliesSpec({ observationHours: 24 }),
    alertsSpec(),
    recommendationsSpec({ hours: 24 }),
    securitySummarySpec(24),
    auditLogsSpec({ limit: 6 }),
  ])
  return <HydrationBoundary state={state} />
}

export default async function DashboardPage() {
  // Above-the-fold critical path — blocks initial HTML (KPI row + traffic chart
  // + attention-card dismissal state). Kept to 3 fast queries so TTFB stays low.
  const state = await prefetchAll([
    statsOverviewSpec(),
    statsTimeseriesSpec(),
    dismissalsSpec(),
  ])

  return (
    <HydrationBoundary state={state}>
      <DashboardClient />
      <Suspense fallback={null}>
        <DeferredHydration />
      </Suspense>
    </HydrationBoundary>
  )
}
