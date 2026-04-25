'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '@/lib/api'
import type { ApiEnvelope } from './types'
import type { OrgRole } from './use-members'

export interface Workspace {
  id: string
  name: string
  plan: string
  role: OrgRole
  createdAt: string
}

const workspacesKey = ['workspaces'] as const

/**
 * List every workspace (organization) the current user is a member of.
 * Powers the sidebar workspace switcher. The current active workspace is
 * determined separately via the `sb-ws` cookie + `useCurrentWorkspaceId`.
 */
export function useWorkspaces() {
  return useQuery({
    queryKey: workspacesKey,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<Workspace[]>>('/api/v1/organizations')
      return res.data ?? []
    },
  })
}

export function useCreateWorkspace() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) => {
      const res = await apiPost<ApiEnvelope<{ id: string; name: string; plan: string; created_at: string }>>(
        '/api/v1/organizations',
        { name },
      )
      return res.data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workspacesKey })
    },
  })
}
