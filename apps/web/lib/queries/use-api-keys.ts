'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api'
import type { ApiEnvelope, ApiKey, IssuedApiKey } from './types'

/**
 * Spanlens (sl_live_*) keys. Under the unified-keys model these are
 * project-scoped and provider-agnostic — one key covers OpenAI, Anthropic
 * and Gemini calls so long as the corresponding provider key is registered
 * on the same project (see use-provider-keys.ts).
 */

export const apiKeysQueryKey = ['api-keys'] as const

export function useApiKeys(projectId?: string) {
  return useQuery({
    queryKey: projectId ? ([...apiKeysQueryKey, { projectId }] as const) : apiKeysQueryKey,
    queryFn: async () => {
      const path = projectId
        ? `/api/v1/api-keys?projectId=${encodeURIComponent(projectId)}`
        : '/api/v1/api-keys'
      const res = await apiGet<ApiEnvelope<ApiKey[]>>(path)
      return res.data
    },
  })
}

export function useIssueApiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name: string; projectId: string }) => {
      const res = await apiPost<ApiEnvelope<IssuedApiKey>>('/api/v1/api-keys/issue', input)
      return res.data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: apiKeysQueryKey })
    },
  })
}

export function useToggleApiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      await apiPatch(`/api/v1/api-keys/${id}`, { is_active })
    },
    onMutate: async ({ id, is_active }) => {
      await qc.cancelQueries({ queryKey: apiKeysQueryKey })
      const previous = qc.getQueriesData<ApiKey[]>({ queryKey: apiKeysQueryKey })
      qc.setQueriesData<ApiKey[]>({ queryKey: apiKeysQueryKey }, (old) =>
        (old ?? []).map((k) => (k.id === id ? { ...k, is_active } : k)),
      )
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      ctx?.previous.forEach(([key, data]) => qc.setQueryData(key, data))
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: apiKeysQueryKey })
    },
  })
}

export function useDeleteApiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await apiDelete(`/api/v1/api-keys/${id}`)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: apiKeysQueryKey })
    },
  })
}
