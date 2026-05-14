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
    score: number
    raw_score: number | null
    comment: string | null
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
  score: number       // normalized 0..1
  rawScore?: number   // UI value (e.g. 1..5)
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
    queryFn: async () => {
      const qs = new URLSearchParams()
      if (scope.promptName) qs.set('promptName', scope.promptName)
      if (scope.promptVersionId) qs.set('promptVersionId', scope.promptVersionId)
      const suffix = qs.size > 0 ? `?${qs}` : ''
      const res = await apiGet<ApiEnvelope<CorrelationPair[]>>(`/api/v1/human-evals/correlation${suffix}`)
      return res.data ?? []
    },
    enabled: !!(scope.promptName || scope.promptVersionId),
  })
}

// ── Inter-Annotator Agreement ────────────────────────────────────────────────

export interface IAAItem {
  requestId: string
  promptName: string | null
  reviewerCount: number
  scores: number[]             // normalized 0..1 per reviewer
  rawScores: (number | null)[] // raw UI values (e.g. 1..5) per reviewer
  meanScore: number
  disagreement: number         // std dev of scores, 0..1
  highAgreement: boolean       // disagreement < 0.15
}

export interface IAAMetrics {
  totalItems: number           // requests with >= minReviewers
  avgDisagreement: number      // mean std dev across all items
  highAgreementPct: number     // % items where disagreement < 0.15
  items: IAAItem[]             // sorted by disagreement desc (most contentious first)
}

export interface IAAFilters {
  promptName?: string
  promptVersionId?: string
  minReviewers?: number        // default 2
}

export function useIAA(filters: IAAFilters, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['human-evals', 'iaa', filters] as const,
    queryFn: async () => {
      const qs = new URLSearchParams()
      if (filters.promptName) qs.set('promptName', filters.promptName)
      if (filters.promptVersionId) qs.set('promptVersionId', filters.promptVersionId)
      if (filters.minReviewers) qs.set('minReviewers', String(filters.minReviewers))
      const suffix = qs.size > 0 ? `?${qs}` : ''
      const res = await apiGet<ApiEnvelope<IAAMetrics>>(`/api/v1/human-evals/iaa${suffix}`)
      return res.data ?? { totalItems: 0, avgDisagreement: 0, highAgreementPct: 0, items: [] }
    },
    enabled: options.enabled !== false,
    staleTime: 60_000,
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
