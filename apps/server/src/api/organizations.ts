import { Hono } from 'hono'
import { authJwt, type JwtContext, type OrgRole } from '../middleware/authJwt.js'
import { requireRole } from '../middleware/requireRole.js'
import { supabaseAdmin } from '../lib/db.js'
import { randomHex, sha256Hex } from '../lib/crypto.js'

export const organizationsRouter = new Hono<JwtContext>()

organizationsRouter.use('*', authJwt)

const requireAdmin = requireRole('admin')

/**
 * Derive a sensible default workspace name from the user's email.
 *   "alice@acme.io"        → "alice's workspace"
 *   "ops+prod@acme.io"     → "ops+prod's workspace"
 *   "weird" (no @)         → "My workspace"
 */
function deriveWorkspaceName(email: string | null | undefined): string {
  if (!email) return 'My workspace'
  const local = email.split('@')[0]?.trim()
  if (!local) return 'My workspace'
  return `${local}'s workspace`
}

// GET /api/v1/organizations — list all workspaces the current user is a
// member of. Powers the sidebar workspace switcher.
organizationsRouter.get('/', async (c) => {
  const userId = c.get('userId')

  const { data, error } = await supabaseAdmin
    .from('org_members')
    .select('role, organization_id, organizations(id, name, plan, created_at)')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (error) return c.json({ error: 'Failed to fetch workspaces' }, 500)

  // Shape the join output so the client sees a flat list with role attached.
  interface Row {
    role: OrgRole | string
    organizations: { id: string; name: string; plan: string; created_at: string } | null
  }
  const rows = ((data ?? []) as unknown as Row[])
    .filter((r) => r.organizations !== null)
    .map((r) => ({
      id: r.organizations!.id,
      name: r.organizations!.name,
      plan: r.organizations!.plan,
      role: r.role as OrgRole,
      createdAt: r.organizations!.created_at,
    }))

  return c.json({ success: true, data: rows })
})

// GET /api/v1/organizations/me — get the current user's organization
// Resolves via org_members (post-multi-user migration). Previously keyed
// on owner_id — that broke invited members who aren't owners.
organizationsRouter.get('/me', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('id, name, plan, allow_overage, overage_cap_multiplier, created_at, updated_at')
    .eq('id', orgId)
    .single()

  if (error || !data) {
    return c.json({ error: 'Organization not found' }, 404)
  }

  return c.json({ success: true, data })
})

// PATCH /api/v1/organizations/me/overage — update overage policy
// Body: { allow_overage?: boolean, overage_cap_multiplier?: number (1-100) }
organizationsRouter.patch('/me/overage', requireAdmin, async (c) => {
  const userId = c.get('userId')

  let body: { allow_overage?: unknown; overage_cap_multiplier?: unknown }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const patch: { allow_overage?: boolean; overage_cap_multiplier?: number } = {}

  if (body.allow_overage !== undefined) {
    if (typeof body.allow_overage !== 'boolean') {
      return c.json({ error: 'allow_overage must be a boolean' }, 400)
    }
    patch.allow_overage = body.allow_overage
  }

  if (body.overage_cap_multiplier !== undefined) {
    const n = Number(body.overage_cap_multiplier)
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      return c.json({ error: 'overage_cap_multiplier must be an integer between 1 and 100' }, 400)
    }
    patch.overage_cap_multiplier = n
  }

  if (Object.keys(patch).length === 0) {
    return c.json({ error: 'no fields to update' }, 400)
  }

  const { data, error } = await supabaseAdmin
    .from('organizations')
    .update(patch)
    .eq('owner_id', userId)
    .select('id, name, plan, allow_overage, overage_cap_multiplier')
    .single()

  if (error || !data) {
    return c.json({ error: 'Organization not found or update failed' }, 404)
  }

  return c.json({ success: true, data })
})

