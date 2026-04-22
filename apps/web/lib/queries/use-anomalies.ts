'use client'

import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { ApiEnvelope } from './types'

export interface Anomaly {
  provider: string
  model: string
  kind: 'latency' | 'cost'
  currentValue: number
  baselineMean: number
  baselineStdDev: number
  deviations: number
  sampleCount: number
  referenceCount: number
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

export function useAnomalies(params: UseAnomaliesParams = {}) {
  return useQuery({
    queryKey: ['anomalies', params] as const,
    queryFn: async () => {
      const qs = new URLSearchParams()
      if (params.observationHours) qs.set('observationHours', String(params.observationHours))
      if (params.referenceHours) qs.set('referenceHours', String(params.referenceHours))
      if (params.sigma) qs.set('sigma', String(params.sigma))
      if (params.projectId) qs.set('projectId', params.projectId)
      const suffix = qs.size > 0 ? `?${qs}` : ''
      const res = await apiGet<ApiEnvelope<Anomaly[]> & { meta?: AnomalyResponseMeta }>(
        `/api/v1/anomalies${suffix}`,
      )
      return { data: res.data ?? [], meta: res.meta }
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })
}
