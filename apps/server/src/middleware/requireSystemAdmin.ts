import { createMiddleware } from 'hono/factory'
import { supabaseClient } from '../lib/db.js'
import { ApiError } from '../lib/errors.js'
import type { JwtContext } from './authJwt.js'

/**
 * Single 403 message used for every reject reason in this middleware.
 * Intentionally identical across the five branches below: a non-admin
 * caller must not be able to distinguish "your email is not on the
 * allowlist" from "the allowlist itself is unset" from "your token is
 * invalid". That distinction would be a probing vector. Operators
 * needing the real reason can read the request id from the response
 * envelope and grep server logs.
 */
const FORBIDDEN = (): ApiError => new ApiError('FORBIDDEN', 'Insufficient permission')

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
  if (!userId) throw FORBIDDEN()

  const allowlistRaw = process.env['SPANLENS_ADMIN_EMAILS'] ?? ''
  const allowlist = allowlistRaw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

  if (allowlist.length === 0) {
    throw FORBIDDEN()
  }

  // Look up email via auth.users — we don't put it on the JWT context to
  // avoid leaking it through every other request.
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    throw FORBIDDEN()
  }
  const token = authHeader.slice(7)
  const { data, error } = await supabaseClient.auth.getUser(token)
  if (error || !data.user?.email) {
    throw FORBIDDEN()
  }

  if (!allowlist.includes(data.user.email.toLowerCase())) {
    throw FORBIDDEN()
  }

  return next()
})