// POST /api/v1/organizations/bootstrap — one-shot workspace setup for new users.
// Creates org + default project + first API key in a single round-trip so the
// signup page can drop users straight into the dashboard with a working key.
// If the user already has an org, returns 409 — the client should treat that
// as "already onboarded" and just navigate to the dashboard.
organizationsRouter.post('/bootstrap', async (c) => {
  const userId = c.get('userId')

  // Reject if already onboarded. Covers the retry/refresh case where signup
  // ran once and hit this endpoint — second call should no-op at HTTP level.
  const { data: existingMember } = await supabaseAdmin
    .from('org_members')
    .select('organization_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (existingMember) {
    return c.json({ error: 'Already onboarded', organizationId: existingMember.organization_id }, 409)
  }

  // Pull the user's email for the auto-generated workspace name.
  const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId)
  const workspaceName = deriveWorkspaceName(userData?.user?.email)

  // 1. organization
  const { data: org, error: orgErr } = await supabaseAdmin
    .from('organizations')
    .insert({ name: workspaceName, owner_id: userId })
    .select('id, name, plan, created_at, updated_at')
    .single()
  if (orgErr || !org) return c.json({ error: 'Failed to create organization' }, 500)

  // Rollback helper — on any later failure, undo the org + anything downstream.
  const rollback = async () => {
    await supabaseAdmin.from('organizations').delete().eq('id', org.id)
  }

  // 2. org_members (creator becomes admin)
  const { error: memberErr } = await supabaseAdmin
    .from('org_members')
    .insert({ organization_id: org.id, user_id: userId, role: 'admin' })
  if (memberErr) {
    await rollback()
    return c.json({ error: 'Failed to create org membership' }, 500)
  }

  // 3. default project
  const { data: project, error: projErr } = await supabaseAdmin
    .from('projects')
    .insert({ organization_id: org.id, name: 'Default Project' })
    .select('id, name, created_at')
    .single()
  if (projErr || !project) {
    await rollback()
    return c.json({ error: 'Failed to create default project' }, 500)
  }

  // 4. first API key — raw value returned once; we only store the hash.
  const rawKey = `sl_live_${randomHex(32)}`
  const keyHash = sha256Hex(rawKey)
  const { error: keyErr } = await supabaseAdmin.from('api_keys').insert({
    project_id: project.id,
    name: 'Default key',
    key_hash: keyHash,
    key_prefix: rawKey.slice(0, 12),
    is_active: true,
  })
  if (keyErr) {
    await rollback()
    return c.json({ error: 'Failed to create API key' }, 500)
  }

  return c.json({
    success: true,
    data: {
      organization: org,
      project,
      apiKey: rawKey, // raw value — shown once on the welcome screen
    },
  }, 201)
})

// POST /api/v1/organizations — create an additional workspace.
// `bootstrap` handles the signup-time auto-setup (idempotent, rejects repeats);
// this endpoint is for users who want a second (third, …) workspace later,
// e.g. a consultant separating per-client work. Creator becomes admin and a
// Default Project is spun up so the new workspace isn't empty. No API key
// is auto-generated — the user creates those explicitly from /projects.
organizationsRouter.post('/', async (c) => {
  const userId = c.get('userId')

  let body: { name?: unknown }
  try {
    body = await c.req.json() as { name?: unknown }
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    return c.json({ error: 'name is required' }, 400)
  }

  const { data: org, error } = await supabaseAdmin
    .from('organizations')
    .insert({ name: body.name.trim(), owner_id: userId })
    .select('id, name, plan, created_at, updated_at')
    .single()

  if (error || !org) return c.json({ error: 'Failed to create workspace' }, 500)

  const rollback = async () => {
    await supabaseAdmin.from('organizations').delete().eq('id', org.id)
  }

  const { error: memberError } = await supabaseAdmin
    .from('org_members')
    .insert({ organization_id: org.id, user_id: userId, role: 'admin' })
  if (memberError) {
    await rollback()
    return c.json({ error: 'Failed to create workspace membership' }, 500)
  }

  // Default project so the new workspace opens to something usable rather
  // than an empty projects list.
  const { error: projErr } = await supabaseAdmin
    .from('projects')
    .insert({ organization_id: org.id, name: 'Default Project' })
  if (projErr) {
    await rollback()
    return c.json({ error: 'Failed to create default project' }, 500)
  }

  return c.json({ success: true, data: org }, 201)
})

// PATCH /api/v1/organizations/:id — update org name
organizationsRouter.patch('/:id', requireAdmin, async (c) => {
  const userId = c.get('userId')
  const orgId = c.req.param('id')

  let body: { name?: unknown }
  try {
    body = await c.req.json() as { name?: unknown }
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    return c.json({ error: 'name is required' }, 400)
  }

  const { data, error } = await supabaseAdmin
    .from('organizations')
    .update({ name: body.name.trim() })
    .eq('id', orgId)
    .eq('owner_id', userId)
    .select('id, name, plan, created_at, updated_at')
    .single()

  if (error || !data) {
    return c.json({ error: 'Organization not found or access denied' }, 404)
  }

  return c.json({ success: true, data })
})
