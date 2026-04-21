'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { ApiEnvelope, RequestDetail, RequestRow, RequestsPage } from './types'

export interface RequestsFilters {
  page: number
  limit?: number
  provider?: string
  model?: string
  projectId?: string
  from?: string
  to?: string
}

export function requestsQueryKey(filters: RequestsFilters) {
  return ['requests', filters] as const
}

export function useRequests(filters: RequestsFilters) {
  return useQuery({
    queryKey: requestsQueryKey(filters),
    queryFn: async (): Promise<RequestsPage> => {
      const params = new URLSearchParams()
      params.set('page', String(filters.page))
      params.set('limit', String(filters.limit ?? 50))
      if (filters.provider) params.set('provider', filters.provider)
      if (filters.model) params.set('model', filters.model)
      if (filters.projectId) params.set('projectId', filters.projectId)
      if (filters.from) params.set('from', filters.from)
      if (filters.to) params.set('to', filters.to)

      const res = await apiGet<ApiEnvelope<RequestRow[]>>(`/api/v1/requests?${params}`)
      return {
        data: res.data,
        // apiGet flattens `meta` off the envelope — re-read it below.
        meta: res.meta ?? { total: res.data.length, page: filters.page, limit: filters.limit ?? 50 },
      }
    },
    // Keep old page visible while the new page loads — avoids the table
    // flashing empty during pagination/filter changes.
    placeholderData: keepPreviousData,
  })
}

export const requestQueryKey = (id: string) => ['request', id] as const

export function useRequest(id: string) {
  return useQuery({
    queryKey: requestQueryKey(id),
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<RequestDetail>>(`/api/v1/requests/${id}`)
      return res.data
    },
    enabled: Boolean(id),
    // Request bodies are immutable once logged — cache generously.
    staleTime: 5 * 60_000,
  })
}
