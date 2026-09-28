import { createMiddleware } from 'hono/factory'
import { invalidateAuthCacheForUser, type JwtContext, type OrgRole } from './authJwt.js'
import { supabaseAdmin } from '../lib/db.js'
import { ApiError } from '../lib/errors.js'

/** Methods that cannot change state. Everything else counts as a write. */
const READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS'])

export function isReadMethod(method: string): boolean {
  return READ_METHODS.has(method.toUpperCase())
}

/**
 * The caller's CURRENT role in `orgId`, read straight from org_members and
 * bypassing the authJwt cache. `null` means they are no longer a member.
 *
 * supabase-js resolves (never rejects) on failure, so the error branch is
 * checked explicitly. A failed lookup fails CLOSED: we cannot authorize a
 * write without knowing the role.
 */
export async function fetchCurrentRole(orgId: string, userId: string): Promise<OrgRole | null> {
  const { data, error } = await supabaseAdmin
    .from('org_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    console.error('[requireRole] membership re-check failed:', error.message)
    throw new ApiError('INTERNAL_ERROR', 'Failed to verify workspace role')
  }
  return (data?.role as OrgRole | undefined) ?? null
}

export interface RoleCheckInput {
  method: string
  orgId: string | null | undefined
  userId: string | null | undefined
  cachedRole: OrgRole | null | undefined
}

/**
 * The role a request is authorized with.
 *
 *   - Reads (GET/HEAD/OPTIONS) use the role authJwt resolved, which may be
 *     up to 60s old (see the cache notes in authJwt.ts).
 *   - Writes re-read org_members, so a demotion or removal takes effect on
 *     the very next write, on every instance. When the fresh role differs from
 *     the cached one, this instance's cache entries for the user are dropped
 *     so their reads catch up too.
 *
 * No org or no user (pre-onboarding, or the API-key path of a dual-auth
 * router) yields null without touching the DB.
 */
export async function resolveAuthorizedRole(input: RoleCheckInput): Promise<OrgRole | null> {
  const cachedRole = input.cachedRole ?? null
  if (isReadMethod(input.method)) return cachedRole
  if (!input.orgId || !input.userId) return null

  const freshRole = await fetchCurrentRole(input.orgId, input.userId)
  if (freshRole !== cachedRole) invalidateAuthCacheForUser(input.userId)
  return freshRole
}

/**
 * Gate an endpoint by org role. Runs AFTER `authJwt`, which populates
 * `orgId`, `userId` and a (possibly cached) `role`.
 *
 * Usage:
 *   router.post('/prompts', requireRole('admin', 'editor'), handler)
 *   router.delete('/organizations/:id', requireRole('admin'), handler)
 *
 * viewer can read everything (GET endpoints don't need this middleware).
 * `null` role (unjoined user, or removed since the cache entry was made)
 * always fails. On writes the role is re-verified against org_members, and
 * the fresh value replaces `c.get('role')` for the handler.
 */
export const requireRole = (...allowed: OrgRole[]) =>
  createMiddleware<JwtContext>(async (c, next) => {
    const cachedRole = c.get('role')
    const role = await resolveAuthorizedRole({
      method: c.req.method,
      orgId: c.get('orgId'),
      userId: c.get('userId'),
      cachedRole,
    })
    if (role !== (cachedRole ?? null)) c.set('role', role)
    if (!role || !allowed.includes(role)) {
      // Details carries the required vs. actual role so an audit log
      // can show why the call was rejected without re-parsing the URL.
      throw ApiError.from('FORBIDDEN', { required: allowed, actual: role })
    }
    return next()
  })
