'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPost } from '@/lib/api'
import type { ApiEnvelope } from './types'

/**
 * Needs-attention dismiss state — per-user, DB-backed.
 *
 * Pre-Phase-9 this lived in localStorage so it was both machine-scoped AND
 * shared across users on the same machine. Both wrong for a team product:
 *  - One user dismisses a card → other users of the org shouldn't lose it.
 *  - Same user on a new laptop should see their dismisses.
 * The table `attn_dismissals` with PK (org_id, user_id, card_key) handles
 * both cases.
 */

const dismissalsKey = ['dismissals'] as const

export function useDismissals() {
  return useQuery({
    queryKey: dismissalsKey,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<string[]>>('/api/v1/dismissals')
      return res.data ?? []
    },
  })
}

export function useDismissCard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (cardKey: string) => {
      await apiPost<ApiEnvelope<null>>('/api/v1/dismissals', { cardKey })
    },
    // Optimistic update — the user clicks × and the card vanishes immediately.
    // If the POST fails we roll back via onError.
    onMutate: async (cardKey) => {
      await qc.cancelQueries({ queryKey: dismissalsKey })
      const previous = qc.getQueryData<string[]>(dismissalsKey) ?? []
      qc.setQueryData<string[]>(dismissalsKey, [...previous, cardKey])
      return { previous }
    },
    onError: (_err, _cardKey, ctx) => {
      if (ctx?.previous) qc.setQueryData(dismissalsKey, ctx.previous)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: dismissalsKey })
    },
  })
}

export function useRestoreCard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (cardKey: string) => {
      await apiDelete<ApiEnvelope<null>>(`/api/v1/dismissals/${encodeURIComponent(cardKey)}`)
    },
    onMutate: async (cardKey) => {
      await qc.cancelQueries({ queryKey: dismissalsKey })
      const previous = qc.getQueryData<string[]>(dismissalsKey) ?? []
      qc.setQueryData<string[]>(dismissalsKey, previous.filter((k) => k !== cardKey))
      return { previous }
    },
    onError: (_err, _cardKey, ctx) => {
      if (ctx?.previous) qc.setQueryData(dismissalsKey, ctx.previous)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: dismissalsKey })
    },
  })
}
