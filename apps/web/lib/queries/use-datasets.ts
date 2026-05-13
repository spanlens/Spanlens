'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPost } from '@/lib/api'
import type { ApiEnvelope } from './types'

export interface Dataset {
  id: string
  organization_id: string
  name: string
  description: string | null
  created_by: string | null
  created_at: string
  archived_at: string | null
  /** Populated only by GET /datasets list endpoint. */
  item_count?: number
}

export interface DatasetItem {
  id: string
  organization_id: string
  dataset_id: string
  input: { variables?: Record<string, string>; messages?: Array<{ role: string; content: string }> }
  expected_output: string | null
  source_request_id: string | null
  created_at: string
}

export interface DatasetWithItems extends Dataset {
  items: DatasetItem[]
}

// ── Datasets ────────────────────────────────────────────────────────────────

export function datasetsQueryKey() {
  return ['datasets'] as const
}

export function useDatasets() {
  return useQuery({
    queryKey: datasetsQueryKey(),
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<Dataset[]>>('/api/v1/datasets')
      return res.data ?? []
    },
    staleTime: 60_000,
  })
}

export function useDataset(id: string | null) {
  return useQuery({
    queryKey: ['datasets', id] as const,
    queryFn: async () => {
      if (!id) return null
      const res = await apiGet<ApiEnvelope<DatasetWithItems>>(`/api/v1/datasets/${id}`)
      return res.data
    },
    enabled: !!id,
    staleTime: 30_000,
  })
}

export function useCreateDataset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name: string; description?: string }) => {
      const res = await apiPost<ApiEnvelope<Dataset>>('/api/v1/datasets', input)
      return res.data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: datasetsQueryKey() })
    },
  })
}

export function useDeleteDataset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await apiDelete(`/api/v1/datasets/${id}`)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: datasetsQueryKey() })
    },
  })
}

// ── Items ───────────────────────────────────────────────────────────────────

export interface AddItemInput {
  datasetId: string
  input: { variables?: Record<string, string>; messages?: Array<{ role: string; content: string }> }
  expectedOutput?: string
  sourceRequestId?: string
}

export function useAddDatasetItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: AddItemInput) => {
      const res = await apiPost<ApiEnvelope<DatasetItem>>(
        `/api/v1/datasets/${input.datasetId}/items`,
        {
          input: input.input,
          expectedOutput: input.expectedOutput,
          sourceRequestId: input.sourceRequestId,
        },
      )
      return res.data
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['datasets', vars.datasetId] })
      void qc.invalidateQueries({ queryKey: datasetsQueryKey() })
    },
  })
}

export function useImportRequestsToDataset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { datasetId: string; requestIds: string[] }) => {
      const res = await apiPost<ApiEnvelope<{ imported: number }>>(
        `/api/v1/datasets/${input.datasetId}/items/import-requests`,
        { requestIds: input.requestIds },
      )
      return res.data
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['datasets', vars.datasetId] })
      void qc.invalidateQueries({ queryKey: datasetsQueryKey() })
    },
  })
}

export function useDeleteDatasetItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { datasetId: string; itemId: string }) => {
      await apiDelete(`/api/v1/datasets/${input.datasetId}/items/${input.itemId}`)
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['datasets', vars.datasetId] })
      void qc.invalidateQueries({ queryKey: datasetsQueryKey() })
    },
  })
}
