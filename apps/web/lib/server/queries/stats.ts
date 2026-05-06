import 'server-only'
import { apiGetServer } from '@/lib/server/api'
import type { ModelStat } from '@/lib/queries/use-stats'
import type { QuerySpec } from '@/lib/server/dehydrate'
import type { ApiEnvelope, StatsOverview, TimeseriesPoint, SpendForecast } from '@/lib/queries/types'

// Mirrors the client-side rounding in dashboard-client.tsx queryDateRange.
// Rounded to the minute so server and client produce the same `from` value
// as long as they render within the same wall-clock minute (true >99% of time).
function fromIso(hours: number): string {
  const fromMs = Math.floor((Date.now() - hours * 60 * 60 * 1000) / 60_000) * 60_000
  return new Date(fromMs).toISOString()
}

// Must exactly match statsOverviewQueryKey + params shape in use-stats.ts
export function statsOverviewSpec(hours = 24): QuerySpec {
  const from = fromIso(hours)
  return {
    queryKey: ['stats', 'overview', { from, compare: true }] as const,
    queryFn: async () => {
      const qs = new URLSearchParams({ from, compare: 'true' })
      const res = await apiGetServer<ApiEnvelope<StatsOverview>>(`/api/v1/stats/overview?${qs}`)
      return res.data
    },
  }
}

// Must exactly match statsTimeseriesQueryKey() in use-stats.ts
export function statsTimeseriesSpec(hours = 24): QuerySpec {
  const from = fromIso(hours)
  return {
    queryKey: ['stats', 'timeseries', { from }] as const,
    queryFn: async () => {
      const res = await apiGetServer<ApiEnvelope<TimeseriesPoint[]>>(
        `/api/v1/stats/timeseries?from=${from}`,
      )
      return res.data ?? []
    },
  }
}

// Must exactly match useStatsModels queryKey: ['stats', 'models', hours, undefined]
export function statsModelsSpec(hours = 24): QuerySpec {
  return {
    queryKey: ['stats', 'models', hours, undefined] as const,
    queryFn: async () => {
      const res = await apiGetServer<ApiEnvelope<ModelStat[]>>(
        `/api/v1/stats/models?hours=${hours}`,
      )
      return res.data ?? []
    },
    staleTime: 60_000,
  }
}

// Must exactly match useSpendForecast queryKey: ['stats', 'spend-forecast', undefined]
export function spendForecastSpec(): QuerySpec {
  return {
    queryKey: ['stats', 'spend-forecast', undefined] as const,
    queryFn: async () => {
      const res = await apiGetServer<ApiEnvelope<SpendForecast>>('/api/v1/stats/spend-forecast')
      return res.data ?? null
    },
    staleTime: 5 * 60_000,
  }
}
