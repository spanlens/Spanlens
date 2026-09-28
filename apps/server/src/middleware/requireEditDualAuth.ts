import { createMiddleware } from 'hono/factory'
import type { DualAuthContext } from './authJwtOrApiKey.js'
import { resolveAuthorizedRole } from './requireRole.js'
import { ApiError } from '../lib/errors.js'

/**
 * Write gate for DUAL-AUTH routers (authJwtOrApiKey), where plain
 * `requireRole('admin','editor')` must not be used: the API-key path has a
 * null role and would be rejected, breaking CI/SDK callers (`sl_live_*`).
 *
 *   - JWT (dashboard) path: role is set → require admin/editor so a
 *     viewer-role member cannot write. Like requireRole, the role is
 *     re-read from org_members on writes instead of trusting the 60s authJwt
 *     cache, so a member demoted to viewer (or removed) is rejected at once.
 *   - API-key path: role is null → pass through without a DB lookup. Mount
 *     `requireFullScope` BEFORE this middleware so a public (sl_live_pub_*)
 *     key stays read-only.
 *
 * Usage (order matters):
 *   router.post('/thing', requireFullScope, requireEditDualAuth, handler)
 */
export const requireEditDualAuth = createMiddleware<DualAuthContext>(async (c, next) => {
  const cachedRole = c.get('role')
  if (cachedRole == null) return next()

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
