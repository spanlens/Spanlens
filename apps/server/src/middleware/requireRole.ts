import { createMiddleware } from 'hono/factory'
import type { JwtContext, OrgRole } from './authJwt.js'
import { ApiError } from '../lib/errors.js'

/**
 * Gate an endpoint by org role. Runs AFTER `authJwt` — relies on
 * `c.get('role')` being populated.
 *
 * Usage:
 *   router.post('/prompts', requireRole('admin', 'editor'), handler)
 *   router.delete('/organizations/:id', requireRole('admin'), handler)
 *
 * viewer can read everything (GET endpoints don't need this middleware).
 * `null` role (unjoined user) always fails.
 */
export const requireRole = (...allowed: OrgRole[]) =>
  createMiddleware<JwtContext>(async (c, next) => {
    const role = c.get('role')
    if (!role || !allowed.includes(role)) {
      // Details carries the required vs. actual role so an audit log
      // can show why the call was rejected without re-parsing the URL.
      throw ApiError.from('FORBIDDEN', { required: allowed, actual: role })
    }
    return next()
  })
