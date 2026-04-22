'use client'

import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { ApiEnvelope } from './types'

export interface SecurityFlag {
  type: 'pii' | 'injection'
  pattern: string
  sample: string
}

export interface FlaggedRequest {
  id: string
  provider: string
  model: string
  status_code: number
  latency_ms: number
  cost_usd: number | null
  flags: SecurityFlag[]
  created_at: string
}

export interface SecuritySummaryItem {
  type: string
  pattern: string
  count: number
}

export function useSecurityFlagged(params: { limit?: number; offset?: number } = {}) {
  return useQuery({
    queryKey: ['security', 'flagged', params] as const,
    queryFn: async () => {
      const qs = new URLSearchParams()
      if (params.limit) qs.set('limit', String(params.limit))
      if (params.offset) qs.set('offset', String(params.offset))
      const suffix = qs.size > 0 ? `?${qs}` : ''
      const res = await apiGet<ApiEnvelope<FlaggedRequest[]>>(
        `/api/v1/security/flagged${suffix}`,
      )
      return res.data ?? []
    },
  })
}

export function useSecuritySummary(hours = 24) {
  return useQuery({
    queryKey: ['security', 'summary', hours] as const,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<SecuritySummaryItem[]>>(
        `/api/v1/security/summary?hours=${hours}`,
      )
      return res.data ?? []
    },
    staleTime: 5 * 60_000,
  })
}
