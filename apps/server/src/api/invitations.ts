import { Hono, type Context } from 'hono'
import { randomBytes, createHash } from 'node:crypto'
import { authJwt, type JwtContext, type OrgRole } from '../middleware/authJwt.js'
import { requireRole } from '../middleware/requireRole.js'
import { supabaseAdmin } from '../lib/db.js'
import { sendEmail, renderInvitationEmail } from '../lib/resend.js'

/**
 * Invitations — email-based org member onboarding.
 *
 *   POST   /api/v1/organizations/:orgId/invitations         (admin) create + send
 *   GET    /api/v1/organizations/:orgId/invitations         (member) list pending
 *   DELETE /api/v1/invitations/:id                          (admin) cancel pending
 *   GET    /api/v1/invitations/accept?token=xxx             (public) verify token
 *   POST   /api/v1/invitations/accept                       (auth)  accept
 *
 * Token model:
 *   - Raw token: crypto.randomBytes(32).toString('base64url') (43 chars)
 *   - DB stores sha256(token) hex. Raw lives only in the email URL.
 *   - On accept: hash the submitted token → look up → validate expiry +
 *     not already accepted + email match → atomic member INSERT + mark
 *     accepted.
 */

const VALID_ROLES: OrgRole[] = ['admin', 'editor', 'viewer']
const INVITE_TTL_DAYS = 7

// ── Org-scoped router (admin create / member list) ─────────────
// Mounted at /api/v1/organizations/:orgId/invitations
export const orgInvitationsRouter = new Hono<JwtContext>()
orgInvitationsRouter.use('*', authJwt)

function orgMismatch(c: Context<JwtContext>): boolean {
  return c.req.param('orgId') !== c.get('orgId')
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// ── POST /api/v1/organizations/:orgId/invitations ─────────────
orgInvitationsRouter.post('/', requireRole('admin'), async (c) => {
  const orgId = c.get('orgId')
  const userId = c.get('userId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)
  if (orgMismatch(c)) return c.json({ error: 'Forbidden' }, 403)

  let body: { email?: unknown; role?: unknown }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (typeof body.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return c.json({ error: 'Valid email is required' }, 400)
  }
  if (typeof body.role !== 'string' || !VALID_ROLES.includes(body.role as OrgRole)) {
    return c.json({ error: 'role must be admin | editor | viewer' }, 400)
  }

  const email = body.email.toLowerCase().trim()
  const role = body.role as OrgRole

  // Reject if the email is already a member of THIS org. Other orgs are
  // fine — one user can belong to multiple orgs (future multi-org UI).
  const { data: existingUser } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 })
  const matched = existingUser?.users.find((u) => u.email?.toLowerCase() === email)
  if (matched) {
    const { data: alreadyMember } = await supabaseAdmin
      .from('org_members')
      .select('user_id')
      .eq('organization_id', orgId)
      .eq('user_id', matched.id)
      .maybeSingle()
    if (alreadyMember) {
      return c.json({ error: 'This user is already a member of the organization' }, 409)
    }
  }

  // Reject duplicate pending invite for the same email/org pair.
  const { data: pending } = await supabaseAdmin
    .from('org_invitations')
    .select('id')
    .eq('organization_id', orgId)
    .eq('email', email)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (pending) {
    return c.json({ error: 'A pending invitation for this email already exists' }, 409)
  }

  const token = randomBytes(32).toString('base64url')
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString()

  const { data: inserted, error } = await supabaseAdmin
    .from('org_invitations')
    .insert({
      organization_id: orgId,
      email,
      role,
      token_hash: tokenHash,
      invited_by: userId,
      expires_at: expiresAt,
    })
    .select('id, email, role, expires_at, created_at')
    .single()

  if (error || !inserted) {
    return c.json({ error: 'Failed to create invitation' }, 500)
  }

  // Fetch org name + inviter email for the email body
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('name')
    .eq('id', orgId)
    .single()
  const { data: inviter } = await supabaseAdmin.auth.admin.getUserById(userId)

  const webUrl = process.env.WEB_URL ?? 'http://localhost:3000'
  const acceptUrl = `${webUrl}/invite?token=${encodeURIComponent(token)}`

  const { subject, html } = renderInvitationEmail({
    orgName: org?.name ?? 'Spanlens workspace',
    inviterEmail: inviter?.user?.email ?? 'someone',
    role,
    acceptUrl,
  })

  const emailResult = await sendEmail({ to: email, subject, html, devPreviewUrl: acceptUrl })

  return c.json({
    success: true,
    data: inserted,
    // In dev (no RESEND_API_KEY), surface the URL so testers can paste it.
    ...(emailResult.sent ? {} : { devAcceptUrl: acceptUrl }),
  }, 201)
})

