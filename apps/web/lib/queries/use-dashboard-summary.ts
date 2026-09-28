'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { AlertRow, SpendForecast } from './types'
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
 * the lookup succeeded and found nothing. The two must not collapse into the
 * same render: a failed alerts lookup shown as "No active alert rules", or a
 * failed security lookup shown as no PII warning at all, tells the user
 * something false. Panels key their state on `dashboardPanelState()` below.
 */
export interface DashboardSummary {
  alerts: AlertRow[] | null
  recommendations: ModelRecommendation[] | null
  auditLogs: AuditLogRow[] | null
  prompts: PromptVersion[] | null
  securitySummary: SecuritySummaryItem[] | null
  spendForecast: SpendForecast | null
}

/** Dataset keys, in the endpoint's response order. */
export const DASHBOARD_DATASETS = [
  'alerts',
  'recommendations',
  'auditLogs',
  'prompts',
  'securitySummary',
  'spendForecast',
] as const satisfies readonly (keyof DashboardSummary)[]

export type DashboardDatasetKey = (typeof DASHBOARD_DATASETS)[number]

interface DashboardSummaryMeta {
  hours: number
  auditLimit: number
  minSavingsUsd: number
  promptSinceHours: number
  /** Keys of `data` whose server-side lookup failed. Empty on a clean read. */
  degraded: string[]
}

/** Wire shape, typed loosely: an older or newer server may omit fields. */
export interface DashboardSummaryEnvelope {
  data?: Partial<DashboardSummary> | null
  meta?: Partial<DashboardSummaryMeta>
}

export interface DashboardSummaryResult {
  data: DashboardSummary
  /** Datasets whose lookup failed, in `DASHBOARD_DATASETS` order. */
  degraded: readonly DashboardDatasetKey[]
}

/**
 * Keeps `meta.degraded` instead of discarding it. A dataset counts as
 * degraded when the server named it OR when it arrived `null`/missing: no
 * successful lookup produces `null`, so a missing value is not an empty one.
 */
export function toDashboardSummaryResult(envelope: DashboardSummaryEnvelope): DashboardSummaryResult {
  const raw = envelope.data ?? {}
  const data: DashboardSummary = {
    alerts: raw.alerts ?? null,
    recommendations: raw.recommendations ?? null,
    auditLogs: raw.auditLogs ?? null,
    prompts: raw.prompts ?? null,
    securitySummary: raw.securitySummary ?? null,
    spendForecast: raw.spendForecast ?? null,
  }
  const reported = new Set(envelope.meta?.degraded ?? [])
  const degraded = DASHBOARD_DATASETS.filter((key) => reported.has(key) || data[key] === null)
  return { data, degraded }
}

/**
 * What a panel should render.
 *
 *   - `loading`: no response yet.
 *   - `unavailable`: this dataset failed, or the whole request failed with
 *     nothing cached. The panel says so and offers a retry, instead of
 *     showing its empty state.
 *   - `ready`: render the data, including a genuine empty state. A failed
 *     background refetch keeps the last good read on screen.
 */
export type DashboardPanelState = 'loading' | 'unavailable' | 'ready'

export function dashboardPanelState(
  query: { data?: DashboardSummaryResult | undefined; isError: boolean },
  key: DashboardDatasetKey,
): DashboardPanelState {
  if (query.data) return query.data.degraded.includes(key) ? 'unavailable' : 'ready'
  return query.isError ? 'unavailable' : 'loading'
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
    queryFn: async (): Promise<DashboardSummaryResult> => {
      const res = await apiGet<DashboardSummaryEnvelope>(buildDashboardSummaryPath(params))
      return toDashboardSummaryResult(res)
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
