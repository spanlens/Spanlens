'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { ApiEnvelope, StatsOverview, TimeseriesPoint, SpendForecast } from './types'

// Truncated to the minute — must match server-side fromIso() in lib/server/queries/stats.ts
// so the queryKey is stable across SSR render and client hydration.
function fromIso(hours: number): string {
  const fromMs = Math.floor((Date.now() - hours * 60 * 60 * 1000) / 60_000) * 60_000
  return new Date(fromMs).toISOString()
}

export const statsOverviewQueryKey = ['stats', 'overview'] as const

// When `from`/`to` are passed they override the rolling `hours` preset.
// The server (apps/server/src/api/stats.ts) accepts either form: a custom
// range uses the explicit bounds for both current and "previous period"
// comparison windows, while a preset is just hours-ago → now.
export function useStatsOverview(
  params?: { hours?: number; compare?: boolean; from?: string; to?: string },
  options?: { refetchInterval?: number },
) {
  const hours = params?.hours ?? 24
  const compare = params?.compare ?? false
  const customFrom = params?.from
  const customTo = params?.to
  return useQuery({
    queryKey: ['stats', 'overview', { hours, compare, from: customFrom ?? null, to: customTo ?? null }] as const,
    queryFn: async () => {
      const from = customFrom ?? fromIso(hours)
      const qs = new URLSearchParams({ from })
      if (customTo) qs.set('to', customTo)
      if (compare) qs.set('compare', 'true')
      const res = await apiGet<ApiEnvelope<StatsOverview>>(`/api/v1/stats/overview?${qs}`)
      return res.data
    },
    staleTime: 60_000,
    // Keep the previous range's data on screen while a new range loads, so
    // changing 24h → 7d doesn't flash the KPI skeletons.
    placeholderData: keepPreviousData,
    ...(options?.refetchInterval != null ? { refetchInterval: options.refetchInterval } : {}),
  })
}

export interface ModelStat {
  provider: string
  model: string
  requests: number
  totalCostUsd: number
  avgLatencyMs: number
  errorRate: number
}

export function useStatsModels(
  hours = 24,
  projectId?: string,
  options?: { refetchInterval?: number },
) {
  return useQuery({
    queryKey: ['stats', 'models', hours, projectId] as const,
    queryFn: async () => {
      const qs = new URLSearchParams({ hours: String(hours) })
      if (projectId) qs.set('projectId', projectId)
      const res = await apiGet<ApiEnvelope<ModelStat[]>>(`/api/v1/stats/models?${qs}`)
      return res.data ?? []
    },
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    ...(options?.refetchInterval != null ? { refetchInterval: options.refetchInterval } : {}),
  })
}

export function useSpendForecast(projectId?: string) {
  return useQuery({
    queryKey: ['stats', 'spend-forecast', projectId] as const,
    queryFn: async () => {
      const qs = new URLSearchParams()
      if (projectId) qs.set('projectId', projectId)
      const suffix = qs.size > 0 ? `?${qs}` : ''
      const res = await apiGet<ApiEnvelope<SpendForecast>>(`/api/v1/stats/spend-forecast${suffix}`)
      return res.data ?? null
    },
    staleTime: 5 * 60_000,
  })
}

export function statsTimeseriesQueryKey(params?: { hours?: number; from?: string; to?: string }) {
  return params ? (['stats', 'timeseries', params] as const) : (['stats', 'timeseries'] as const)
}

export function useStatsTimeseries(
  params?: { hours?: number; from?: string; to?: string },
  options?: { refetchInterval?: number },
) {
  const hours = params?.hours ?? 24
  const customFrom = params?.from
  const customTo = params?.to
  return useQuery({
    queryKey: statsTimeseriesQueryKey({
      hours,
      ...(customFrom != null ? { from: customFrom } : {}),
      ...(customTo != null ? { to: customTo } : {}),
    }),
    queryFn: async () => {
      const from = customFrom ?? fromIso(hours)
      const qs = new URLSearchParams({ from })
      if (customTo) qs.set('to', customTo)
      const res = await apiGet<ApiEnvelope<TimeseriesPoint[]>>(
        `/api/v1/stats/timeseries?${qs}`,
      )
      return res.data ?? []
    },
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    ...(options?.refetchInterval != null ? { refetchInterval: options.refetchInterval } : {}),
  })
}

export interface LatencyStats {
  sampleCount: number
  overheadSampleCount: number
  hours: number
  provider: { p50Ms: number; p95Ms: number; p99Ms: number; avgMs: number }
  overhead: {
    p50Ms: number; p95Ms: number; p99Ms: number; avgMs: number
    targetP95Ms: number; withinSla: boolean
  }
}

export function useStatsLatency(hours = 24) {
  return useQuery({
    queryKey: ['stats', 'latency', hours] as const,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<LatencyStats>>(`/api/v1/stats/latency?hours=${hours}`)
      return res.data
    },
    staleTime: 5 * 60_000,
  })
}
