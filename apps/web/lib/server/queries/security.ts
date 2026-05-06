import 'server-only'
import { apiGetServer } from '@/lib/server/api'
import type {
  FlaggedRequest,
  SecuritySummaryItem,
  SecuritySettings,
} from '@/lib/queries/use-security'
import type { QuerySpec } from '@/lib/server/dehydrate'
import type { ApiEnvelope } from '@/lib/queries/types'

// Must exactly match keys in use-security.ts
function securitySummaryQK(hours: number) {
  return ['security', 'summary', hours] as const
}
function securityFlaggedQK(params: { limit?: number; offset?: number } = {}) {
  return ['security', 'flagged', params] as const
}
const securitySettingsQK = ['security', 'settings'] as const

export function securitySummarySpec(hours = 24): QuerySpec {
  return {
    queryKey: securitySummaryQK(hours),
    queryFn: async () => {
      const res = await apiGetServer<ApiEnvelope<SecuritySummaryItem[]>>(
        `/api/v1/security/summary?hours=${hours}`,
      )
      return res.data ?? []
    },
    staleTime: 5 * 60_000,
  }
}

export function securityFlaggedSpec(params: { limit?: number; offset?: number } = {}): QuerySpec {
  return {
    queryKey: securityFlaggedQK(params),
    queryFn: async () => {
      const qs = new URLSearchParams()
      if (params.limit) qs.set('limit', String(params.limit))
      if (params.offset) qs.set('offset', String(params.offset))
      const suffix = qs.toString() ? `?${qs}` : ''
      const res = await apiGetServer<ApiEnvelope<FlaggedRequest[]>>(
        `/api/v1/security/flagged${suffix}`,
      )
      return { data: res.data ?? [], total: res.meta?.total ?? 0 }
    },
    staleTime: 5 * 60_000,
  }
}

export function securitySettingsSpec(): QuerySpec {
  return {
    queryKey: securitySettingsQK,
    queryFn: async () => {
      const res = await apiGetServer<ApiEnvelope<SecuritySettings>>(
        '/api/v1/security/settings',
      )
      return res.data ?? { alertEnabled: false, projects: [] }
    },
    staleTime: 30_000,
  }
}
