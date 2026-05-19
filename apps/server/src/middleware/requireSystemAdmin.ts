import { createMiddleware } from 'hono/factory'
import { supabaseClient } from '../lib/db.js'
import type { JwtContext } from './authJwt.js'

/**
 * Gate an endpoint to Spanlens internal operators (system admin), as
 * distinct from per-org `admin` role.
 *
 * Org admins manage their own organization (members, billing, keys).
 * System admins manage Spanlens-global resources — model prices, feature
 * flags, internal dashboards. There is no DB-resident `system_admin` role
 * today; instead we check the authenticated user's email against the
 * `SPANLENS_ADMIN_EMAILS` env var (comma-separated allowlist).
 *
 * Usage:
 *   router.use('*', authJwt)
 *   router.use('*', requireSystemAdmin)
 *
 * Cold-start: if SPANLENS_ADMIN_EMAILS is unset, ALL system admin routes
 * return 403. That is intentional — fail closed.
 */
export const requireSystemAdmin = createMiddleware<JwtContext>(async (c, next) => {
  const userId = c.get('userId')
  if (!userId) return c.json({ error: 'Insufficient permission' }, 403)

  const allowlistRaw = process.env['SPANLENS_ADMIN_EMAILS'] ?? ''
  const allowlist = allowlistRaw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

  if (allowlist.length === 0) {
    return c.json({ error: 'Insufficient permission' }, 403)
  }

  // Look up email via auth.users — we don't put it on the JWT context to
  // avoid leaking it through every other request.
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Insufficient permission' }, 403)
  }
  const token = authHeader.slice(7)
  const { data, error } = await supabaseClient.auth.getUser(token)
  if (error || !data.user?.email) {
    return c.json({ error: 'Insufficient permission' }, 403)
  }

  if (!allowlist.includes(data.user.email.toLowerCase())) {
    return c.json({ error: 'Insufficient permission' }, 403)
  }

  return next()
})
