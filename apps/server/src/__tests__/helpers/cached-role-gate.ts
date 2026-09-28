import { createMiddleware } from 'hono/factory'
import type { JwtContext, OrgRole } from '../../middleware/authJwt.js'
import { ApiError } from '../../lib/errors.js'

/**
 * Stand-in for middleware/requireRole.js in route tests that stub authJwt.
 *
 * The real gate re-reads org_members on every write (auth-cache-staleness
 * covers that path end to end). Route tests that only care about their own
 * handler set the caller's role through their authJwt stub, so this gate
 * checks that role and nothing else.
 */
export const requireRole = (...allowed: OrgRole[]) =>
  createMiddleware<JwtContext>(async (c, next) => {
    const role = c.get('role')
    if (!role || !allowed.includes(role)) {
      throw ApiError.from('FORBIDDEN', { required: allowed, actual: role ?? null })
    }
    return next()
  })
