'use client'

import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { ApiEnvelope } from './types'

export interface ModelPercentiles {
  p50PromptTokens: number
  p95PromptTokens: number
  p99PromptTokens: number
  p50CompletionTokens: number
  p95CompletionTokens: number
  p99CompletionTokens: number
  sampleCount: number
}

export function usePercentiles(params: {
  provider: string
  model: string
  hours: number
  enabled: boolean
}) {
  return useQuery({
    queryKey: ['recommendation-percentiles', params.provider, params.model, params.hours] as const,
    enabled: params.enabled && params.provider.length > 0 && params.model.length > 0,
    queryFn: async () => {
      const qs = new URLSearchParams({
        provider: params.provider,
        model: params.model,
        hours: String(params.hours),
      })
      const res = await apiGet<ApiEnvelope<ModelPercentiles | null>>(
        `/api/v1/recommendations/percentiles?${qs}`,
      )
      return res.data ?? null
    },
    staleTime: 5 * 60_000,
  })
}
