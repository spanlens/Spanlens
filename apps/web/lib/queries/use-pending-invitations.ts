'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiDelete, apiGet, apiPost } from '@/lib/api'
import type { ApiEnvelope } from './types'
import type { OrgRole } from './use-members'

/**
 * Pending invitations FOR the current user — i.e. "an admin somewhere
 * invited my email but I haven't accepted yet".
 *
 *   • The dashboard layout banner reads this list.
 *   • The /onboarding pending step (for fresh signups) also reads it.
 *
 * Distinct from `useInvitations()` which is the admin-side list of
 * invitations the org HAS SENT.
 */
export interface PendingInvitation {
  id: string
  role: OrgRole
  orgId: string
  orgName: string
  expiresAt: string
}

const pendingKey = ['me', 'pending-invitations'] as const

export function usePendingInvitations() {
  return useQuery({
    queryKey: pendingKey,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<PendingInvitation[]>>(
        '/api/v1/me/pending-invitations',
      )
      return res.data ?? []
    },
    // Pending invites are time-sensitive (expiry, admin cancel) — refetch
    // when the tab regains focus so the banner reflects reality.
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  })
}

export function useAcceptPendingInvitation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiPost<ApiEnvelope<{ organizationId: string; role: OrgRole }>>(
        `/api/v1/me/pending-invitations/${id}/accept`,
        {},
      )
      return res.data!
    },
    onSuccess: () => {
      // Pending list shrinks by one; workspaces list grows by one. Both
      // need a hard refetch — the workspace switcher will re-render with
      // the new entry.
      void qc.invalidateQueries({ queryKey: pendingKey })
      void qc.invalidateQueries({ queryKey: ['workspaces'] })
    },
  })
}

export function useDeclinePendingInvitation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await apiDelete(`/api/v1/me/pending-invitations/${id}`)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pendingKey })
    },
  })
}
