'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api'
import type { ApiEnvelope, CustomerRateLimit } from './types'

export const rateLimitsQueryKey = ['rate-limits'] as const

/** List customer-configured rate limits for a Spanlens key (key-level + its end-user limits). */
export function useRateLimits(apiKeyId: string | null) {
  return useQuery({
    queryKey: [...rateLimitsQueryKey, { apiKeyId }] as const,
    enabled: Boolean(apiKeyId),
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<CustomerRateLimit[]>>(
        `/api/v1/rate-limits?apiKeyId=${encodeURIComponent(apiKeyId as string)}`,
      )
      return res.data
    },
  })
}

export interface CreateRateLimitInput {
  target_type: 'api_key' | 'project' | 'end_user'
  api_key_id?: string
  project_id?: string
  end_user_id?: string
  max_requests: number
  window_seconds: number
}

export function useCreateRateLimit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateRateLimitInput) => {
      const res = await apiPost<ApiEnvelope<CustomerRateLimit>>('/api/v1/rate-limits', input)
      return res.data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: rateLimitsQueryKey })
    },
  })
}

export function useUpdateRateLimit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: {
      id: string
      max_requests?: number
      window_seconds?: number
      is_active?: boolean
    }) => {
      await apiPatch(`/api/v1/rate-limits/${id}`, patch)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: rateLimitsQueryKey })
    },
  })
}

export function useDeleteRateLimit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await apiDelete(`/api/v1/rate-limits/${id}`)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: rateLimitsQueryKey })
    },
  })
}
