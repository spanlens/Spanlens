'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPost } from '@/lib/api'
import type { ApiEnvelope } from './types'

// ── Types ────────────────────────────────────────────────────────────────────

export interface JudgeConfig {
  criterion: string
  judge_provider: 'openai' | 'anthropic' | 'gemini' | 'azure' | 'mistral' | 'openrouter'
  judge_model: string
  scale_min: number
  scale_max: number
}

export interface Evaluator {
  id: string
  organization_id: string
  prompt_name: string
  name: string
  type: 'llm_judge'
  config: JudgeConfig
  created_by: string | null
  created_at: string
  archived_at: string | null
}

export type EvalRunStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface EvalRun {
  id: string
  organization_id: string
  evaluator_id: string
  prompt_version_id: string
  /** Optional dataset link. Set when source is 'dataset'. */
  dataset_id?: string | null
  source: 'production' | 'dataset'
  sample_size: number
  sample_from: string | null
  sample_to: string | null
  status: EvalRunStatus
  scored_count: number
  /** Samples sent to the judge after the empty-response filter. 0 on rows
   * created before the P0-2 migration (treat as "rate unavailable"). */
  attempted_count: number
  /** Samples whose judge call failed (attempted - scored). */
  failed_count: number
  avg_score: number | null
  /** P1-7: sample standard deviation of the scores behind avg_score. Backs the
   * 95% CI shown next to the average. null for runs with <2 numeric samples or
   * non-mean evaluator types (CATEGORICAL / TEXT), and for pre-migration rows. */
  score_stddev: number | null
  total_cost_usd: number
  error: string | null
  created_by: string | null
  started_at: string
  completed_at: string | null
  /** Embedded evaluator (from GET /eval-runs/:id) */
  evaluators?: { name: string; config: JudgeConfig } | null
}

export interface EvalResult {
  id: string
  eval_run_id: string
  request_id: string | null
  dataset_item_id: string | null
  score: number
  reasoning: string | null
  judge_cost_usd: number
  judge_tokens: number
  created_at: string
}

// ── Evaluators ──────────────────────────────────────────────────────────────

export function evaluatorsQueryKey(promptName?: string) {
  return promptName ? (['evaluators', promptName] as const) : (['evaluators'] as const)
}

export function useEvaluators(promptName?: string) {
  return useQuery({
    queryKey: evaluatorsQueryKey(promptName),
    queryFn: async () => {
      const qs = promptName ? `?promptName=${encodeURIComponent(promptName)}` : ''
      const res = await apiGet<ApiEnvelope<Evaluator[]>>(`/api/v1/evaluators${qs}`)
      return res.data ?? []
    },
    staleTime: 60_000,
  })
}

/**
 * R-7 Phase 1: code evaluator config shapes.
 *
 * Both are deterministic per-sample checks. The server stores them as
 * the evaluator row's `config` jsonb verbatim, and the runner
 * dispatches on `evaluator.type` (not on which keys are present).
 */
export interface RegexConfig {
  pattern: string
  flags?: string
}

export interface JsonSchemaConfig {
  schema: unknown
}

export interface ExactMatchConfig {
  value: string
  caseSensitive?: boolean
  trim?: boolean
}

export interface ContainsConfig {
  substring: string
  caseSensitive?: boolean
}

export interface EmbeddingConfig {
  provider: string
  model: string
  reference_text?: string
  threshold?: number
}

/** P2-10 — auto-run-on-version config, common to every evaluator type. */
export interface AutoRunFields {
  autoRunOnVersion?: boolean
  autoRunDatasetId?: string
  autoRunProvider?: string
  autoRunModel?: string
  autoRunSampleSize?: number
}

export type CreateEvaluatorInput = AutoRunFields & (
  | {
      promptName: string
      name: string
      type?: 'llm_judge'
      config: JudgeConfig
      /** 4B.1c — optional pointer at a typed score config. NULL preserves
       *  the legacy NUMERIC 0..1 behaviour. */
      scoreConfigId?: string | null
    }
  | {
      promptName: string
      name: string
      type: 'regex'
      config: RegexConfig
    }
  | {
      promptName: string
      name: string
      type: 'json_schema'
      config: JsonSchemaConfig
    }
  | {
      promptName: string
      name: string
      type: 'exact_match'
      config: ExactMatchConfig
    }
  | {
      promptName: string
      name: string
      type: 'contains'
      config: ContainsConfig
    }
  | {
      promptName: string
      name: string
      type: 'embedding'
      config: EmbeddingConfig
    }
)

