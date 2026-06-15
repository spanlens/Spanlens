'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPost } from '@/lib/api'
import type { ApiEnvelope } from './types'

// ── Types ────────────────────────────────────────────────────────────────────

/** P1-7 — a few-shot calibration anchor (example response + the score it should get). */
export interface JudgeAnchor {
  response: string
  score: number
  reasoning?: string
}

export interface JudgeConfig {
  criterion: string
  judge_provider: 'openai' | 'anthropic' | 'gemini' | 'azure' | 'mistral' | 'openrouter'
  judge_model: string
  scale_min: number
  scale_max: number
  /** P1-7 — optional free-form scoring rubric injected into the judge prompt. */
  rubric?: string
  /** P1-7 — optional few-shot calibration anchors (NUMERIC judges). */
  anchors?: JudgeAnchor[]
  /** P2-11 — for trajectory evaluators: the trace name being scored. */
  trace_name?: string
}

export type EvaluatorType =
  | 'llm_judge'
  | 'regex'
  | 'json_schema'
  | 'exact_match'
  | 'contains'
  | 'embedding'
  | 'trajectory'

export interface Evaluator {
  id: string
  organization_id: string
  prompt_name: string
  name: string
  type: EvaluatorType
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
  /** P1-7 (3/3): 'single' (absolute scoring) or 'pairwise' (A vs B). Older rows
   * created before the migration have no value — treat undefined as 'single'. */
  mode?: 'single' | 'pairwise'
  /** The "B" prompt version for a pairwise run (compared against prompt_version_id = A). */
  prompt_version_b_id?: string | null
  /** Pairwise tally. Null/absent for single-mode runs. */
  a_wins?: number | null
  b_wins?: number | null
  ties?: number | null
  /** P2-11 — for trajectory runs: the trace name that was scored (prompt_version_id is null). */
  trace_name?: string | null
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
  /** P1-7 (3/3): pairwise winner ('a' | 'b' | 'tie'); null for single-mode results. */
  winner?: 'a' | 'b' | 'tie' | null
  /** P2-11 — for trajectory results: the evaluated trace id. */
  trace_id?: string | null
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
  | {
      // P2-11 — trajectory evaluator binds to a TRACE name, not a prompt.
      name: string
      type: 'trajectory'
      traceName: string
      config: JudgeConfig
    }
)

export function useCreateEvaluator() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateEvaluatorInput) => {
      const body: Record<string, unknown> = {
        name: input.name,
        type: input.type ?? 'llm_judge',
        config: input.config,
      }
      if (input.type === 'trajectory') {
        body.traceName = input.traceName
      } else {
        body.promptName = input.promptName
        if (input.type === undefined || input.type === 'llm_judge') {
          if (input.scoreConfigId) body.scoreConfigId = input.scoreConfigId
        }
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
      const groupKey = vars.type === 'trajectory' ? vars.traceName : vars.promptName
      void qc.invalidateQueries({ queryKey: evaluatorsQueryKey(groupKey) })
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
  /** Required for all run types except trajectory (which targets traces by name). */
  promptVersionId?: string
  source?: 'production' | 'dataset'
  datasetId?: string
  sampleSize: number
  sampleFrom?: string
  sampleTo?: string
  /** Required when source = 'dataset' — used to generate the response that
   *  then gets scored by the judge. */
  runProvider?: 'openai' | 'anthropic' | 'gemini' | 'azure' | 'mistral' | 'openrouter'
  runModel?: string
  /** P1-7 (3/3): 'pairwise' compares promptVersionId (A) vs promptVersionBId (B).
   *  Requires source = 'dataset' + runProvider/runModel. */
  mode?: 'single' | 'pairwise'
  promptVersionBId?: string
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
