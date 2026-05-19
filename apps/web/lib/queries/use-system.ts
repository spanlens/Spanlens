'use client'

import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { ApiEnvelope } from './types'
import { LIVE_REFETCH_MS_HEALTH } from './live-polling'

export interface CronJobRun {
  id: string
  job_name: string
  ran_at: string
  status: 'ok' | 'error'
  duration_ms: number | null
  error_message: string | null
}

export interface CronJobSummary {
  jobName: string
  lastRanAt: string
  lastStatus: 'ok' | 'error'
  lastDurationMs: number | null
  lastErrorMessage: string | null
  recentRuns: CronJobRun[]
}

export function useCronRuns() {
  return useQuery({
    queryKey: ['system', 'cron-runs'] as const,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<CronJobSummary[]>>('/api/v1/system/cron-runs')
      return res.data ?? []
    },
    // P3.9: slow-moving health surface — cron status updates per hour, so
    // 60s polling is enough. Background tabs pause via TanStack defaults.
    refetchInterval: LIVE_REFETCH_MS_HEALTH,
  })
}
