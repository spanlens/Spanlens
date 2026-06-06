'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '@/lib/api'
import type { ApiEnvelope } from './types'

export interface BackgroundMigration {
  name: string
  description: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  state: unknown
  progress_current: number | null
  progress_total: number | null
  last_heartbeat_at: string | null
  error_message: string | null
  attempts: number
  created_at: string
  started_at: string | null
  completed_at: string | null
  updated_at: string
  registered: boolean
}

interface ListEnvelope {
  data: BackgroundMigration[]
  unseededRegistrations: string[]
}

export const backgroundMigrationsKey = ['background-migrations'] as const

export function useBackgroundMigrations() {
  return useQuery({
    queryKey: backgroundMigrationsKey,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<BackgroundMigration[]> & { unseededRegistrations?: string[] }>(
        '/api/v1/admin/background-migrations',
      )
      return {
        data: res.data ?? [],
        unseededRegistrations: res.unseededRegistrations ?? [],
      } satisfies ListEnvelope
    },
    refetchInterval: 30_000,
  })
}

export function useCancelBackgroundMigration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) => {
      await apiPost(`/api/v1/admin/background-migrations/${name}/cancel`)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: backgroundMigrationsKey })
    },
  })
}

export function useRetryBackgroundMigration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) => {
      await apiPost(`/api/v1/admin/background-migrations/${name}/retry`)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: backgroundMigrationsKey })
    },
  })
}
