import { Hono, type Context } from 'hono'
import { authJwt, type JwtContext, type OrgRole } from '../middleware/authJwt.js'
import { requireRole } from '../middleware/requireRole.js'
import { supabaseAdmin } from '../lib/db.js'
import { recordAuditEvent } from '../lib/audit-log.js'
import { ApiError } from '../lib/errors.js'
import { isUuid } from '../lib/params.js'
import { changeMemberRole, listMemberEmails, removeMember } from '../lib/org-members.js'

/**
 * /api/v1/organizations/:orgId/members — team roster + role management.
 *
 *   GET    /                 list members (any role can read)
 *   PATCH  /:userId          change role (admin only)
 *   DELETE /:userId          remove member (admin only)
 *
 * Last-admin protection: we never let the org slide into a 0-admin state.
 * If a demote or delete would leave the org with zero admins, we reject
 * with 400. This replaces the old "owner is immortal" rule from the
 * owner-based model and covers self-demote/self-delete too.
 *
 * The check and the write happen in one SQL function under an org-scoped
 * lock (org_change_member_role / org_remove_member, see lib/org-members.ts).
 * Counting admins in one request and writing in another let two admins
 * demote each other concurrently, both reading "2 admins", and leave the org
 * with none (C5.1).
 */

export const membersRouter = new Hono<JwtContext>()
membersRouter.use('*', authJwt)

const VALID_ROLES: OrgRole[] = ['admin', 'editor', 'viewer']
const requireAdmin = requireRole('admin')

/** Guard: URL :orgId must match the user's actual org. */
function orgMismatch(c: Context<JwtContext>): boolean {
  return c.req.param('orgId') !== c.get('orgId')
}

/** Path :userId, 404 when malformed (same answer as an unknown member). */
function memberIdParam(c: Context<JwtContext>): string {
  const userId = c.req.param('userId') ?? ''
  if (!isUuid(userId)) throw new ApiError('NOT_FOUND', 'Member not found')
  return userId
}

// ── GET /api/v1/organizations/:orgId/members ──────────────────
// All members (incl. viewers) can see the team roster.
membersRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')
  if (orgMismatch(c)) throw new ApiError('FORBIDDEN', 'Forbidden')

  const { data: members, error } = await supabaseAdmin
    .from('org_members')
    .select('user_id, role, invited_by, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true })

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to fetch members')

  // Emails live in auth.users, which PostgREST cannot join. org_member_emails
  // reads them for exactly this org's members.
  const emails = new Map<string, string>()
  if ((members ?? []).length > 0) {
    for (const row of await listMemberEmails(orgId, 'Failed to fetch member emails')) {
      if (row.email) emails.set(row.userId, row.email)
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

  const userId = memberIdParam(c)

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

  const outcome = await changeMemberRole(orgId, userId, newRole)
  switch (outcome.status) {
    case 'not_found':
      throw new ApiError('NOT_FOUND', 'Member not found')
    case 'last_admin':
      // Demoting the last admin would lock the org out of billing and members.
      throw new ApiError('BAD_REQUEST', 'Cannot demote the last admin')
    case 'unchanged':
      return c.json({ success: true, data: { role: outcome.previousRole } })
    case 'ok':
      break
  }

  void recordAuditEvent(c, {
    action: 'member.role_change',
    resourceType: 'org_members',
    resourceId: userId,
    metadata: { previous_role: outcome.previousRole, new_role: newRole },
  })

  return c.json({ success: true, data: { role: newRole } })
})

// ── DELETE /api/v1/organizations/:orgId/members/:userId ───────
// Remove a member. Admin only. Blocks removing the last admin.
membersRouter.delete('/:userId', requireAdmin, async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')
  if (orgMismatch(c)) throw new ApiError('FORBIDDEN', 'Forbidden')

  const userId = memberIdParam(c)

  const outcome = await removeMember(orgId, userId)
  switch (outcome.status) {
    case 'not_found':
      throw new ApiError('NOT_FOUND', 'Member not found')
    case 'last_admin':
      throw new ApiError('BAD_REQUEST', 'Cannot remove the last admin')
    case 'ok':
      break
  }

  void recordAuditEvent(c, {
    action: 'member.remove',
    resourceType: 'org_members',
    resourceId: userId,
    metadata: { removed_role: outcome.removedRole },
  })

  return c.json({ success: true })
})
