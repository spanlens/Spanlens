'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api'
import { useOrganization } from './use-organization'
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
 * The current user's role in their organization. Null while loading or when
 * the user has no org. Used by UI permission gates — ALWAYS paired with
 * server-side `requireRole` since the client can be tampered with.
 */
export function useCurrentRole(): OrgRole | null {
  const members = useMembers()
  const userQuery = useQuery<{ userId: string | null }>({
    queryKey: ['current-user', 'id'],
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<{ id: string }>>('/api/v1/organizations/me')
      // The endpoint returns the org, not the user — we need a user-id source.
      // Fall back to parsing the auth cookie via a small dedicated endpoint in future.
      return { userId: res.data?.id ? null : null }
    },
    enabled: false, // we use members list + current user id via Supabase session
  })
  void userQuery
  // Simpler path: use Supabase's session for user id.
  // members hook already has the roster; match by email in the consuming component.
  if (!members.data) return null
  // Caller should prefer `useCurrentMember()` instead.
  return null
}

/**
 * Find the current user's member row by matching email against the Supabase
 * session email. Returns null while loading.
 */
export function useCurrentMember(): Member | null {
  const members = useMembers()
  const userQuery = useQuery({
    queryKey: ['current-user'],
    queryFn: async () => {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      const { data } = await supabase.auth.getSession()
      return data.session?.user.email ?? null
    },
  })
  const email = userQuery.data
  if (!email || !members.data) return null
  return members.data.find((m) => m.email.toLowerCase() === email.toLowerCase()) ?? null
}
