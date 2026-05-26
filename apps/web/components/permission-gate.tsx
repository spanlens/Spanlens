'use client'

import { useSyncExternalStore, type ReactNode } from 'react'
import { useCurrentRole } from '@/lib/queries/use-current-role'
import type { OrgRole } from '@/lib/queries/use-members'

interface PermissionGateProps {
  /**
   * `'edit'`  — visible to admin + editor
   * `'admin'` — visible to admin only
   */
  need: 'edit' | 'admin'
  children: ReactNode
  /**
   * Render something in place of the gated content (e.g. a disabled tooltip).
   * Defaults to `null` — the gate renders nothing for denied users, so the
   * UI shrinks around the missing button instead of showing a stub.
   */
  fallback?: ReactNode
}

/**
 * Hide UI from users who don't have the required role.
 *
 * Gates are UI-only — the server `requireRole` middleware is the real
 * boundary. Putting a button behind a gate just prevents users from
 * triggering actions they can't complete, which is a UX win, not a
 * security measure. Don't rely on this alone for sensitive operations.
 *
 * While the role is still loading (`null`), the gate renders the fallback
 * so write buttons don't flicker in for a moment before disappearing. That
 * trades a slight delay for a non-jarring initial render.
 */
export function PermissionGate({ need, children, fallback = null }: PermissionGateProps) {
  // useSyncExternalStore gives false on the server and true on the client
  // without needing useEffect + setState, avoiding the cascading-render lint
  // rule while still preventing the SSR hydration mismatch (React #418).
  const mounted = useSyncExternalStore(
    (_cb) => () => {},
    () => true,
    () => false,
  )
  const role = useCurrentRole()

  // Before mount, always render fallback to match SSR output (role is always
  // null server-side). Without this, a cached role in the TanStack Query store
  // causes the client to render children on hydration while SSR rendered
  // nothing → React #418 hydration mismatch.
  if (!mounted) return <>{fallback}</>

  const allowed: OrgRole[] = need === 'admin' ? ['admin'] : ['admin', 'editor']
  if (!role || !allowed.includes(role)) return <>{fallback}</>
  return <>{children}</>
}
