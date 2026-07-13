import { createMiddleware } from 'hono/factory'
import type { DualAuthContext } from './authJwtOrApiKey.js'
import { ApiError } from '../lib/errors.js'

/**
 * Write gate for DUAL-AUTH routers (authJwtOrApiKey), where plain
 * `requireRole('admin','editor')` must not be used: the API-key path has a
 * null role and would be rejected, breaking CI/SDK callers (`sl_live_*`).
 *
 *   - JWT (dashboard) path: role is set → require admin/editor so a
 *     viewer-role member cannot write.
 *   - API-key path: role is null → pass through. Mount `requireFullScope`
 *     BEFORE this middleware so a public (sl_live_pub_*) key stays read-only.
 *
 * Usage (order matters):
 *   router.post('/thing', requireFullScope, requireEditDualAuth, handler)
 */
export const requireEditDualAuth = createMiddleware<DualAuthContext>(async (c, next) => {
  const role = c.get('role')
  if (role != null && role !== 'admin' && role !== 'editor') {
    throw ApiError.from('FORBIDDEN', { required: ['admin', 'editor'], actual: role })
  }
  return next()
})
