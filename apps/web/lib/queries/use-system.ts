'use client'

import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { ApiEnvelope } from './types'

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
    refetchInterval: 60_000,
  })
}
