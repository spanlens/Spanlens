'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPost } from '@/lib/api'
import type { ApiEnvelope, ApiKey, CreatedApiKey } from './types'

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

export function useCreateApiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name: string; projectId: string }) => {
      const res = await apiPost<ApiEnvelope<CreatedApiKey>>('/api/v1/api-keys', input)
      return res.data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: apiKeysQueryKey })
    },
  })
}

export function useRevokeApiKey() {
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
