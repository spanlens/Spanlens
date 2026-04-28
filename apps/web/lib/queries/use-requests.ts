'use client'

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiDelete, apiGet, apiPost } from '@/lib/api'
import type { ApiEnvelope, RequestDetail, RequestRow, RequestsPage } from './types'

export interface RequestsFilters {
  page: number
  limit?: number
  provider?: string
  model?: string
  status?: string
  projectId?: string
  providerKeyId?: string
  from?: string
  to?: string
  sortBy?: string
  sortDir?: 'asc' | 'desc'
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
      if (filters.status) params.set('status', filters.status)
      if (filters.projectId) params.set('projectId', filters.projectId)
      if (filters.providerKeyId) params.set('providerKeyId', filters.providerKeyId)
      if (filters.from) params.set('from', filters.from)
      if (filters.to) params.set('to', filters.to)
      if (filters.sortBy) params.set('sortBy', filters.sortBy)
      if (filters.sortDir) params.set('sortDir', filters.sortDir)

      const res = await apiGet<ApiEnvelope<RequestRow[]>>(`/api/v1/requests?${params}`)
      return {
        data: res.data,
        meta: res.meta ?? { total: res.data.length, page: filters.page, limit: filters.limit ?? 50 },
      }
    },
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
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
    // Window focus / mount should not re-trigger a detail fetch — the data
    // doesn't change and we don't want spurious network calls.
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    // 404 = resource doesn't exist; retrying only spams the console.
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 404) return false
      return failureCount < 3
    },
  })
}

// ── Replay ──────────────────────────────────────────────────────────────

export interface ReplayResponse {
  provider: string
  proxyPath: string
  replayBody: Record<string, unknown>
}

/**
 * Server prepares a replay payload (optionally swapping the model). Caller
 * then POSTs the result to `proxyPath` with the org's API key — same flow as
 * a normal SDK call, so it counts toward quotas + logs as a fresh requests
 * row. We do NOT execute the upstream call server-side because that would
 * skip our own observability path.
 */
export function useReplayRequest() {
  return useMutation({
    mutationFn: async (input: { id: string; model?: string }) => {
      const res = await apiPost<ApiEnvelope<ReplayResponse>>(
        `/api/v1/requests/${input.id}/replay`,
        input.model ? { model: input.model } : {},
      )
      return res.data
    },
  })
}

// ── Saved filters ───────────────────────────────────────────────────────

export interface SavedFilter {
  id: string
  name: string
  filters: Partial<RequestsFilters>
  created_at: string
}

export const savedFiltersQueryKey = ['saved-filters'] as const

export function useSavedFilters() {
  return useQuery({
    queryKey: savedFiltersQueryKey,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<SavedFilter[]>>('/api/v1/saved-filters')
      return res.data
    },
    staleTime: 60_000,
  })
}

export function useCreateSavedFilter() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name: string; filters: Partial<RequestsFilters> }) => {
      const res = await apiPost<ApiEnvelope<SavedFilter>>('/api/v1/saved-filters', input)
      return res.data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: savedFiltersQueryKey })
    },
  })
}

export function useDeleteSavedFilter() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await apiDelete<ApiEnvelope<unknown>>(`/api/v1/saved-filters/${id}`)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: savedFiltersQueryKey })
    },
  })
}
