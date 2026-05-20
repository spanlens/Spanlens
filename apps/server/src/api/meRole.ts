import { Hono } from 'hono'
import { authJwt, type JwtContext, type OrgRole } from '../middleware/authJwt.js'

/**
 * GET /api/v1/me/role — the signed-in user's role within their active workspace.
 *
 * Why this exists:
 *   The sidebar's "show admin links?" check used to call useMembers(), which
 *   fetches /api/v1/organizations/:orgId/members. That endpoint internally
 *   does supabaseAdmin.auth.admin.listUsers({ perPage: 200 }) — a 2-3s call
 *   that scales with total user count in the Supabase project, just to look
 *   up the current user's role.
 *
 * What this does instead:
 *   authJwt already resolved the active workspace and the user's role inside
 *   it (via org_members). This endpoint just returns what's already in the
 *   request context — no DB, no auth admin call, ~5ms response.
 *
 * Response shape mirrors the consumers' needs:
 *   { role: 'admin' | 'editor' | 'viewer' | null, orgId: string | null }
 */

export const meRoleRouter = new Hono<JwtContext>()

meRoleRouter.use('*', authJwt)

interface MeRoleResponse {
  role: OrgRole | null
  orgId: string | null
}

meRoleRouter.get('/', (c) => {
  const body: MeRoleResponse = {
    role: c.get('role'),
    orgId: c.get('orgId'),
  }
  return c.json({ success: true, data: body })
})
