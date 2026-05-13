'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '@/lib/api'
import type { ApiEnvelope } from './types'

export type ExperimentStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface Experiment {
  id: string
  organization_id: string
  name: string
  prompt_name: string
  version_a_id: string
  version_b_id: string
  dataset_id: string
  evaluator_id: string | null
  run_provider: 'openai' | 'anthropic'
  run_model: string
  status: ExperimentStatus
  total_items: number
  completed_items: number
  avg_score_a: number | null
  avg_score_b: number | null
  total_cost_usd: number
  error: string | null
  created_by: string | null
  started_at: string
  completed_at: string | null
}

export interface ExperimentResult {
  id: string
  experiment_id: string
  dataset_item_id: string
  output_a: string | null
  output_b: string | null
  cost_a_usd: number
  cost_b_usd: number
  latency_a_ms: number | null
  latency_b_ms: number | null
  tokens_a: number
  tokens_b: number
  score_a: number | null
  score_b: number | null
  reasoning_a: string | null
  reasoning_b: string | null
  error_a: string | null
  error_b: string | null
  created_at: string
  dataset_items?: {
    input: { variables?: Record<string, string>; messages?: Array<{ role: string; content: string }> }
    expected_output: string | null
  } | null
}

export function experimentsQueryKey(promptName?: string) {
  return promptName ? (['experiments', promptName] as const) : (['experiments'] as const)
}

export function useExperiments(promptName?: string) {
  return useQuery({
    queryKey: experimentsQueryKey(promptName),
    queryFn: async () => {
      const qs = promptName ? `?promptName=${encodeURIComponent(promptName)}` : ''
      const res = await apiGet<ApiEnvelope<Experiment[]>>(`/api/v1/experiments${qs}`)
      return res.data ?? []
    },
    staleTime: 30_000,
  })
}

export function useExperiment(id: string | null, options?: { pollWhilePending?: boolean }) {
  return useQuery({
    queryKey: ['experiment', id] as const,
    queryFn: async () => {
      if (!id) return null
      const res = await apiGet<ApiEnvelope<Experiment>>(`/api/v1/experiments/${id}`)
      return res.data
    },
    enabled: !!id,
    refetchInterval: (query) => {
      if (!options?.pollWhilePending) return false
      const data = query.state.data
      if (!data) return 2000
      return data.status === 'pending' || data.status === 'running' ? 2000 : false
    },
  })
}

export function useExperimentResults(id: string | null) {
  return useQuery({
    queryKey: ['experiment-results', id] as const,
    queryFn: async () => {
      if (!id) return []
      const res = await apiGet<ApiEnvelope<ExperimentResult[]>>(`/api/v1/experiments/${id}/results`)
      return res.data ?? []
    },
    enabled: !!id,
  })
}

export interface CreateExperimentInput {
  name: string
  promptName: string
  versionAId: string
  versionBId: string
  datasetId: string
  evaluatorId?: string
  runProvider: 'openai' | 'anthropic'
  runModel: string
}

export function useCreateExperiment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateExperimentInput) => {
      const res = await apiPost<ApiEnvelope<Experiment>>('/api/v1/experiments', input)
      return res.data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['experiments'] })
    },
  })
}