export function useCreateEvaluator() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateEvaluatorInput) => {
      const body: Record<string, unknown> = {
        promptName: input.promptName,
        name: input.name,
        type: input.type ?? 'llm_judge',
        config: input.config,
      }
      if (input.type === undefined || input.type === 'llm_judge') {
        if (input.scoreConfigId) body.scoreConfigId = input.scoreConfigId
      }
      // P2-10 auto-run config (common to all types).
      if (input.autoRunOnVersion) {
        body.autoRunOnVersion = true
        body.autoRunDatasetId = input.autoRunDatasetId
        body.autoRunProvider = input.autoRunProvider
        body.autoRunModel = input.autoRunModel
        if (input.autoRunSampleSize != null) body.autoRunSampleSize = input.autoRunSampleSize
      }
      const res = await apiPost<ApiEnvelope<Evaluator>>('/api/v1/evaluators', body)
      return res.data
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: evaluatorsQueryKey(vars.promptName) })
      void qc.invalidateQueries({ queryKey: evaluatorsQueryKey() })
    },
  })
}

export function useDeleteEvaluator() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await apiDelete(`/api/v1/evaluators/${id}`)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['evaluators'] })
    },
  })
}

// ── Eval runs ───────────────────────────────────────────────────────────────

export function evalRunsQueryKey(filters?: { evaluatorId?: string; promptVersionId?: string }) {
  return filters ? (['eval-runs', filters] as const) : (['eval-runs'] as const)
}

export function useEvalRuns(filters?: { evaluatorId?: string; promptVersionId?: string }) {
  return useQuery({
    queryKey: evalRunsQueryKey(filters),
    queryFn: async () => {
      const qs = new URLSearchParams()
      if (filters?.evaluatorId) qs.set('evaluatorId', filters.evaluatorId)
      if (filters?.promptVersionId) qs.set('promptVersionId', filters.promptVersionId)
      const suffix = qs.size > 0 ? `?${qs}` : ''
      const res = await apiGet<ApiEnvelope<EvalRun[]>>(`/api/v1/eval-runs${suffix}`)
      return res.data ?? []
    },
    staleTime: 30_000,
  })
}

export function useEvalRun(id: string | null, options?: { pollWhilePending?: boolean }) {
  return useQuery({
    queryKey: ['eval-run', id] as const,
    queryFn: async () => {
      if (!id) return null
      const res = await apiGet<ApiEnvelope<EvalRun>>(`/api/v1/eval-runs/${id}`)
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

export function useEvalResults(runId: string | null) {
  return useQuery({
    queryKey: ['eval-results', runId] as const,
    queryFn: async () => {
      if (!runId) return []
      const res = await apiGet<ApiEnvelope<EvalResult[]>>(`/api/v1/eval-runs/${runId}/results`)
      return res.data ?? []
    },
    enabled: !!runId,
  })
}

export interface CreateEvalRunInput {
  evaluatorId: string
  promptVersionId: string
  source?: 'production' | 'dataset'
  datasetId?: string
  sampleSize: number
  sampleFrom?: string
  sampleTo?: string
  /** Required when source = 'dataset' — used to generate the response that
   *  then gets scored by the judge. */
  runProvider?: 'openai' | 'anthropic' | 'gemini' | 'azure' | 'mistral' | 'openrouter'
  runModel?: string
}

export function useCreateEvalRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateEvalRunInput) => {
      const res = await apiPost<ApiEnvelope<EvalRun>>('/api/v1/eval-runs', input)
      return res.data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['eval-runs'] })
    },
  })
}

export function useEstimateEvalCost() {
  return useMutation({
    mutationFn: async (input: { sampleSize: number; judgeModel: string }) => {
      const res = await apiPost<ApiEnvelope<{ estimateUsd: number }>>(
        '/api/v1/eval-runs/estimate',
        input,
      )
      return res.data
    },
  })
}
