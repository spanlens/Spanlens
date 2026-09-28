import { createMiddleware } from 'hono/factory'
import type { DualAuthContext } from './authJwtOrApiKey.js'
import { resolveAuthorizedRole } from './requireRole.js'
import { ApiError } from '../lib/errors.js'

/**
 * Write gate for DUAL-AUTH routers (authJwtOrApiKey), where plain
 * `requireRole('admin','editor')` must not be used: the API-key path has a
 * null role and would be rejected, breaking CI/SDK callers (`sl_live_*`).
 *
 *   - API-key path (authApiKey set `apiKeyId`): pass through without a DB
 *     lookup. Mount `requireFullScope` BEFORE this middleware so a public
 *     (sl_live_pub_*) key stays read-only.
 *   - JWT (dashboard) path, i.e. everything else: require admin/editor so a
 *     viewer-role member cannot write. Like requireRole, the role is re-read
 *     from org_members on writes instead of trusting the 60s authJwt cache,
 *     so a member demoted to viewer (or removed) is rejected at once.
 *
 * The API-key path is recognised by `apiKeyId`, never by a null role. A JWT
 * caller can have a null role too (removed from the workspace, or not in one
 * yet), and authJwt resolves a write's role fresh, so a member removed a
 * moment ago arrives here with role null. Treating that as the API-key path
 * would wave them through.
 *
 * Usage (order matters):
 *   router.post('/thing', requireFullScope, requireEditDualAuth, handler)
 */
export const requireEditDualAuth = createMiddleware<DualAuthContext>(async (c, next) => {
  if (c.get('apiKeyId')) return next()

  const cachedRole = c.get('role') ?? null
  const role = await resolveAuthorizedRole({
    method: c.req.method,
    orgId: c.get('orgId'),
    userId: c.get('userId'),
    cachedRole,
  })
  if (role !== cachedRole) c.set('role', role)
  if (role !== 'admin' && role !== 'editor') {
    throw ApiError.from('FORBIDDEN', { required: ['admin', 'editor'], actual: role })
  }
  return next()
})
