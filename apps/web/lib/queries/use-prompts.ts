'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPost } from '@/lib/api'
import type { ApiEnvelope } from './types'

export interface PromptStats {
  calls: number
  totalCostUsd: number
  avgCostUsd: number | null
  avgLatencyMs: number | null
  errorRate: number | null
}

export interface PromptVersion {
  id: string
  name: string
  version: number
  content: string
  variables: Array<{ name: string; description?: string; required?: boolean }>
  metadata: Record<string, unknown>
  project_id: string | null
  created_at: string
  created_by: string | null
  /** 24h aggregate from requests referencing any version of this prompt.
   *  Only present on the list endpoint (/api/v1/prompts). */
  stats?: PromptStats
}

export interface PromptVersionMetrics {
  version: number
  promptVersionId: string
  createdAt: string
  sampleCount: number
  avgLatencyMs: number
  errorRate: number
  avgCostUsd: number
  totalCostUsd: number
  avgPromptTokens: number
  avgCompletionTokens: number
}

export const promptsQueryKey = ['prompts'] as const

export function usePrompts(projectId?: string) {
  return useQuery({
    queryKey: projectId ? (['prompts', { projectId }] as const) : promptsQueryKey,
    queryFn: async () => {
      const suffix = projectId ? `?projectId=${projectId}` : ''
      const res = await apiGet<ApiEnvelope<PromptVersion[]>>(`/api/v1/prompts${suffix}`)
      return res.data ?? []
    },
  })
}

export function usePromptVersions(name: string | null) {
  return useQuery({
    queryKey: ['prompts', 'versions', name] as const,
    enabled: !!name,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<PromptVersion[]>>(
        `/api/v1/prompts/${encodeURIComponent(name as string)}`,
      )
      return res.data ?? []
    },
  })
}

export function usePromptCompare(name: string | null, sinceHours = 24 * 30) {
  return useQuery({
    queryKey: ['prompts', 'compare', name, sinceHours] as const,
    enabled: !!name,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<PromptVersionMetrics[]>>(
        `/api/v1/prompts/${encodeURIComponent(name as string)}/compare?sinceHours=${sinceHours}`,
      )
      return res.data ?? []
    },
  })
}

export function useCreatePromptVersion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      name: string
      content: string
      variables?: Array<{ name: string; description?: string; required?: boolean }>
      metadata?: Record<string, unknown>
      projectId?: string | null
    }) => {
      const res = await apiPost<ApiEnvelope<PromptVersion>>('/api/v1/prompts', input)
      return res.data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: promptsQueryKey })
    },
  })
}

export function useDeletePromptVersion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name: string; version: number }) => {
      await apiDelete<ApiEnvelope<void>>(
        `/api/v1/prompts/${encodeURIComponent(input.name)}/${input.version}`,
      )
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: promptsQueryKey })
    },
  })
}
