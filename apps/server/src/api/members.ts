import { Hono, type Context } from 'hono'
import { authJwt, type JwtContext, type OrgRole } from '../middleware/authJwt.js'
import { requireRole } from '../middleware/requireRole.js'
import { supabaseAdmin } from '../lib/db.js'

/**
 * /api/v1/organizations/:orgId/members — team roster + role management.
 *
 *   GET    /                 list members (any role can read)
 *   PATCH  /:userId          change role (admin only)
 *   DELETE /:userId          remove member (admin only)
 *
 * Last-admin protection: we never let the org slide into a 0-admin state.
 * If a demote or delete would leave the org with zero admins, we reject
 * with 400 before touching the DB. This replaces the old "owner is immortal"
 * rule from the owner-based model and covers self-demote/self-delete too.
 */

export const membersRouter = new Hono<JwtContext>()
membersRouter.use('*', authJwt)

const VALID_ROLES: OrgRole[] = ['admin', 'editor', 'viewer']
const requireAdmin = requireRole('admin')

/** Guard: URL :orgId must match the user's actual org. */
function orgMismatch(c: Context<JwtContext>): boolean {
  return c.req.param('orgId') !== c.get('orgId')
}

/** Count admins in the org. Used by last-admin protection. */
async function adminCount(orgId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from('org_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('role', 'admin')
  return count ?? 0
}

/** Current role of a member, null if not a member. */
async function memberRole(orgId: string, userId: string): Promise<OrgRole | null> {
  const { data } = await supabaseAdmin
    .from('org_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()
  return (data?.role as OrgRole | undefined) ?? null
}

// ── GET /api/v1/organizations/:orgId/members ──────────────────
// All members (incl. viewers) can see the team roster.
membersRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)
  if (orgMismatch(c)) return c.json({ error: 'Forbidden' }, 403)

  // Join to auth.users for email. supabase-js can't join auth.users in a
  // single .select() because it's cross-schema, so we fetch members then
  // bulk-fetch emails via admin.listUsers — cheap for team-sized rosters.
  const { data: members, error } = await supabaseAdmin
    .from('org_members')
    .select('user_id, role, invited_by, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true })

  if (error) return c.json({ error: 'Failed to fetch members' }, 500)

  const userIds = (members ?? []).map((m) => m.user_id)
  const emails = new Map<string, string>()
  if (userIds.length > 0) {
    // listUsers is paginated; for a single org's roster it fits in one page.
    const { data: userList } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 })
    for (const u of userList?.users ?? []) {
      if (userIds.includes(u.id) && u.email) emails.set(u.id, u.email)
    }
  }

  return c.json({
    success: true,
    data: (members ?? []).map((m) => ({
      userId: m.user_id,
      email: emails.get(m.user_id) ?? '(unknown)',
      role: m.role,
      invitedBy: m.invited_by,
      createdAt: m.created_at,
    })),
  })
})

// ── PATCH /api/v1/organizations/:orgId/members/:userId ────────
// Change a member's role. Admin only. Blocks demoting the last admin.
membersRouter.patch('/:userId', requireAdmin, async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)
  if (orgMismatch(c)) return c.json({ error: 'Forbidden' }, 403)

  const userId = c.req.param('userId')

  let body: { role?: unknown }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (typeof body.role !== 'string' || !VALID_ROLES.includes(body.role as OrgRole)) {
    return c.json({ error: 'role must be admin | editor | viewer' }, 400)
  }
  const newRole = body.role as OrgRole

  const current = await memberRole(orgId, userId)
  if (!current) return c.json({ error: 'Member not found' }, 404)
  if (current === newRole) return c.json({ success: true, data: { role: current } })

  // Last-admin protection: demoting the last admin locks the org out.
  if (current === 'admin' && newRole !== 'admin') {
    if ((await adminCount(orgId)) <= 1) {
      return c.json({ error: 'Cannot demote the last admin' }, 400)
    }
  }

  const { error } = await supabaseAdmin
    .from('org_members')
    .update({ role: newRole })
    .eq('organization_id', orgId)
    .eq('user_id', userId)

  if (error) return c.json({ error: 'Failed to update role' }, 500)
  return c.json({ success: true, data: { role: newRole } })
})

// ── DELETE /api/v1/organizations/:orgId/members/:userId ───────
// Remove a member. Admin only. Blocks removing the last admin.
membersRouter.delete('/:userId', requireAdmin, async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)
  if (orgMismatch(c)) return c.json({ error: 'Forbidden' }, 403)

  const userId = c.req.param('userId')
  const current = await memberRole(orgId, userId)
  if (!current) return c.json({ error: 'Member not found' }, 404)

  if (current === 'admin' && (await adminCount(orgId)) <= 1) {
    return c.json({ error: 'Cannot remove the last admin' }, 400)
  }

  const { error } = await supabaseAdmin
    .from('org_members')
    .delete()
    .eq('organization_id', orgId)
    .eq('user_id', userId)

  if (error) return c.json({ error: 'Failed to remove member' }, 500)
  return c.json({ success: true })
})
