'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api'
import type { ApiEnvelope, ProviderKey } from './types'

export const providerKeysQueryKey = ['provider-keys'] as const

/**
 * List provider AI keys (OpenAI / Anthropic / Gemini). Under the
 * nested-keys model these belong to a specific Spanlens (sl_live_*) key
 * — pass `apiKeyId` to scope the list to that key only.
 *
 * Without `apiKeyId`, returns every provider key in the org (used by the
 * requests-page filter dropdown).
 */
export function useProviderKeys(apiKeyId?: string) {
  return useQuery({
    queryKey: apiKeyId
      ? ([...providerKeysQueryKey, { apiKeyId }] as const)
      : providerKeysQueryKey,
    queryFn: async () => {
      const path = apiKeyId
        ? `/api/v1/provider-keys?apiKeyId=${encodeURIComponent(apiKeyId)}`
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
      api_key_id: string
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
