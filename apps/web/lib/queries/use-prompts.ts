'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api'
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
  /** Actual number of versions that exist for this prompt name. */
  versionCount?: number
  content: string
  variables: Array<{ name: string; description?: string; required?: boolean }>
  metadata: Record<string, unknown>
  project_id: string | null
  created_at: string
  created_by: string | null
  is_archived?: boolean
  /** Aggregate from requests referencing any version of this prompt over the
   *  requested sinceHours window. Only present on the list endpoint (/api/v1/prompts). */
  stats?: PromptStats
  /** Quality score 0-100 (100 * (1 - errorRate)) for the window. Null = no data. */
  qualityScore?: number | null
  /** Running A/B experiment for this prompt, if any. */
  activeExperiment?: { id: string; trafficSplit: number } | null
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

// ── Experiment types ──────────────────────────────────────────────────────────

export interface PromptExperiment {
  id: string
  prompt_name: string
  version_a_id: string
  version_b_id: string
  traffic_split: number
  status: 'running' | 'concluded' | 'stopped'
  started_at: string
  ends_at: string | null
  concluded_at: string | null
  winner_version_id: string | null
  created_by: string | null
  project_id: string | null
}

export interface StatResult {
  statistic: number
  pValue: number
  significant: boolean
  relativeLift: number | null
}

export interface ExperimentArmStats {
  samples: number
  errorRate: number
  avgLatencyMs: number
  avgCostUsd: number
  totalCostUsd: number
  varLatency: number
  varCost: number
}

export interface ExperimentWithStats {
  experiment: PromptExperiment
  stats: {
    armA: ExperimentArmStats
    armB: ExperimentArmStats
    significance: {
      errorRate: StatResult
      latency: StatResult
      cost: StatResult
    }
  }
}

// ── Query keys ────────────────────────────────────────────────────────────────

export const promptsQueryKey = ['prompts'] as const
export const experimentsQueryKey = ['prompt-experiments'] as const

// ── Prompts hooks ─────────────────────────────────────────────────────────────

export function usePrompts(projectId?: string, sinceHours = 24) {
  return useQuery({
    queryKey: ['prompts', { projectId, sinceHours }] as const,
    queryFn: async () => {
      const params = new URLSearchParams()
      if (projectId) params.set('projectId', projectId)
      if (sinceHours !== 24) params.set('sinceHours', String(sinceHours))
      const suffix = params.toString() ? `?${params.toString()}` : ''
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

export function usePromptVersion(name: string | null, version: number | null) {
  return useQuery({
    queryKey: ['prompts', 'version', name, version] as const,
    enabled: !!name && !!version,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<PromptVersion>>(
        `/api/v1/prompts/${encodeURIComponent(name as string)}/${version}`,
      )
      return res.data ?? null
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

// ── Experiment hooks ──────────────────────────────────────────────────────────

export function usePromptExperiments(promptName?: string | null, status?: string) {
  return useQuery({
    queryKey: ['prompt-experiments', { promptName, status }] as const,
    queryFn: async () => {
      const params = new URLSearchParams()
      if (promptName) params.set('promptName', promptName)
      if (status) params.set('status', status)
      const suffix = params.toString() ? `?${params.toString()}` : ''
      const res = await apiGet<ApiEnvelope<PromptExperiment[]>>(
        `/api/v1/prompt-experiments${suffix}`,
      )
      return res.data ?? []
    },
  })
}

export function usePromptExperiment(id: string | null) {
  return useQuery({
    queryKey: ['prompt-experiments', id] as const,
    enabled: !!id,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<ExperimentWithStats>>(
        `/api/v1/prompt-experiments/${id}`,
      )
      return res.data ?? null
    },
  })
}

export function useCreateExperiment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      promptName: string
      versionAId: string
      versionBId: string
      trafficSplit?: number
      endsAt?: string | null
      projectId?: string | null
    }) => {
      const res = await apiPost<ApiEnvelope<PromptExperiment>>(
        '/api/v1/prompt-experiments',
        input,
      )
      return res.data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: promptsQueryKey })
      void qc.invalidateQueries({ queryKey: experimentsQueryKey })
    },
  })
}

// ── Playground hooks ──────────────────────────────────────────────────────────

export interface PlaygroundResult {
  responseText: string
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: number | null
  latencyMs: number
  missingVars: string[]
}

export function usePlaygroundRun() {
  return useMutation({
    mutationFn: async (input: {
      promptVersionId: string
      providerKeyId: string
      model: string
      variables?: Record<string, string>
      temperature?: number
      maxTokens?: number
    }) => {
      const res = await apiPost<{ success: boolean; data: PlaygroundResult }>(
        '/api/v1/prompts/playground/run',
        input,
      )
      return res.data
    },
  })
}

export function useUpdateExperiment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      id: string
      status?: 'concluded' | 'stopped'
      winnerVersionId?: string
      endsAt?: string | null
    }) => {
      const { id, ...body } = input
      const res = await apiPatch<ApiEnvelope<PromptExperiment>>(
        `/api/v1/prompt-experiments/${id}`,
        body,
      )
      return res.data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: promptsQueryKey })
      void qc.invalidateQueries({ queryKey: experimentsQueryKey })
    },
  })
}
