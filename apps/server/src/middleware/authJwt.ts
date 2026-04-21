import { createMiddleware } from 'hono/factory'
import { supabaseClient } from '../lib/db.js'

export type JwtContext = {
  Variables: {
    userId: string
    /**
     * Organization id from the user's JWT app_metadata claim.
     * `null` means the user has not completed onboarding yet.
     * Routes that require an org should guard with:
     *   if (!orgId) return c.json({ error: 'Organization not found' }, 404)
     */
    orgId: string | null
  }
}

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

  c.set('userId', data.user.id)

  // Extract org_id from app_metadata claim (set by POST /api/v1/organizations).
  // Falls back to null — callers must handle the missing-org case.
  const appMetadata = data.user.app_metadata as { org_id?: unknown } | undefined
  const claimOrgId =
    typeof appMetadata?.org_id === 'string' ? appMetadata.org_id : null
  c.set('orgId', claimOrgId)

  return next()
})
