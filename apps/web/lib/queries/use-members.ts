'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api'
import { useOrganization } from './use-organization'
import { useCurrentUser } from './use-current-user'
import type { ApiEnvelope } from './types'

export type OrgRole = 'admin' | 'editor' | 'viewer'

export interface Member {
  userId: string
  email: string
  role: OrgRole
  invitedBy: string | null
  createdAt: string
}

export interface Invitation {
  id: string
  email: string
  role: OrgRole
  expires_at: string
  created_at: string
  invited_by: string
}

const membersKey = (orgId: string) => ['members', orgId] as const
const invitationsKey = (orgId: string) => ['invitations', orgId] as const

export function useMembers() {
  const org = useOrganization()
  const orgId = org.data?.id
  return useQuery({
    queryKey: orgId ? membersKey(orgId) : ['members'],
    enabled: !!orgId,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<Member[]>>(
        `/api/v1/organizations/${orgId}/members`,
      )
      return res.data ?? []
    },
  })
}

export function useInvitations() {
  const org = useOrganization()
  const orgId = org.data?.id
  return useQuery({
    queryKey: orgId ? invitationsKey(orgId) : ['invitations'],
    enabled: !!orgId,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<Invitation[]>>(
        `/api/v1/organizations/${orgId}/invitations`,
      )
      return res.data ?? []
    },
  })
}

export function useInviteMember() {
  const qc = useQueryClient()
  const org = useOrganization()
  const orgId = org.data?.id
  return useMutation({
    mutationFn: async (input: { email: string; role: OrgRole }) => {
      if (!orgId) throw new Error('No organization')
      const res = await apiPost<ApiEnvelope<Invitation> & { devAcceptUrl?: string }>(
        `/api/v1/organizations/${orgId}/invitations`,
        input,
      )
      return { invitation: res.data, devAcceptUrl: res.devAcceptUrl }
    },
    onSuccess: () => {
      if (orgId) void qc.invalidateQueries({ queryKey: invitationsKey(orgId) })
    },
  })
}

export function useUpdateMemberRole() {
  const qc = useQueryClient()
  const org = useOrganization()
  const orgId = org.data?.id
  return useMutation({
    mutationFn: async (input: { userId: string; role: OrgRole }) => {
      if (!orgId) throw new Error('No organization')
      const res = await apiPatch<ApiEnvelope<{ role: OrgRole }>>(
        `/api/v1/organizations/${orgId}/members/${input.userId}`,
        { role: input.role },
      )
      return res.data
    },
    onSuccess: () => {
      if (orgId) void qc.invalidateQueries({ queryKey: membersKey(orgId) })
      // The current user may have just demoted/promoted themselves —
      // refetch ['me', 'role'] so the sidebar redraws admin-only items.
      void qc.invalidateQueries({ queryKey: ['me', 'role'] })
    },
  })
}

export function useRemoveMember() {
  const qc = useQueryClient()
  const org = useOrganization()
  const orgId = org.data?.id
  return useMutation({
    mutationFn: async (userId: string) => {
      if (!orgId) throw new Error('No organization')
      await apiDelete<ApiEnvelope<null>>(
        `/api/v1/organizations/${orgId}/members/${userId}`,
      )
    },
    onSuccess: () => {
      if (orgId) void qc.invalidateQueries({ queryKey: membersKey(orgId) })
      // Cover the (rare) case where the current user removes themselves.
      void qc.invalidateQueries({ queryKey: ['me', 'role'] })
    },
  })
}

export function useCancelInvitation() {
  const qc = useQueryClient()
  const org = useOrganization()
  const orgId = org.data?.id
  return useMutation({
    mutationFn: async (id: string) => {
      await apiDelete<ApiEnvelope<null>>(`/api/v1/invitations/${id}`)
    },
    onSuccess: () => {
      if (orgId) void qc.invalidateQueries({ queryKey: invitationsKey(orgId) })
    },
  })
}

/**
 * Find the current user's member row by matching email against the Supabase
 * session email. Returns null while loading.
 *
 * Reuses `useCurrentUser()` rather than declaring its own query: both once used
 * the `['current-user']` key with different result shapes, so whichever queryFn
 * resolved last won the shared cache entry and this hook could receive a
 * `CurrentUser` object where it expected a string.
 */
export function useCurrentMember(): Member | null {
  const members = useMembers()
  const user = useCurrentUser()
  const email = user.data?.email
  if (!email || !members.data) return null
  const needle = email.toLowerCase()
  return members.data.find((m) => m.email?.toLowerCase() === needle) ?? null
}
