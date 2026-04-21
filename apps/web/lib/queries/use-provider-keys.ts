'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api'
import type { ApiEnvelope, ProviderKey } from './types'

export const providerKeysQueryKey = ['provider-keys'] as const

export function useProviderKeys() {
  return useQuery({
    queryKey: providerKeysQueryKey,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<ProviderKey[]>>('/api/v1/provider-keys')
      return res.data
    },
  })
}

export function useCreateProviderKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { provider: string; key: string; name: string }) => {
      const res = await apiPost<ApiEnvelope<ProviderKey>>('/api/v1/provider-keys', input)
      return res.data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: providerKeysQueryKey })
    },
  })
}

export function useRevokeProviderKey() {
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

export function useRotateProviderKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, key }: { id: string; key: string }) => {
      const res = await apiPatch<ApiEnvelope<ProviderKey>>(`/api/v1/provider-keys/${id}`, { key })
      return res.data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: providerKeysQueryKey })
    },
  })
}
