import { Hono, type Context } from 'hono'
import { authJwt, type JwtContext, type OrgRole } from '../middleware/authJwt.js'
import { requireRole } from '../middleware/requireRole.js'
import { supabaseAdmin } from '../lib/db.js'
import { randomHex, sha256Hex } from '../lib/crypto.js'
import { sendEmail, renderInvitationEmail } from '../lib/resend.js'
import {
  auditContextFromHono,
  recordAuditEvent,
  recordAuditLog,
} from '../lib/audit-log.js'
import { ApiError } from '../lib/errors.js'

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
 *   - Raw token: 32 random bytes encoded as 64 hex chars (256 bits entropy).
 *     Hex (vs base64url) keeps the URL ASCII-clean and avoids any encoding
 *     ambiguity through email clients.
 *   - DB stores sha256(token) hex. Raw lives only in the email URL.
 *   - On accept: hash the submitted token → look up → validate expiry +
 *     not already accepted + email match → atomic member INSERT + mark
 *     accepted.
 *
 * Edge runtime note:
 *   We use the Web Crypto-based helpers from `lib/crypto.ts`
 *   (`randomHex`, `sha256Hex`) instead of `node:crypto` so this module is
 *   safe to import inside the Vercel Edge bundle (`apps/server/api/index.ts`).
 *   Node's `crypto` is unsupported there and triggers a build-time error.
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

// Web Crypto-based SHA-256 is async (`crypto.subtle.digest`). We re-export
// it under the hashToken name to keep call sites readable.
const hashToken = sha256Hex

