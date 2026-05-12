'use client'

import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { ApiEnvelope, StatsOverview, TimeseriesPoint, SpendForecast } from './types'

// Truncated to the minute — must match server-side fromIso() in lib/server/queries/stats.ts
// so the queryKey is stable across SSR render and client hydration.
function fromIso(hours: number): string {
  const fromMs = Math.floor((Date.now() - hours * 60 * 60 * 1000) / 60_000) * 60_000
  return new Date(fromMs).toISOString()
}

export const statsOverviewQueryKey = ['stats', 'overview'] as const

export function useStatsOverview(
  params?: { hours?: number; compare?: boolean },
  options?: { refetchInterval?: number },
) {
  const hours = params?.hours ?? 24
  const compare = params?.compare ?? false
  return useQuery({
    queryKey: ['stats', 'overview', { hours, compare }] as const,
    queryFn: async () => {
      const from = fromIso(hours)
      const qs = new URLSearchParams({ from })
      if (compare) qs.set('compare', 'true')
      const res = await apiGet<ApiEnvelope<StatsOverview>>(`/api/v1/stats/overview?${qs}`)
      return res.data
    },
    staleTime: 60_000,
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

export function statsTimeseriesQueryKey(params?: { hours?: number }) {
  return params ? (['stats', 'timeseries', params] as const) : (['stats', 'timeseries'] as const)
}

export function useStatsTimeseries(
  params?: { hours?: number },
  options?: { refetchInterval?: number },
) {
  const hours = params?.hours ?? 24
  return useQuery({
    queryKey: statsTimeseriesQueryKey({ hours }),
    queryFn: async () => {
      const from = fromIso(hours)
      const res = await apiGet<ApiEnvelope<TimeseriesPoint[]>>(
        `/api/v1/stats/timeseries?from=${from}`,
      )
      return res.data ?? []
    },
    staleTime: 60_000,
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
