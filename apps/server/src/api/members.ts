import { Hono, type Context } from 'hono'
import { authJwt, type JwtContext, type OrgRole } from '../middleware/authJwt.js'
import { requireRole } from '../middleware/requireRole.js'
import { supabaseAdmin } from '../lib/db.js'
import { recordAuditEvent } from '../lib/audit-log.js'
import { ApiError } from '../lib/errors.js'

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
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')
  if (orgMismatch(c)) throw new ApiError('FORBIDDEN', 'Forbidden')

  // Join to auth.users for email. supabase-js can't join auth.users in a
  // single .select() because it's cross-schema, so we fetch members then
  // bulk-fetch emails via admin.listUsers — cheap for team-sized rosters.
  const { data: members, error } = await supabaseAdmin
    .from('org_members')
    .select('user_id, role, invited_by, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true })

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to fetch members')

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
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')
  if (orgMismatch(c)) throw new ApiError('FORBIDDEN', 'Forbidden')

  const userId = c.req.param('userId')

  let body: { role?: unknown }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  if (typeof body.role !== 'string' || !VALID_ROLES.includes(body.role as OrgRole)) {
    throw new ApiError('VALIDATION_FAILED', 'role must be admin | editor | viewer')
  }
  const newRole = body.role as OrgRole

  const current = await memberRole(orgId, userId)
  if (!current) throw new ApiError('NOT_FOUND', 'Member not found')
  if (current === newRole) return c.json({ success: true, data: { role: current } })

  // Last-admin protection: demoting the last admin locks the org out.
  if (current === 'admin' && newRole !== 'admin') {
    if ((await adminCount(orgId)) <= 1) {
      throw new ApiError('BAD_REQUEST', 'Cannot demote the last admin')
    }
  }

  const { error } = await supabaseAdmin
    .from('org_members')
    .update({ role: newRole })
    .eq('organization_id', orgId)
    .eq('user_id', userId)

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to update role')

  void recordAuditEvent(c, {
    action: 'member.role_change',
    resourceType: 'org_members',
    resourceId: userId,
    metadata: { previous_role: current, new_role: newRole },
  })

  return c.json({ success: true, data: { role: newRole } })
})

// ── DELETE /api/v1/organizations/:orgId/members/:userId ───────
// Remove a member. Admin only. Blocks removing the last admin.
membersRouter.delete('/:userId', requireAdmin, async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')
  if (orgMismatch(c)) throw new ApiError('FORBIDDEN', 'Forbidden')

  const userId = c.req.param('userId')
  const current = await memberRole(orgId, userId)
  if (!current) throw new ApiError('NOT_FOUND', 'Member not found')

  if (current === 'admin' && (await adminCount(orgId)) <= 1) {
    throw new ApiError('BAD_REQUEST', 'Cannot remove the last admin')
  }

  const { error } = await supabaseAdmin
    .from('org_members')
    .delete()
    .eq('organization_id', orgId)
    .eq('user_id', userId)

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to remove member')

  void recordAuditEvent(c, {
    action: 'member.remove',
    resourceType: 'org_members',
    resourceId: userId,
    metadata: { removed_role: current },
  })

  return c.json({ success: true })
})
