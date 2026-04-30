'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPatch } from '@/lib/api'
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
  response_flags: SecurityFlag[]
  created_at: string
}

export interface SecuritySummaryItem {
  type: string
  pattern: string
  count: number
}

export interface FlaggedResult {
  data: FlaggedRequest[]
  total: number
}

export interface SecurityProject {
  id: string
  name: string
  blockEnabled: boolean
}

export interface SecuritySettings {
  alertEnabled: boolean
  projects: SecurityProject[]
}

export function useSecurityFlagged(params: { limit?: number; offset?: number } = {}) {
  return useQuery({
    queryKey: ['security', 'flagged', params] as const,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<FlaggedResult> => {
      const qs = new URLSearchParams()
      if (params.limit) qs.set('limit', String(params.limit))
      if (params.offset) qs.set('offset', String(params.offset))
      const suffix = qs.toString() ? `?${qs}` : ''
      const res = await apiGet<ApiEnvelope<FlaggedRequest[]>>(
        `/api/v1/security/flagged${suffix}`,
      )
      return { data: res.data ?? [], total: res.meta?.total ?? 0 }
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

export function useSecuritySettings() {
  return useQuery({
    queryKey: ['security', 'settings'] as const,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<SecuritySettings>>(
        '/api/v1/security/settings',
      )
      return res.data ?? { alertEnabled: false, projects: [] }
    },
    staleTime: 30_000,
  })
}

export function useToggleSecurityAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (enabled: boolean) =>
      apiPatch<ApiEnvelope<{ alertEnabled: boolean }>>(
        '/api/v1/security/alert',
        { enabled },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['security', 'settings'] })
    },
  })
}

export function useToggleProjectBlock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, enabled }: { projectId: string; enabled: boolean }) =>
      apiPatch<ApiEnvelope<{ projectId: string; blockEnabled: boolean }>>(
        `/api/v1/security/projects/${projectId}/block`,
        { enabled },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['security', 'settings'] })
    },
  })
}