// ── POST /api/v1/organizations/:orgId/invitations ─────────────
orgInvitationsRouter.post('/', requireRole('admin'), async (c) => {
  const orgId = c.get('orgId')
  const userId = c.get('userId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')
  if (orgMismatch(c)) throw new ApiError('FORBIDDEN', 'Forbidden')

  let body: { email?: unknown; role?: unknown }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  if (typeof body.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    throw new ApiError('VALIDATION_FAILED', 'Valid email is required')
  }
  if (typeof body.role !== 'string' || !VALID_ROLES.includes(body.role as OrgRole)) {
    throw new ApiError('VALIDATION_FAILED', 'role must be admin | editor | viewer')
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
      throw new ApiError('CONFLICT', 'This user is already a member of the organization')
    }
  }

  // Reject duplicate pending invite for the same email/org pair. Use limit(1)
  // rather than maybeSingle(): there is no unique constraint on
  // (organization_id, email, pending), so a double-click race can leave 2+
  // pending rows. maybeSingle() returns { data: null, error } on a multi-row
  // match, so the guard would fall through and EVERY later invite to that
  // email would pass (duplicate emails sent). limit(1) treats "≥1 pending
  // row exists" as the dedup hit. Same maybeSingle blind spot as the
  // organizations.ts bootstrap membership check.
  const { data: pendingRows, error: pendingErr } = await supabaseAdmin
    .from('org_invitations')
    .select('id')
    .eq('organization_id', orgId)
    .eq('email', email)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .limit(1)
  if (pendingErr) throw new ApiError('INTERNAL_ERROR', 'Failed to check pending invitations')
  if (pendingRows && pendingRows.length > 0) {
    throw new ApiError('CONFLICT', 'A pending invitation for this email already exists')
  }

  const token = randomHex(32)
  const tokenHash = await hashToken(token)
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
    throw new ApiError('INTERNAL_ERROR', 'Failed to create invitation')
  }

  // Fetch org name for the email body. Inviter email comes straight from the
  // JWT context — no second auth roundtrip needed.
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('name')
    .eq('id', orgId)
    .single()
  const inviterEmail = c.get('email')

  const webUrl = process.env.WEB_URL ?? 'http://localhost:3000'
  const acceptUrl = `${webUrl}/invite?token=${encodeURIComponent(token)}`

  const { subject, html } = renderInvitationEmail({
    orgName: org?.name ?? 'Spanlens workspace',
    inviterEmail: inviterEmail || 'someone',
    role,
    acceptUrl,
  })

  const emailResult = await sendEmail({ to: email, subject, html, devPreviewUrl: acceptUrl })

  void recordAuditEvent(c, {
    action: 'member.invite',
    resourceType: 'org_invitations',
    resourceId: inserted.id,
    metadata: { email, role, email_sent: emailResult.sent },
  })

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
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')
  if (orgMismatch(c)) throw new ApiError('FORBIDDEN', 'Forbidden')

  const { data, error } = await supabaseAdmin
    .from('org_invitations')
    .select('id, email, role, expires_at, created_at, invited_by')
    .eq('organization_id', orgId)
    .is('accepted_at', null)
    .order('created_at', { ascending: false })

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to fetch invitations')
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
  if (!token) throw new ApiError('BAD_REQUEST', 'Missing token')

  const { data: inv } = await supabaseAdmin
    .from('org_invitations')
    .select('id, email, role, organization_id, expires_at, accepted_at')
    .eq('token_hash', await hashToken(token))
    .maybeSingle()

  if (!inv) throw new ApiError('NOT_FOUND', 'Invalid invitation')
  if (inv.accepted_at) throw new ApiError('BAD_REQUEST', 'Invitation already accepted')
  if (new Date(inv.expires_at) < new Date()) {
    throw new ApiError('BAD_REQUEST', 'Invitation expired')
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
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }
  if (typeof body.token !== 'string' || body.token.length === 0) {
    throw new ApiError('VALIDATION_FAILED', 'Token is required')
  }

  const { data: inv } = await supabaseAdmin
    .from('org_invitations')
    .select('id, email, role, organization_id, expires_at, accepted_at')
    .eq('token_hash', await hashToken(body.token))
    .maybeSingle()

  if (!inv) throw new ApiError('NOT_FOUND', 'Invalid invitation')
  if (inv.accepted_at) throw new ApiError('BAD_REQUEST', 'Invitation already accepted')
  if (new Date(inv.expires_at) < new Date()) {
    throw new ApiError('BAD_REQUEST', 'Invitation expired')
  }

  // Email check: invitation is bound to the invitee's email. Anyone else
  // with the link can't use it. Case-insensitive since auth.users emails
  // are stored normalized but users type them any which way. Email comes
  // from the JWT context (authJwt set it) — saves a getUserById roundtrip.
  const currentEmail = c.get('email')
  if (!currentEmail || currentEmail !== inv.email.toLowerCase()) {
    throw new ApiError('BAD_REQUEST', 'This invitation was sent to a different email')
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
    if (insertErr) throw new ApiError('INTERNAL_ERROR', 'Failed to add member')
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

  // Skip the workspace-creation onboarding for invited users — they are
  // joining an existing workspace, not creating their own. Stamp
  // onboarded_at so the dashboard layout's `!orgId || !onboarded` guard
  // lets them straight in. Survey questions are left null and can be
  // surfaced again on the dashboard later as a dismissible card if we
  // want the segmentation data.
  await supabaseAdmin
    .from('user_profiles')
    .upsert(
      {
        user_id: userId,
        use_case: null,
        role: null,
        onboarded_at: new Date().toISOString(),
      },
      { onConflict: 'user_id', ignoreDuplicates: false },
    )

  // The accepter's Hono context never carries orgId (they just joined),
  // so the generic recordAuditEvent helper would drop the row with a
  // "missing organization_id" warning. Pull the IP from the context but
  // pass the org we just resolved explicitly.
  const ipOnly = auditContextFromHono(c).ipAddress ?? null
  void recordAuditLog(
    {
      organizationId: inv.organization_id,
      userId,
      ipAddress: ipOnly,
    },
    {
      action: 'member.invite_accept',
      resourceType: 'org_invitations',
      resourceId: inv.id,
      metadata: { email: inv.email, role: inv.role },
    },
  )

  return c.json({ success: true, data: { organizationId: inv.organization_id, role: inv.role } })
})

// DELETE /api/v1/invitations/:id — admin cancel (auth required)
invitationsRouter.delete('/:id', authJwt, requireRole('admin'), async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const id = c.req.param('id')

  // Scope the delete to the user's org so admins can't cancel invitations
  // belonging to other orgs.
  const { error, count } = await supabaseAdmin
    .from('org_invitations')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('organization_id', orgId)
    .is('accepted_at', null)

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to cancel invitation')
  if (count === 0) throw new ApiError('NOT_FOUND', 'Invitation not found')

  void recordAuditEvent(c, {
    action: 'member.invite_cancel',
    resourceType: 'org_invitations',
    resourceId: id,
  })

  return c.json({ success: true })
})

// ── /me/pending-invitations — recipient-side endpoints ────────
//
// "What invitations are pending FOR me?" — sourced by matching the
// signed-in user's email to org_invitations.email. Used by:
//   • the dashboard top banner ("Acme Inc. invited you, accept?")
//   • the onboarding pending-step for brand-new signups whose email had
//     a pending invite waiting from someone else.
// Returns the invite id alongside org name + role so the client can
// drive Accept / Decline without ever touching the raw token (token
// stays in the email URL only).

