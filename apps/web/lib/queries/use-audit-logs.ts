'use client'

import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { ApiEnvelope } from './types'

export interface AuditLogRow {
  id: string
  action: string
  resource_type: string
  resource_id: string | null
  user_id: string | null
  metadata: Record<string, unknown> | null
  ip_address: string | null
  created_at: string
}

export interface UseAuditLogsParams {
  limit?: number
  offset?: number
  action?: string
}

export function useAuditLogs(params: UseAuditLogsParams = {}) {
  return useQuery({
    queryKey: ['audit-logs', params] as const,
    queryFn: async () => {
      const qs = new URLSearchParams()
      if (params.limit) qs.set('limit', String(params.limit))
      if (params.offset) qs.set('offset', String(params.offset))
      if (params.action) qs.set('action', params.action)
      const suffix = qs.size > 0 ? `?${qs}` : ''
      const res = await apiGet<ApiEnvelope<AuditLogRow[]>>(`/api/v1/audit-logs${suffix}`)
      return res.data ?? []
    },
    staleTime: 30_000,
  })
}
