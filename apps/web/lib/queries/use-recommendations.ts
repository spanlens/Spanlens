'use client'

import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { ApiEnvelope } from './types'

export interface ModelRecommendation {
  currentProvider: string
  currentModel: string
  sampleCount: number
  avgPromptTokens: number
  avgCompletionTokens: number
  totalCostUsdLastNDays: number
  suggestedProvider: string
  suggestedModel: string
  estimatedMonthlySavingsUsd: number
  reason: string
}

export function useRecommendations(params: { hours?: number; minSavings?: number } = {}) {
  return useQuery({
    queryKey: ['recommendations', params] as const,
    queryFn: async () => {
      const qs = new URLSearchParams()
      if (params.hours) qs.set('hours', String(params.hours))
      if (params.minSavings) qs.set('minSavings', String(params.minSavings))
      const suffix = qs.size > 0 ? `?${qs}` : ''
      const res = await apiGet<ApiEnvelope<ModelRecommendation[]>>(
        `/api/v1/recommendations${suffix}`,
      )
      return res.data ?? []
    },
    staleTime: 10 * 60_000,
  })
}
