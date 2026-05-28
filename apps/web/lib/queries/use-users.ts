'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { ApiEnvelope, UserAnalyticsDetail, UserAnalyticsPage, UserAnalyticsRow } from './types'

export interface UsersFilters {
  page: number
  limit?: number
  projectId?: string
  search?: string
  from?: string
  to?: string
  sortBy?: 'cost' | 'requests' | 'tokens' | 'last_seen' | 'latency'
  sortDir?: 'asc' | 'desc'
}

export function usersQueryKey(filters: UsersFilters) {
  return ['users', filters] as const
}

export function useUsers(filters: UsersFilters) {
  return useQuery({
    queryKey: usersQueryKey(filters),
    queryFn: async (): Promise<UserAnalyticsPage> => {
      const params = new URLSearchParams()
      params.set('page', String(filters.page))
      params.set('limit', String(filters.limit ?? 50))
      if (filters.projectId) params.set('projectId', filters.projectId)
      if (filters.search)    params.set('search', filters.search)
      if (filters.from)      params.set('from', filters.from)
      if (filters.to)        params.set('to', filters.to)
      if (filters.sortBy)    params.set('sortBy', filters.sortBy)
      if (filters.sortDir)   params.set('sortDir', filters.sortDir)
      const env = await apiGet<ApiEnvelope<UserAnalyticsRow[]>>(`/api/v1/users?${params.toString()}`)
      return {
        data: env.data ?? [],
        meta: env.meta ?? { total: 0, page: filters.page, limit: filters.limit ?? 50 },
      }
    },
    placeholderData: keepPreviousData,
  })
}

export function useUserDetail(userId: string | null, opts?: { projectId?: string; from?: string; to?: string }) {
  return useQuery({
    queryKey: ['user-detail', userId, opts] as const,
    enabled: Boolean(userId),
    queryFn: async (): Promise<UserAnalyticsDetail> => {
      const params = new URLSearchParams()
      if (opts?.projectId) params.set('projectId', opts.projectId)
      if (opts?.from)      params.set('from', opts.from)
      if (opts?.to)        params.set('to', opts.to)
      const qs = params.toString()
      const env = await apiGet<ApiEnvelope<UserAnalyticsDetail>>(
        `/api/v1/users/${encodeURIComponent(userId!)}${qs ? `?${qs}` : ''}`,
      )
      return env.data
    },
  })
}
