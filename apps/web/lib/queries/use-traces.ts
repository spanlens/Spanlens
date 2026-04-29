'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type {
  ApiEnvelope,
  TraceDetail,
  TraceRow,
  TracesPage,
  TraceStatus,
} from './types'

export interface TracesFilters {
  page: number
  limit?: number
  projectId?: string
  status?: TraceStatus | 'all'
  from?: string
  to?: string
}

export const tracesQueryKey = (filters: TracesFilters) => ['traces', filters] as const

export function useTraces(
  filters: TracesFilters,
  options?: { refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: tracesQueryKey(filters),
    queryFn: async (): Promise<TracesPage> => {
      const params = new URLSearchParams()
      params.set('page', String(filters.page))
      params.set('limit', String(filters.limit ?? 50))
      if (filters.projectId) params.set('projectId', filters.projectId)
      if (filters.status && filters.status !== 'all') params.set('status', filters.status)
      if (filters.from) params.set('from', filters.from)
      if (filters.to) params.set('to', filters.to)

      const res = await apiGet<ApiEnvelope<TraceRow[]>>(`/api/v1/traces?${params}`)
      return {
        data: res.data,
        meta: res.meta ?? { total: res.data.length, page: filters.page, limit: filters.limit ?? 50 },
      }
    },
    placeholderData: keepPreviousData,
    ...(options?.refetchInterval !== undefined ? { refetchInterval: options.refetchInterval } : {}),
  })
}

export const traceQueryKey = (id: string) => ['trace', id] as const

export function useTrace(id: string) {
  return useQuery({
    queryKey: traceQueryKey(id),
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<TraceDetail>>(`/api/v1/traces/${id}`)
      return res.data
    },
    enabled: Boolean(id),
    // Traces may still be in-flight — refetch every 10s if status is 'running'.
    refetchInterval: (query) => {
      const data = query.state.data as TraceDetail | undefined
      return data?.status === 'running' ? 10_000 : false
    },
  })
}
