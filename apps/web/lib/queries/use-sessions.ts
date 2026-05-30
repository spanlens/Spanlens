'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { ApiEnvelope, SessionAnalyticsRow, SessionDetail } from './types'

export interface SessionsFilters {
  page: number
  limit?: number
  projectId?: string
  userId?: string
  search?: string
  from?: string
  to?: string
  sortBy?: 'cost' | 'requests' | 'tokens' | 'last_seen' | 'latency'
  sortDir?: 'asc' | 'desc'
}

export interface SessionsPage {
  data: SessionAnalyticsRow[]
  meta: { total: number; page: number; limit: number }
}

export const sessionsQueryKey = (filters: SessionsFilters) => ['sessions', filters] as const

export function useSessions(filters: SessionsFilters) {
  return useQuery({
    queryKey: sessionsQueryKey(filters),
    queryFn: async (): Promise<SessionsPage> => {
      const params = new URLSearchParams()
      params.set('page', String(filters.page))
      params.set('limit', String(filters.limit ?? 50))
      if (filters.projectId) params.set('projectId', filters.projectId)
      if (filters.userId)    params.set('userId', filters.userId)
      if (filters.search)    params.set('search', filters.search)
      if (filters.from)      params.set('from', filters.from)
      if (filters.to)        params.set('to', filters.to)
      if (filters.sortBy)    params.set('sortBy', filters.sortBy)
      if (filters.sortDir)   params.set('sortDir', filters.sortDir)
      const env = await apiGet<ApiEnvelope<SessionAnalyticsRow[]>>(`/api/v1/sessions?${params.toString()}`)
      return {
        data: env.data ?? [],
        meta: env.meta ?? { total: 0, page: filters.page, limit: filters.limit ?? 50 },
      }
    },
    placeholderData: keepPreviousData,
  })
}

export function useSession(
  sessionId: string,
  opts?: { projectId?: string; from?: string; to?: string },
) {
  return useQuery({
    queryKey: ['session-detail', sessionId, opts] as const,
    enabled: Boolean(sessionId),
    queryFn: async (): Promise<SessionDetail> => {
      const params = new URLSearchParams()
      if (opts?.projectId) params.set('projectId', opts.projectId)
      if (opts?.from)      params.set('from', opts.from)
      if (opts?.to)        params.set('to', opts.to)
      const qs = params.toString()
      const env = await apiGet<ApiEnvelope<SessionDetail>>(
        `/api/v1/sessions/${encodeURIComponent(sessionId)}${qs ? `?${qs}` : ''}`,
      )
      return env.data
    },
  })
}
