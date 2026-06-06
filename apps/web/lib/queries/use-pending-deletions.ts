'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '@/lib/api'
import type { ApiEnvelope } from './types'

/**
 * Soft-delete queue hooks.
 *
 * Active queue: rows whose `cancelled_at` and `executed_at` are both null —
 * the 72-hour grace window during which a deletion can be undone.
 *
 * History: terminal rows (cancelled or executed) for audit purposes.
 *
 * Restore: cancel the deletion and reactivate the source row. After a
 * successful restore both active + history queries are invalidated so the
 * UI flips the row from active → history in one round trip.
 */

export type PendingResourceType = 'api_key' | 'provider_key' | 'prompt_version'

export interface PendingDeletionRow {
  id: string
  resourceType: PendingResourceType
  resourceId: string
  resourceSnapshot: Record<string, unknown>
  requestedAt: string
  scheduledFor: string
  requestedBy: string | null
  cancelledAt: string | null
  cancelledBy: string | null
  executedAt: string | null
}

export const pendingDeletionsKey = ['pending-deletions'] as const
export const pendingDeletionsHistoryKey = ['pending-deletions', 'history'] as const

export function usePendingDeletions() {
  return useQuery({
    queryKey: pendingDeletionsKey,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<PendingDeletionRow[]>>(
        '/api/v1/pending-deletions',
      )
      return res.data ?? []
    },
  })
}

export function usePendingDeletionsHistory() {
  return useQuery({
    queryKey: pendingDeletionsHistoryKey,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<PendingDeletionRow[]>>(
        '/api/v1/pending-deletions/history',
      )
      return res.data ?? []
    },
  })
}

export function useRestorePendingDeletion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (pendingId: string) => {
      const res = await apiPost<ApiEnvelope<{ restored: string }>>(
        `/api/v1/pending-deletions/${pendingId}/restore`,
        {},
      )
      return res.data
    },
    onSuccess: () => {
      // The restored row moves from active → history; both lists need a
      // refetch. We also bust the resource-specific caches so the source
      // row's is_active flag refreshes wherever the user navigates next.
      void qc.invalidateQueries({ queryKey: pendingDeletionsKey })
      void qc.invalidateQueries({ queryKey: pendingDeletionsHistoryKey })
      void qc.invalidateQueries({ queryKey: ['api-keys'] })
      void qc.invalidateQueries({ queryKey: ['provider-keys'] })
      void qc.invalidateQueries({ queryKey: ['prompts'] })
    },
  })
}
