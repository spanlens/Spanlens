'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiDelete } from '@/lib/api'
import type { ApiEnvelope } from './types'

export interface RecommendationApplication {
  id: string
  provider: string
  model: string
  suggestedProvider: string
  suggestedModel: string
  appliedAt: string
  note?: string
}

const QUERY_KEY = ['recommendation-applications'] as const

export function useRecommendationApplications() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<RecommendationApplication[]>>(
        '/api/v1/recommendation-applications',
      )
      return res.data ?? []
    },
    staleTime: 5 * 60_000,
  })
}

export function useMarkApplied() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (params: {
      provider: string
      model: string
      suggestedProvider: string
      suggestedModel: string
      note?: string
    }) =>
      apiPost<ApiEnvelope<{ id: string; appliedAt: string }>>(
        '/api/v1/recommendation-applications',
        params,
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QUERY_KEY }),
  })
}

export function useUnmarkApplied() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiDelete<ApiEnvelope<void>>(`/api/v1/recommendation-applications/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QUERY_KEY }),
  })
}
