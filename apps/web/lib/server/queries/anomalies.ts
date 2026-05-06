import 'server-only'
import { apiGetServer } from '@/lib/server/api'
import type { Anomaly, AnomalyHistoryEntry, UseAnomaliesParams } from '@/lib/queries/use-anomalies'
import type { QuerySpec } from '@/lib/server/dehydrate'
import type { ApiEnvelope } from '@/lib/queries/types'

interface AnomalyResponseMeta {
  observationHours: number
  referenceHours: number
  sigmaThreshold: number
  count: number
}

// Must exactly match anomaliesQueryKey() in use-anomalies.ts
function anomaliesQK(params: UseAnomaliesParams) {
  return ['anomalies', params] as const
}

// Must exactly match anomalyHistoryQueryKey() in use-anomalies.ts
function anomalyHistoryQK(days: number) {
  return ['anomalies', 'history', days] as const
}

export function anomaliesSpec(params: UseAnomaliesParams = {}): QuerySpec {
  return {
    queryKey: anomaliesQK(params),
    queryFn: async () => {
      const qs = new URLSearchParams()
      if (params.observationHours !== undefined)
        qs.set('observationHours', String(params.observationHours))
      if (params.referenceHours !== undefined)
        qs.set('referenceHours', String(params.referenceHours))
      if (params.sigma !== undefined) qs.set('sigma', String(params.sigma))
      if (params.projectId !== undefined) qs.set('projectId', params.projectId)
      const suffix = qs.size > 0 ? `?${qs}` : ''
      const res = await apiGetServer<ApiEnvelope<Anomaly[]> & { meta?: AnomalyResponseMeta }>(
        `/api/v1/anomalies${suffix}`,
      )
      return { data: res.data ?? [], meta: res.meta }
    },
    staleTime: 60_000,
  }
}

export function anomalyHistorySpec(days = 30): QuerySpec {
  return {
    queryKey: anomalyHistoryQK(days),
    queryFn: async () => {
      const res = await apiGetServer<ApiEnvelope<AnomalyHistoryEntry[]>>(
        `/api/v1/anomalies/history?days=${days}`,
      )
      return res.data ?? []
    },
    staleTime: 5 * 60_000,
  }
}
