'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api'
import type { ApiEnvelope } from './types'

/**
 * Score configs CRUD hooks.
 *
 * One workspace can have multiple configs (e.g. "Helpfulness" NUMERIC,
 * "Persona" CATEGORICAL, "Pass/Fail" BOOLEAN); the management UI lives
 * at /settings/score-configs and the annotation queue picks one at
 * input time. Every workspace has at least one default (NUMERIC 0..1,
 * seeded by the 4B.1 migration).
 */

export type ScoreConfigType = 'NUMERIC' | 'CATEGORICAL' | 'BOOLEAN' | 'TEXT'

export interface ScoreConfig {
  id: string
  organization_id: string
  name: string
  description: string | null
  data_type: ScoreConfigType
  min_value: number | null
  max_value: number | null
  categories: string[] | null
  bool_true_label: string | null
  bool_false_label: string | null
  archived_at: string | null
  is_default: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface CreateScoreConfigInput {
  name: string
  description?: string | null
  data_type: ScoreConfigType
  min_value?: number | null
  max_value?: number | null
  categories?: string[] | null
  bool_true_label?: string | null
  bool_false_label?: string | null
  is_default?: boolean
}

export interface UpdateScoreConfigInput {
  name?: string
  description?: string | null
  min_value?: number | null
  max_value?: number | null
  categories?: string[] | null
  bool_true_label?: string | null
  bool_false_label?: string | null
  archived?: boolean
  is_default?: boolean
}

export const scoreConfigsKey = ['score-configs'] as const
export const scoreConfigsKeyAll = ['score-configs', 'all'] as const

export function useScoreConfigs() {
  return useQuery({
    queryKey: scoreConfigsKey,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<ScoreConfig[]>>('/api/v1/score-configs')
      return res.data ?? []
    },
    // Refetches on window focus by default. Configs change rarely so a
    // 60-second stale window is enough to dedupe back-to-back navigations.
    staleTime: 60_000,
  })
}

/** Same as useScoreConfigs but includes archived rows. Used by the
 *  management page so admins can restore mistakes. */
export function useAllScoreConfigs() {
  return useQuery({
    queryKey: scoreConfigsKeyAll,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<ScoreConfig[]>>(
        '/api/v1/score-configs?includeArchived=1',
      )
      return res.data ?? []
    },
    staleTime: 60_000,
  })
}

export function useCreateScoreConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateScoreConfigInput) => {
      const res = await apiPost<ApiEnvelope<ScoreConfig>>('/api/v1/score-configs', input)
      return res.data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: scoreConfigsKey })
      void qc.invalidateQueries({ queryKey: scoreConfigsKeyAll })
    },
  })
}

export function useUpdateScoreConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...input }: UpdateScoreConfigInput & { id: string }) => {
      const res = await apiPatch<ApiEnvelope<ScoreConfig>>(
        `/api/v1/score-configs/${id}`,
        input,
      )
      return res.data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: scoreConfigsKey })
      void qc.invalidateQueries({ queryKey: scoreConfigsKeyAll })
    },
  })
}

export function useArchiveScoreConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await apiDelete(`/api/v1/score-configs/${id}`)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: scoreConfigsKey })
      void qc.invalidateQueries({ queryKey: scoreConfigsKeyAll })
    },
  })
}
