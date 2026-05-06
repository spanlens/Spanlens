import 'server-only'
import { apiGetServer } from '@/lib/server/api'
import type { AuditLogRow } from '@/lib/queries/use-audit-logs'
import type { QuerySpec } from '@/lib/server/dehydrate'
import type { ApiEnvelope } from '@/lib/queries/types'

interface AuditLogsParams {
  limit?: number
  offset?: number
  action?: string
}

// Must exactly match queryKey in use-audit-logs.ts → ['audit-logs', params]
export function auditLogsSpec(params: AuditLogsParams = {}): QuerySpec {
  return {
    queryKey: ['audit-logs', params] as const,
    queryFn: async () => {
      const qs = new URLSearchParams()
      if (params.limit) qs.set('limit', String(params.limit))
      if (params.offset) qs.set('offset', String(params.offset))
      if (params.action) qs.set('action', params.action)
      const suffix = qs.size > 0 ? `?${qs}` : ''
      const res = await apiGetServer<ApiEnvelope<AuditLogRow[]>>(`/api/v1/audit-logs${suffix}`)
      return res.data ?? []
    },
    staleTime: 30_000,
  }
}
