'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { AlertRow, ApiEnvelope, SpendForecast } from './types'
import type { AuditLogRow } from './use-audit-logs'
import type { PromptVersion } from './use-prompts'
import type { ModelRecommendation } from './use-recommendations'
import type { SecuritySummaryItem } from './use-security'

/**
 * One read for the dashboard's below-the-fold panels.
 *
 * These six datasets used to mount six independent `useQuery` hooks, so a
 * single dashboard view opened a fan of client requests that queued against
 * the browser's per-origin connection limit instead of overlapping on the
 * server. `GET /api/v1/dashboard/summary` runs them in one `Promise.all`, so
 * the set costs one round-trip bounded by the slowest dataset.
 *
 * Only non-polling panels are folded in. `useStatsModels` and `useAnomalies`
 * keep their own hooks because both carry a 30s `refetchInterval` — pulling a
 * polling query in here would drag all six onto that cadence and raise total
 * load. `useDismissals` also stays separate: `useDismissCard` writes to its
 * cache entry for the optimistic dismiss.
 *
 * No Suspense. `app/(dashboard)/dashboard/page.tsx` records that the
 * streaming path was reverted in 16d83e6 over a TanStack hydration race
 * (React #425/#422); this is a plain client query.
 */

/**
 * A dataset is `null` when the server's lookup for it failed, and `[]` when
 * the lookup succeeded and found nothing. Consumers that only need "show
 * something or show the empty state" can collapse both with `?? []`; the
 * distinction is preserved so a future error affordance has something to key
 * on. See `meta.degraded` in the endpoint for the list of failed keys.
 */
export interface DashboardSummary {
  alerts: AlertRow[] | null
  recommendations: ModelRecommendation[] | null
  auditLogs: AuditLogRow[] | null
  prompts: PromptVersion[] | null
  securitySummary: SecuritySummaryItem[] | null
  spendForecast: SpendForecast | null
}

interface DashboardSummaryMeta {
  hours: number
  auditLimit: number
  minSavingsUsd: number
  promptSinceHours: number
  /** Keys of `data` whose server-side lookup failed. Empty on a clean read. */
  degraded: string[]
}

export interface DashboardSummaryParams {
  /** Window for recommendations + security flag counts. */
  hours: number
  /** Rows for the "Recent activity" strip. */
  auditLimit?: number
}

/**
 * Key contains a params object, so it never collides with another hook's
 * static key (see query-key-uniqueness.test.ts, which only guards keys made
 * entirely of string literals). `'dashboard-summary'` is unused elsewhere.
 */
export function dashboardSummaryQueryKey(params: DashboardSummaryParams) {
  return ['dashboard-summary', params] as const
}

export function buildDashboardSummaryPath(params: DashboardSummaryParams): string {
  const qs = new URLSearchParams({ hours: String(params.hours) })
  if (params.auditLimit) qs.set('auditLimit', String(params.auditLimit))
  return `/api/v1/dashboard/summary?${qs}`
}

export function useDashboardSummary(params: DashboardSummaryParams) {
  return useQuery({
    queryKey: dashboardSummaryQueryKey(params),
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<DashboardSummary> & { meta?: DashboardSummaryMeta }>(
        buildDashboardSummaryPath(params),
      )
      return res.data
    },
    // 60s matches the live-ish datasets in the payload. The individual hooks
    // this replaced ranged from 0 to 10min; a single composite has to pick
    // one, and the shortest meaningful window is the safe direction.
    staleTime: 60_000,
    // `hours` is part of the key, so switching the time range starts a new
    // query. Without this, six panels would drop to skeletons on every range
    // switch — including the ones whose data does not depend on `hours` at
    // all. Same reasoning as `useStatsOverview`'s keepPreviousData.
    placeholderData: keepPreviousData,
  })
}
