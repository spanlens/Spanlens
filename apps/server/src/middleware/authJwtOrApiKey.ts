import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { authJwt, type JwtContext } from './authJwt.js'
import { authApiKey, type ApiKeyContext } from './authApiKey.js'

/**
 * Dual-auth middleware for `/api/v1/*` read endpoints.
 *
 * Routes the request through one of two existing auth paths depending on
 * the Authorization header shape:
 *
 *   Authorization: Bearer sl_live_…   → authApiKey   (Spanlens key)
 *   Authorization: Bearer <JWT>       → authJwt      (Supabase session)
 *   (no header)                       → 401 from authJwt
 *
 * After authApiKey succeeds we bridge the resolved `organizationId` into
 * the `orgId` variable that JWT-shaped handlers already read — so the
 * read API routes don't need to know which auth flow ran. The
 * `JwtContext.email` / `userId` / `role` fields remain unset on the
 * API-key path; handlers that genuinely need user identity (audit logs,
 * member management) should keep using `authJwt` directly.
 *
 * Why a wrapper rather than touching individual route auth: this keeps
 * the change to "pick which auth middleware runs" rather than rewriting
 * every read handler. Routes opt in by importing this in place of
 * `authJwt`.
 */
export type DualAuthContext = JwtContext & ApiKeyContext

export const authJwtOrApiKey = createMiddleware<DualAuthContext>(async (c, next) => {
  const authHeader = c.req.header('Authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null

  // Spanlens key path — delegated to authApiKey, then bridge orgId so
  // downstream code that reads `c.get('orgId')` works regardless of auth.
  //
  // The casts below are sound at runtime: DualAuthContext.Variables is the
  // union of both auth contexts' variable bags. Hono's Context is invariant
  // in its env type parameter so TS can't see that — the cast is mechanical.
  if (token && token.startsWith('sl_live_')) {
    return authApiKey(c as unknown as Context<ApiKeyContext>, async () => {
      c.set('orgId', c.get('organizationId'))
      return next()
    })
  }

  // JWT path (Supabase session) — unchanged from existing behaviour.
  return authJwt(c as unknown as Context<JwtContext>, next)
})
