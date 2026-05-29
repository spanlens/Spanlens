import 'server-only'
import { apiGetServer } from '@/lib/server/api'
import type { QuerySpec } from '@/lib/server/dehydrate'
import type { ApiEnvelope } from '@/lib/queries/types'
import type { OrgRole } from '@/lib/queries/use-members'
import type { PendingInvitation } from '@/lib/queries/use-pending-invitations'

// Must exactly match queryKey in use-current-role.ts
const meRoleQK = ['me', 'role'] as const

// Must exactly match pendingKey in use-pending-invitations.ts
const pendingInvitationsQK = ['me', 'pending-invitations'] as const

interface MeRolePayload {
  role: OrgRole | null
  orgId: string | null
}

/**
 * Prefetches the current user's role + org id (used by useCurrentRole /
 * useIsAdmin / useCanEdit for sidebar gating). Cheap server-side call —
 * authJwt already resolves the role into request context, this endpoint
 * just returns it.
 *
 * 5-minute staleTime matches the client hook; role rarely changes outside
 * of explicit mutations that invalidate ['me', 'role'].
 */
export function currentRoleSpec(): QuerySpec {
  return {
    queryKey: meRoleQK,
    queryFn: async () => {
      const res = await apiGetServer<ApiEnvelope<MeRolePayload>>('/api/v1/me/role')
      return res.data ?? { role: null, orgId: null }
    },
    staleTime: 5 * 60_000,
  }
}

/**
 * Prefetches pending workspace invitations for the current user. Powers the
 * top-of-dashboard banner. 30s staleTime matches client hook — banner needs
 * to reflect admin cancel / accept relatively quickly but not live.
 */
export function pendingInvitationsSpec(): QuerySpec {
  return {
    queryKey: pendingInvitationsQK,
    queryFn: async () => {
      const res = await apiGetServer<ApiEnvelope<PendingInvitation[]>>(
        '/api/v1/me/pending-invitations',
      )
      return res.data ?? []
    },
    staleTime: 30_000,
  }
}
