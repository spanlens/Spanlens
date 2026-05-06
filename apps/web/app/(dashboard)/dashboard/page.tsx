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

export default async function DashboardPage() {
  const state = await prefetchAll([
    statsOverviewSpec(),
    statsTimeseriesSpec(),
    statsModelsSpec(),
    spendForecastSpec(),
    anomaliesSpec({ observationHours: 24 }),
    alertsSpec(),
    recommendationsSpec({ hours: 24 }),
    securitySummarySpec(24),
    auditLogsSpec({ limit: 6 }),
    dismissalsSpec(),
  ])

  return (
    <HydrationBoundary state={state}>
      <DashboardClient />
    </HydrationBoundary>
  )
}
