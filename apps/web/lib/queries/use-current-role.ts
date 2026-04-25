'use client'

import { useCurrentMember, type OrgRole } from './use-members'

/**
 * Returns the current user's role in their organization.
 * Null = still loading OR user has no org.
 *
 * IMPORTANT: This is for UI gating only — a visitor can tamper with the
 * value in the browser. Always pair with server-side `requireRole` to
 * enforce the actual permission.
 */
export function useCurrentRole(): OrgRole | null {
  return useCurrentMember()?.role ?? null
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
