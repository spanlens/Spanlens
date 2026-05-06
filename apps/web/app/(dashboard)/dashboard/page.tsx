import { HydrationBoundary } from '@tanstack/react-query'
import { prefetchAll } from '@/lib/server/dehydrate'
import { alertsSpec } from '@/lib/server/queries/alerts'
import { recommendationsSpec } from '@/lib/server/queries/recommendations'
import { securitySummarySpec } from '@/lib/server/queries/security'
import { auditLogsSpec } from '@/lib/server/queries/audit-logs'
import { dismissalsSpec } from '@/lib/server/queries/dismissals'
import { DashboardClient } from './dashboard-client'

export default async function DashboardPage() {
  // Prefetch project-agnostic queries server-side.
  // Project-scoped queries (overview, timeseries, models, spend forecast, anomalies, prompts)
  // depend on projectId stored in localStorage — they load client-side on first render.
  const state = await prefetchAll([
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