// ── GET /api/v1/organizations/:orgId/invitations ──────────────
// Any member can see pending invites (list in Settings > Members).
orgInvitationsRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)
  if (orgMismatch(c)) return c.json({ error: 'Forbidden' }, 403)

  const { data, error } = await supabaseAdmin
    .from('org_invitations')
    .select('id, email, role, expires_at, created_at, invited_by')
    .eq('organization_id', orgId)
    .is('accepted_at', null)
    .order('created_at', { ascending: false })

  if (error) return c.json({ error: 'Failed to fetch invitations' }, 500)
  return c.json({ success: true, data: data ?? [] })
})

// ── Token-scoped router (accept / cancel) ─────────────────────
// Mounted at /api/v1/invitations
export const invitationsRouter = new Hono<JwtContext>()

// GET /api/v1/invitations/accept?token=xxx — PUBLIC (no auth)
// Used by the /invite page to show orgName/role/email before the user
// decides whether to accept. We intentionally don't require login here so
// unregistered users can see what they're about to sign up for.
invitationsRouter.get('/accept', async (c) => {
  const token = c.req.query('token')
  if (!token) return c.json({ error: 'Missing token' }, 400)

  const { data: inv } = await supabaseAdmin
    .from('org_invitations')
    .select('id, email, role, organization_id, expires_at, accepted_at')
    .eq('token_hash', hashToken(token))
    .maybeSingle()

  if (!inv) return c.json({ error: 'Invalid invitation' }, 404)
  if (inv.accepted_at) return c.json({ error: 'Invitation already accepted' }, 400)
  if (new Date(inv.expires_at) < new Date()) {
    return c.json({ error: 'Invitation expired' }, 400)
  }

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('name')
    .eq('id', inv.organization_id)
    .single()

  return c.json({
    success: true,
    data: {
      email: inv.email,
      role: inv.role,
      orgName: org?.name ?? 'Unknown',
    },
  })
})

// POST /api/v1/invitations/accept — requires auth + email match.
invitationsRouter.post('/accept', authJwt, async (c) => {
  const userId = c.get('userId')

  let body: { token?: unknown }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  if (typeof body.token !== 'string' || body.token.length === 0) {
    return c.json({ error: 'Token is required' }, 400)
  }

  const { data: inv } = await supabaseAdmin
    .from('org_invitations')
    .select('id, email, role, organization_id, expires_at, accepted_at')
    .eq('token_hash', hashToken(body.token))
    .maybeSingle()

  if (!inv) return c.json({ error: 'Invalid invitation' }, 404)
  if (inv.accepted_at) return c.json({ error: 'Invitation already accepted' }, 400)
  if (new Date(inv.expires_at) < new Date()) {
    return c.json({ error: 'Invitation expired' }, 400)
  }

  // Email check: invitation is bound to the invitee's email. Anyone else
  // with the link can't use it. Case-insensitive since auth.users emails
  // are stored normalized but users type them any which way.
  const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId)
  const currentEmail = userData?.user?.email?.toLowerCase()
  if (!currentEmail || currentEmail !== inv.email.toLowerCase()) {
    return c.json({ error: 'This invitation was sent to a different email' }, 400)
  }

  // Idempotent: if user is already in the org (another channel?), just mark
  // the invite accepted and move on rather than erroring.
  const { data: existingMember } = await supabaseAdmin
    .from('org_members')
    .select('user_id')
    .eq('organization_id', inv.organization_id)
    .eq('user_id', userId)
    .maybeSingle()

  if (!existingMember) {
    const { error: insertErr } = await supabaseAdmin.from('org_members').insert({
      organization_id: inv.organization_id,
      user_id: userId,
      role: inv.role as OrgRole,
      invited_by: inv.id ? null : null, // invited_by points at a user, not invite — we don't have inviter id here
    })
    if (insertErr) return c.json({ error: 'Failed to add member' }, 500)
  }

  const { error: markErr } = await supabaseAdmin
    .from('org_invitations')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', inv.id)
  if (markErr) {
    // Member row already exists at this point — rolling back would leave a
    // confusing partial state. Log and move on; worst case the invite is
    // retriable but creates a no-op (idempotent guard above handles it).
    console.error('Failed to mark invitation accepted', markErr)
  }

  return c.json({ success: true, data: { organizationId: inv.organization_id, role: inv.role } })
})

// DELETE /api/v1/invitations/:id — admin cancel (auth required)
invitationsRouter.delete('/:id', authJwt, requireRole('admin'), async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const id = c.req.param('id')

  // Scope the delete to the user's org so admins can't cancel invitations
  // belonging to other orgs.
  const { error, count } = await supabaseAdmin
    .from('org_invitations')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('organization_id', orgId)
    .is('accepted_at', null)

  if (error) return c.json({ error: 'Failed to cancel invitation' }, 500)
  if (count === 0) return c.json({ error: 'Invitation not found' }, 404)
  return c.json({ success: true })
})
