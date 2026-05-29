import 'server-only'
import { apiGetServer } from '@/lib/server/api'
import type { QuerySpec } from '@/lib/server/dehydrate'
import type { ApiEnvelope } from '@/lib/queries/types'
import type { Workspace } from '@/lib/queries/use-workspaces'

// Must exactly match workspacesKey in use-workspaces.ts
const workspacesQK = ['workspaces'] as const

/**
 * Prefetches every workspace (organization) the current user is a member of.
 * Powers the sidebar workspace switcher. The current active workspace is
 * determined separately via the `sb-ws` cookie + `useCurrentWorkspaceId`.
 */
export function workspacesSpec(): QuerySpec {
  return {
    queryKey: workspacesQK,
    queryFn: async () => {
      const res = await apiGetServer<ApiEnvelope<Workspace[]>>('/api/v1/organizations')
      return res.data ?? []
    },
  }
}