export const meInvitationsRouter = new Hono<JwtContext>()
meInvitationsRouter.use('*', authJwt)

interface PendingInvitationRow {
  id: string
  role: OrgRole | string
  email: string
  expires_at: string
  organizations: { id: string; name: string } | null
}

// GET /api/v1/me/pending-invitations
meInvitationsRouter.get('/', async (c) => {
  const email = c.get('email')
  if (!email) return c.json({ success: true, data: [] })

  const { data, error } = await supabaseAdmin
    .from('org_invitations')
    .select('id, role, email, expires_at, organizations(id, name)')
    .ilike('email', email)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to fetch pending invitations')

  // Shape the join output to a flat list — same pattern as
  // GET /organizations.
  const rows = ((data ?? []) as unknown as PendingInvitationRow[])
    .filter((r) => r.organizations !== null)
    .map((r) => ({
      id: r.id,
      role: r.role,
      orgId: r.organizations!.id,
      orgName: r.organizations!.name,
      expiresAt: r.expires_at,
    }))

  return c.json({ success: true, data: rows })
})

// POST /api/v1/me/pending-invitations/:id/accept — id-based, no token
// required. The server still verifies the email matches so a stolen id
// is useless without auth.
meInvitationsRouter.post('/:id/accept', async (c) => {
  const userId = c.get('userId')
  const email = c.get('email')
  if (!email) throw new ApiError('BAD_REQUEST', 'User has no email')

  const { data: inv } = await supabaseAdmin
    .from('org_invitations')
    .select('id, email, role, organization_id, expires_at, accepted_at')
    .eq('id', c.req.param('id'))
    .maybeSingle()

  if (!inv) throw new ApiError('NOT_FOUND', 'Invalid invitation')
  if (inv.accepted_at) throw new ApiError('BAD_REQUEST', 'Invitation already accepted')
  if (new Date(inv.expires_at) < new Date()) {
    throw new ApiError('BAD_REQUEST', 'Invitation expired')
  }
  if (inv.email.toLowerCase() !== email) {
    throw new ApiError('BAD_REQUEST', 'This invitation was sent to a different email')
  }

  // Idempotent member INSERT — same shape as the token-based path.
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
    })
    if (insertErr) throw new ApiError('INTERNAL_ERROR', 'Failed to add member')
  }

  await supabaseAdmin
    .from('org_invitations')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', inv.id)

  // Stamp onboarded_at — see invitations accept handler comment for why.
  await supabaseAdmin
    .from('user_profiles')
    .upsert(
      {
        user_id: userId,
        use_case: null,
        role: null,
        onboarded_at: new Date().toISOString(),
      },
      { onConflict: 'user_id', ignoreDuplicates: false },
    )

  return c.json({
    success: true,
    data: { organizationId: inv.organization_id, role: inv.role },
  })
})

// DELETE /api/v1/me/pending-invitations/:id — recipient declines.
// Hard delete: once declined, the row is gone. If the admin wants to
// re-invite the user they create a new invitation, which surfaces in
// the dashboard banner again. This matches the user's intent of "after
// I decline, I never see it again unless explicitly re-invited".
meInvitationsRouter.delete('/:id', async (c) => {
  const email = c.get('email')
  if (!email) throw new ApiError('BAD_REQUEST', 'User has no email')

  const { error, count } = await supabaseAdmin
    .from('org_invitations')
    .delete({ count: 'exact' })
    .eq('id', c.req.param('id'))
    .ilike('email', email)
    .is('accepted_at', null)

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to decline invitation')
  if (count === 0) throw new ApiError('NOT_FOUND', 'Invitation not found')
  return c.json({ success: true })
})

// POST /api/v1/invitations/decline — token-based variant for the
// /invite page. Mirrors the existing accept token flow.
invitationsRouter.post('/decline', authJwt, async (c) => {
  const email = c.get('email')
  if (!email) throw new ApiError('BAD_REQUEST', 'User has no email')

  let body: { token?: unknown }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }
  if (typeof body.token !== 'string' || body.token.length === 0) {
    throw new ApiError('VALIDATION_FAILED', 'Token is required')
  }

  const { error, count } = await supabaseAdmin
    .from('org_invitations')
    .delete({ count: 'exact' })
    .eq('token_hash', await hashToken(body.token))
    .ilike('email', email)
    .is('accepted_at', null)

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to decline invitation')
  if (count === 0) throw new ApiError('NOT_FOUND', 'Invitation not found')
  return c.json({ success: true })
})
