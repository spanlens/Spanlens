import 'server-only'
import { apiGetServer } from '@/lib/server/api'
import type { ApiEnvelope, Organization } from '@/lib/queries/types'
import type { Member, Invitation } from '@/lib/queries/use-members'
import type { QuerySpec } from '@/lib/server/dehydrate'

// Must exactly match organizationQueryKey = ['organization'] in use-organization.ts
export function organizationSpec(): QuerySpec {
  return {
    queryKey: ['organization'] as const,
    queryFn: async () => {
      const res = await apiGetServer<ApiEnvelope<Organization>>('/api/v1/organizations/me')
      return res.data
    },
  }
}

// Must exactly match membersKey(orgId) = ['members', orgId] in use-members.ts
export function membersSpec(orgId: string): QuerySpec {
  return {
    queryKey: ['members', orgId] as const,
    queryFn: async () => {
      const res = await apiGetServer<ApiEnvelope<Member[]>>(
        `/api/v1/organizations/${orgId}/members`,
      )
      return res.data ?? []
    },
  }
}

// Must exactly match invitationsKey(orgId) = ['invitations', orgId] in use-members.ts
export function invitationsSpec(orgId: string): QuerySpec {
  return {
    queryKey: ['invitations', orgId] as const,
    queryFn: async () => {
      const res = await apiGetServer<ApiEnvelope<Invitation[]>>(
        `/api/v1/organizations/${orgId}/invitations`,
      )
      return res.data ?? []
    },
  }
}
