'use client'

import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { ApiEnvelope, StatsOverview, TimeseriesPoint } from './types'

export const statsOverviewQueryKey = ['stats', 'overview'] as const

export function useStatsOverview(
  params?: { projectId?: string; from?: string; to?: string },
  options?: { refetchInterval?: number },
) {
  return useQuery({
    queryKey: params ? ([...statsOverviewQueryKey, params] as const) : statsOverviewQueryKey,
    queryFn: async () => {
      const qs = new URLSearchParams()
      if (params?.projectId) qs.set('projectId', params.projectId)
      if (params?.from) qs.set('from', params.from)
      if (params?.to) qs.set('to', params.to)
      const suffix = qs.size > 0 ? `?${qs}` : ''
      const res = await apiGet<ApiEnvelope<StatsOverview>>(`/api/v1/stats/overview${suffix}`)
      return res.data
    },
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

export function useStatsModels(hours = 24, projectId?: string) {
  return useQuery({
    queryKey: ['stats', 'models', hours, projectId] as const,
    queryFn: async () => {
      const qs = new URLSearchParams({ hours: String(hours) })
      if (projectId) qs.set('projectId', projectId)
      const res = await apiGet<ApiEnvelope<ModelStat[]>>(`/api/v1/stats/models?${qs}`)
      return res.data ?? []
    },
    staleTime: 60_000,
  })
}

export function statsTimeseriesQueryKey(params?: { projectId?: string; from?: string; to?: string }) {
  return params ? (['stats', 'timeseries', params] as const) : (['stats', 'timeseries'] as const)
}

export function useStatsTimeseries(
  params?: { projectId?: string; from?: string; to?: string },
  options?: { refetchInterval?: number },
) {
  return useQuery({
    queryKey: statsTimeseriesQueryKey(params),
    queryFn: async () => {
      const qs = new URLSearchParams()
      if (params?.projectId) qs.set('projectId', params.projectId)
      if (params?.from) qs.set('from', params.from)
      if (params?.to) qs.set('to', params.to)
      const suffix = qs.size > 0 ? `?${qs}` : ''
      const res = await apiGet<ApiEnvelope<TimeseriesPoint[]>>(
        `/api/v1/stats/timeseries${suffix}`,
      )
      return res.data
    },
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
