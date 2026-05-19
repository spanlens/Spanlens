'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPost } from '@/lib/api'
import type { ApiEnvelope } from './types'

export type AnomalyKind = 'latency' | 'cost' | 'error_rate'

/**
 * Statistical reliability of the anomaly given the size of the reference
 * window. P3.2: surfaces low-confidence anomalies (10..29 ref samples) so
 * new orgs see directional signal in their first week, while still labeling
 * the result clearly. See `apps/server/src/lib/anomaly.ts:classifyConfidence`.
 */
export type AnomalyConfidence = 'low' | 'medium' | 'high'

export interface AnomalyContributingFactors {
  obsPromptTokensMean: number | null
  refPromptTokensMean: number | null
  obsCompletionTokensMean: number | null
  refCompletionTokensMean: number | null
  obsTotalTokensMean: number | null
  refTotalTokensMean: number | null
  obsStatusDistribution: Array<{ code: number; count: number }>
}

export interface Anomaly {
  provider: string
  model: string
  kind: AnomalyKind
  currentValue: number
  baselineMean: number
  baselineStdDev: number
  deviations: number
  sampleCount: number
  referenceCount: number
  /** ISO timestamp when this anomaly was acknowledged, or null. */
  acknowledgedAt?: string | null
  /** Root-cause contributing factors — token usage change, error code breakdown. */
  factors?: AnomalyContributingFactors | null
  /** Statistical reliability label. Always present on detection results from
   *  the server; historical rows persisted before P3.2 may be null. */
  confidence?: AnomalyConfidence
}

export interface AnomalyHistoryEntry {
  id: string
  detectedOn: string
  provider: string
  model: string
  kind: AnomalyKind
  currentValue: number
  baselineMean: number
  baselineStdDev: number
  deviations: number
  sampleCount: number
  referenceCount: number
  /** Null for historical rows persisted before P3.2. */
  confidence?: AnomalyConfidence | null
}

interface AnomalyResponseMeta {
  observationHours: number
  referenceHours: number
  sigmaThreshold: number
  count: number
}

export interface UseAnomaliesParams {
  observationHours?: number
  referenceHours?: number
  sigma?: number
  projectId?: string
}

export function anomaliesQueryKey(params: UseAnomaliesParams) {
  return ['anomalies', params] as const
}

export function anomalyHistoryQueryKey(days: number) {
  return ['anomalies', 'history', days] as const
}

export function useAnomalies(params: UseAnomaliesParams = {}) {
  return useQuery({
    queryKey: anomaliesQueryKey(params),
    queryFn: async () => {
      const qs = new URLSearchParams()
      if (params.observationHours !== undefined) qs.set('observationHours', String(params.observationHours))
      if (params.referenceHours !== undefined) qs.set('referenceHours', String(params.referenceHours))
      if (params.sigma !== undefined) qs.set('sigma', String(params.sigma))
      if (params.projectId !== undefined) qs.set('projectId', params.projectId)
      const suffix = qs.size > 0 ? `?${qs}` : ''
      const res = await apiGet<ApiEnvelope<Anomaly[]> & { meta?: AnomalyResponseMeta }>(
        `/api/v1/anomalies${suffix}`,
      )
      return { data: res.data ?? [], meta: res.meta }
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
}

export function useAnomalyHistory(days = 30) {
  return useQuery({
    queryKey: anomalyHistoryQueryKey(days),
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<AnomalyHistoryEntry[]>>(
        `/api/v1/anomalies/history?days=${days}`,
      )
      return res.data ?? []
    },
    staleTime: 5 * 60_000,
  })
}

export interface AckAnomalyInput {
  provider: string
  model: string
  kind: AnomalyKind
}

export function useAckAnomaly() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: AckAnomalyInput) => {
      await apiPost<ApiEnvelope<unknown>>('/api/v1/anomalies/ack', input)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['anomalies'] })
    },
  })
}

export function useUnackAnomaly() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: AckAnomalyInput) => {
      const qs = new URLSearchParams({
        provider: input.provider,
        model: input.model,
        kind: input.kind,
      })
      await apiDelete<ApiEnvelope<unknown>>(`/api/v1/anomalies/ack?${qs}`)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['anomalies'] })
    },
  })
}
