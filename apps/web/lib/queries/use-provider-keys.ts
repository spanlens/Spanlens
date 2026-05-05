'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api'
import type { ApiEnvelope, ProviderKey } from './types'

export const providerKeysQueryKey = ['provider-keys'] as const

/**
 * List provider AI keys (OpenAI / Anthropic / Gemini) for a project.
 * Under the unified-keys model these are independent of Spanlens keys —
 * a single sl_live_* covers all providers registered on the same project.
 */
export function useProviderKeys(projectId?: string) {
  return useQuery({
    queryKey: projectId
      ? ([...providerKeysQueryKey, { projectId }] as const)
      : providerKeysQueryKey,
    queryFn: async () => {
      const path = projectId
        ? `/api/v1/provider-keys?projectId=${encodeURIComponent(projectId)}`
        : '/api/v1/provider-keys'
      const res = await apiGet<ApiEnvelope<ProviderKey[]>>(path)
      return res.data
    },
  })
}

export function useAddProviderKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      provider: 'openai' | 'anthropic' | 'gemini'
      key: string
      name: string
      project_id: string
    }) => {
      const res = await apiPost<ApiEnvelope<ProviderKey>>('/api/v1/provider-keys', input)
      return res.data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: providerKeysQueryKey })
    },
  })
}

export function useRotateProviderKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, key }: { id: string; key: string }) => {
      await apiPatch(`/api/v1/provider-keys/${id}`, { key })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: providerKeysQueryKey })
    },
  })
}

export function useDeleteProviderKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await apiDelete(`/api/v1/provider-keys/${id}`)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: providerKeysQueryKey })
    },
  })
}
