'use client'

import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { ApiEnvelope } from './types'

/** Mirrors CacheSavingsSummary in apps/server/src/lib/cache-savings.ts. */
export interface CacheSavingsSummary {
  /** Estimated USD not paid this month thanks to discounted cache reads. */
  savingsUsd: number
  /** Total cached input tokens this month. */
  cacheReadTokens: number
  /** Requests this month that had at least one cache hit. */
  cacheHitRequests: number
  /** ISO timestamp of the UTC month boundary the window starts at. */
  monthStart: string
}

export function useCacheSavings() {
  return useQuery({
    queryKey: ['cache-savings'] as const,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<CacheSavingsSummary>>(
        '/api/v1/recommendations/cache-savings',
      )
      return res.data ?? null
    },
    staleTime: 10 * 60_000,
  })
}
