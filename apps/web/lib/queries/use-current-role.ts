'use client'

import { useQuery } from '@tanstack/react-query'

import { apiGet } from '@/lib/api'
import type { ApiEnvelope } from './types'
import type { OrgRole } from './use-members'

/**
 * Returns the current user's role in their organization.
 * Null = still loading OR user has no org.
 *
 * IMPORTANT: This is for UI gating only — a visitor can tamper with the
 * value in the browser. Always pair with server-side `requireRole` to
 * enforce the actual permission.
 *
 * Implementation note (perf):
 *   Used to derive the role by fetching the entire team roster via
 *   useMembers() and finding the row whose email matches the session.
 *   That call hit /api/v1/organizations/:orgId/members, which internally
 *   ran auth.admin.listUsers({ perPage: 200 }) — a 2-3s call. Now we hit
 *   /api/v1/me/role instead, which just returns the role authJwt already
 *   resolved into the request context (~5ms).
 */

interface MeRolePayload {
  role: OrgRole | null
  orgId: string | null
}

export function useCurrentRole(): OrgRole | null {
  const query = useQuery({
    queryKey: ['me', 'role'] as const,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<MeRolePayload>>('/api/v1/me/role')
      return res.data ?? { role: null, orgId: null }
    },
    // Role rarely changes after onboarding — cache aggressively. The
    // mutations that DO change it (workspace switch, admin role change)
    // are responsible for invalidating ['me', 'role'].
    staleTime: 5 * 60_000,
  })
  return query.data?.role ?? null
}

/**
 * True when the current user can write workspace data (admin or editor).
 * Viewer returns false. Null role (loading/no org) returns false.
 */
export function useCanEdit(): boolean {
  const role = useCurrentRole()
  return role === 'admin' || role === 'editor'
}

/**
 * True only for admins. Gates org-level settings (rename, delete, billing,
 * member management).
 */
export function useIsAdmin(): boolean {
  return useCurrentRole() === 'admin'
}
