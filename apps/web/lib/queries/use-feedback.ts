'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api'

export type FeedbackCategory = 'feature' | 'bug' | 'other'
export type FeedbackStatus = 'new' | 'planned' | 'in_progress' | 'shipped' | 'declined'

export interface SubmitFeedbackInput {
  message: string
  category: FeedbackCategory
  source?: string
}

export interface FeedbackItem {
  id: string
  message: string
  category: FeedbackCategory
  status: FeedbackStatus
  response_message: string | null
  changelog_url: string | null
  responded_at: string | null
  created_at: string
  vote_count: number
  has_voted: boolean
}

interface ListResponse {
  success: boolean
  data: FeedbackItem[]
}

/** Submit a new suggestion (Phase 1, unchanged). */
export function useSubmitFeedback() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SubmitFeedbackInput) =>
      apiPost<{ success: boolean }>('/api/v1/feedback', {
        message: input.message,
        category: input.category,
        source: input.source ?? 'dashboard',
      }),
    onSuccess: () => {
      // New submission may not be immediately listed (status defaults to 'new'),
      // but refresh the roadmap so the user sees their item appear at the
      // bottom of the no-votes group.
      qc.invalidateQueries({ queryKey: ['feedback', 'list'] })
    },
  })
}

/** Public roadmap list. Optional status filter; pageless (server hard-caps). */
export function useFeedbackList(status?: FeedbackStatus) {
  return useQuery({
    queryKey: ['feedback', 'list', status ?? 'all'],
    queryFn: () => {
      const q = status ? `?status=${encodeURIComponent(status)}` : ''
      return apiGet<ListResponse>(`/api/v1/feedback${q}`)
    },
    // Keep the list fresh enough that an admin status change visibly
    // propagates within a minute without spamming the server.
    staleTime: 30_000,
  })
}

/**
 * Idempotent upvote. Optimistic update so the count and button state move
 * instantly; on failure the cache is rolled back.
 */
export function useUpvoteFeedback() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (feedbackId: string) =>
      apiPost<{ success: boolean }>(`/api/v1/feedback/${feedbackId}/vote`),
    onMutate: async (feedbackId) => {
      await qc.cancelQueries({ queryKey: ['feedback', 'list'] })
      const snapshots = qc.getQueriesData<ListResponse>({ queryKey: ['feedback', 'list'] })
      snapshots.forEach(([key, snap]) => {
        if (!snap) return
        qc.setQueryData<ListResponse>(key, {
          ...snap,
          data: snap.data.map((row) =>
            row.id === feedbackId && !row.has_voted
              ? { ...row, has_voted: true, vote_count: row.vote_count + 1 }
              : row,
          ),
        })
      })
      return { snapshots }
    },
    onError: (_err, _id, ctx) => {
      ctx?.snapshots.forEach(([key, snap]) => qc.setQueryData(key, snap))
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['feedback', 'list'] })
    },
  })
}

/** Idempotent un-vote. Mirror of useUpvoteFeedback with the optimism reversed. */
export function useUnvoteFeedback() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (feedbackId: string) =>
      apiDelete<{ success: boolean }>(`/api/v1/feedback/${feedbackId}/vote`),
    onMutate: async (feedbackId) => {
      await qc.cancelQueries({ queryKey: ['feedback', 'list'] })
      const snapshots = qc.getQueriesData<ListResponse>({ queryKey: ['feedback', 'list'] })
      snapshots.forEach(([key, snap]) => {
        if (!snap) return
        qc.setQueryData<ListResponse>(key, {
          ...snap,
          data: snap.data.map((row) =>
            row.id === feedbackId && row.has_voted
              ? { ...row, has_voted: false, vote_count: Math.max(0, row.vote_count - 1) }
              : row,
          ),
        })
      })
      return { snapshots }
    },
    onError: (_err, _id, ctx) => {
      ctx?.snapshots.forEach(([key, snap]) => qc.setQueryData(key, snap))
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['feedback', 'list'] })
    },
  })
}

export interface AdminPatchInput {
  status?: FeedbackStatus
  response_message?: string | null
  changelog_url?: string | null
}

/**
 * Admin PATCH — status / response / changelog. 403 on non-admins (the server
 * enforces; this hook makes no client-side allowlist assumption).
 */
export function useAdminPatchFeedback() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...patch }: AdminPatchInput & { id: string }) =>
      apiPatch<{ success: boolean; data: { id: string; status: FeedbackStatus } }>(
        `/api/v1/admin/feedback/${id}`,
        patch,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feedback', 'list'] })
    },
  })
}
