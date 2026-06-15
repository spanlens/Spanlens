'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPost } from '@/lib/api'
import type { ApiEnvelope } from './types'

// ── Types ────────────────────────────────────────────────────────────────────

export interface AnnotationQueueItem {
  id: string
  prompt_version_id: string | null
  prompt_name: string | null
  prompt_version: number | null
  model: string
  created_at: string
  request_body: Record<string, unknown> | null
  response_body: Record<string, unknown> | null
  llm_judge_score: number | null
  human_eval: {
    // Legacy NUMERIC score; nullable so categorical/boolean/text rows
    // can save without inventing a fake float.
    score: number | null
    raw_score: number | null
    comment: string | null
    // 4B.1 typed value columns. Exactly one of value_number /
    // value_string / value_boolean is non-null for a given row; the
    // matching score_config row decides which.
    score_config_id: string | null
    value_number: number | null
    value_string: string | null
    value_boolean: boolean | null
  } | null
}

export interface HumanEval {
  id: string
  organization_id: string
  request_id: string
  prompt_version_id: string | null
  reviewer_id: string
  score: number
  raw_score: number | null
  comment: string | null
  created_at: string
  updated_at: string
}

export interface CorrelationPair {
  requestId: string
  judgeScore: number
  humanScore: number
}

/** P3-19: server-computed agreement statistic. Pearson for numeric scores,
 *  Cohen's κ for typed-config labels (CATEGORICAL / BOOLEAN). null when there's
 *  not enough data or the label set is degenerate. */
export interface CorrelationAgreement {
  metric: 'pearson' | 'kappa'
  value: number
  n: number
  interpretation: 'none' | 'weak' | 'moderate' | 'strong'
}

/** Full envelope from /human-evals/correlation. `pairs` is the numeric back-
 *  compat array; `agreement` is the new server-side stat. */
export interface CorrelationEnvelope {
  pairs: CorrelationPair[]
  agreement: CorrelationAgreement | null
}

// ── Queue filters ───────────────────────────────────────────────────────────

export interface QueueFilters {
  promptName?: string
  promptVersionId?: string
  unscoredOnly?: boolean
  lowJudgeScoreOnly?: boolean
  limit?: number
}

export function annotationQueueQueryKey(filters: QueueFilters) {
  return ['annotation', 'queue', filters] as const
}

export function useAnnotationQueue(filters: QueueFilters = {}) {
  return useQuery({
    queryKey: annotationQueueQueryKey(filters),
    queryFn: async () => {
      const qs = new URLSearchParams()
      if (filters.promptName) qs.set('promptName', filters.promptName)
      if (filters.promptVersionId) qs.set('promptVersionId', filters.promptVersionId)
      if (filters.unscoredOnly) qs.set('unscoredOnly', 'true')
      if (filters.lowJudgeScoreOnly) qs.set('lowJudgeScoreOnly', 'true')
      if (filters.limit) qs.set('limit', String(filters.limit))
      const suffix = qs.size > 0 ? `?${qs}` : ''
      const res = await apiGet<ApiEnvelope<AnnotationQueueItem[]>>(`/api/v1/annotation/queue${suffix}`)
      return res.data ?? []
    },
    staleTime: 30_000,
  })
}

// ── Mutations ───────────────────────────────────────────────────────────────

export interface SaveHumanEvalInput {
  requestId: string
  // 4B.1: explicit config + typed value path. When `scoreConfigId` is
  // omitted the server falls back to the workspace's default NUMERIC
  // config and validates `value` (or legacy `score`) against it.
  scoreConfigId?: string
  value?: number | string | boolean
  // Legacy NUMERIC-only fields kept for backward compatibility.
  // `score` is required iff `value` is not supplied AND the workspace
  // default is NUMERIC. Pre-4B.1 callers can keep sending it unchanged.
  score?: number       // normalized 0..1
  rawScore?: number    // UI value (e.g. 1..5)
  comment?: string
}

export function useSaveHumanEval() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: SaveHumanEvalInput) => {
      const res = await apiPost<ApiEnvelope<HumanEval>>('/api/v1/human-evals', input)
      return res.data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['annotation', 'queue'] })
      void qc.invalidateQueries({ queryKey: ['human-evals'] })
      void qc.invalidateQueries({ queryKey: ['correlation'] })
    },
  })
}

export function useDeleteHumanEval() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await apiDelete(`/api/v1/human-evals/${id}`)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['annotation', 'queue'] })
      void qc.invalidateQueries({ queryKey: ['human-evals'] })
    },
  })
}

// ── Correlation (LLM judge vs Human) ────────────────────────────────────────

export function useCorrelation(scope: { promptName?: string; promptVersionId?: string }) {
  return useQuery({
    queryKey: ['correlation', scope] as const,
    queryFn: async (): Promise<CorrelationEnvelope> => {
      const qs = new URLSearchParams()
      if (scope.promptName) qs.set('promptName', scope.promptName)
      if (scope.promptVersionId) qs.set('promptVersionId', scope.promptVersionId)
      const suffix = qs.size > 0 ? `?${qs}` : ''
      // P3-19: response now carries `agreement` (Pearson r or Cohen's κ)
      // alongside the legacy `pairs` array. The server keeps `data` as the
      // pairs array for back-compat with old clients.
      const res = await apiGet<ApiEnvelope<CorrelationPair[]> & { pairs?: CorrelationPair[]; agreement?: CorrelationAgreement | null }>(
        `/api/v1/human-evals/correlation${suffix}`,
      )
      return {
        pairs: res.pairs ?? res.data ?? [],
        agreement: res.agreement ?? null,
      }
    },
    enabled: !!(scope.promptName || scope.promptVersionId),
  })
}

// Pearson correlation coefficient — runs on the data returned by useCorrelation.
export function pearsonR(pairs: CorrelationPair[]): number | null {
  if (pairs.length < 2) return null
  const n = pairs.length
  let sumA = 0, sumB = 0, sumA2 = 0, sumB2 = 0, sumAB = 0
  for (const p of pairs) {
    sumA += p.judgeScore
    sumB += p.humanScore
    sumA2 += p.judgeScore * p.judgeScore
    sumB2 += p.humanScore * p.humanScore
    sumAB += p.judgeScore * p.humanScore
  }
  const numer = n * sumAB - sumA * sumB
  const denom = Math.sqrt((n * sumA2 - sumA * sumA) * (n * sumB2 - sumB * sumB))
  if (denom === 0) return null
  return numer / denom
}
