import { createMiddleware } from 'hono/factory'
import { supabaseAdmin, supabaseClient } from '../lib/db.js'

export type OrgRole = 'admin' | 'editor' | 'viewer'

export type JwtContext = {
  Variables: {
    userId: string
    /**
     * Organization id resolved from the user's org_members row.
     * `null` means the user has not joined any org yet (pre-onboarding).
     * Routes that require an org should guard with:
     *   if (!orgId) return c.json({ error: 'Organization not found' }, 404)
     */
    orgId: string | null
    /**
     * The user's role within `orgId`. `null` when orgId is null.
     * Use `requireRole(...)` middleware to gate write endpoints.
     */
    role: OrgRole | null
  }
}

/** Plain cookie reader — avoids pulling a library for one lookup. */
function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [rawName, ...rest] = part.split('=')
    if (rawName?.trim() === name) return decodeURIComponent(rest.join('=').trim())
  }
  return null
}

export const WORKSPACE_COOKIE = 'sb-ws'

export const authJwt = createMiddleware<JwtContext>(async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401)
  }

  const token = authHeader.slice(7)
  const { data, error } = await supabaseClient.auth.getUser(token)

  if (error || !data.user) {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }

  const userId = data.user.id
  c.set('userId', userId)

  // Workspace resolution order:
  //   1. `sb-ws` cookie — explicit user choice from the sidebar switcher.
  //      Validated against org_members so a stale cookie (e.g. after the
  //      user was removed from that org) silently falls through.
  //   2. Oldest org_members row — deterministic default for single-workspace
  //      users and for the very first request after signup before any cookie
  //      has been set.
  let orgId: string | null = null
  let role: OrgRole | null = null

  const preferredOrgId = readCookie(c.req.header('cookie'), WORKSPACE_COOKIE)
  if (preferredOrgId) {
    const { data: preferred } = await supabaseAdmin
      .from('org_members')
      .select('organization_id, role')
      .eq('user_id', userId)
      .eq('organization_id', preferredOrgId)
      .maybeSingle()
    if (preferred) {
      orgId = preferred.organization_id
      role = preferred.role as OrgRole
    }
  }

  if (!orgId) {
    const { data: membership } = await supabaseAdmin
      .from('org_members')
      .select('organization_id, role')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    orgId = membership?.organization_id ?? null
    role = (membership?.role as OrgRole | undefined) ?? null
  }

  c.set('orgId', orgId)
  c.set('role', role)

  return next()
})
