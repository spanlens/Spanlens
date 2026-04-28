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
    .select('id, name, plan, allow_overage, overage_cap_multiplier, stale_key_alerts_enabled, stale_key_threshold_days, leak_detection_enabled, created_at, updated_at')
    .eq('id', orgId)
    .single()

  if (error || !data) {
    return c.json({ error: 'Organization not found' }, 404)
  }

  return c.json({ success: true, data })
})

// PATCH /api/v1/organizations/me/security — update notification-only key
// security policies. Both flags are notification-only — no auto-revoke
// happens server-side regardless of these settings (the cron handlers
// short-circuit when disabled).
//
// Body (all optional):
//   stale_key_alerts_enabled : boolean
//   stale_key_threshold_days : 30..365
//   leak_detection_enabled   : boolean
organizationsRouter.patch('/me/security', requireAdmin, async (c) => {
  const userId = c.get('userId')
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let body: {
    stale_key_alerts_enabled?: unknown
    stale_key_threshold_days?: unknown
    leak_detection_enabled?: unknown
  }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const patch: {
    stale_key_alerts_enabled?: boolean
    stale_key_threshold_days?: number
    leak_detection_enabled?: boolean
  } = {}

  if (body.stale_key_alerts_enabled !== undefined) {
    if (typeof body.stale_key_alerts_enabled !== 'boolean') {
      return c.json({ error: 'stale_key_alerts_enabled must be a boolean' }, 400)
    }
    patch.stale_key_alerts_enabled = body.stale_key_alerts_enabled
  }

  if (body.stale_key_threshold_days !== undefined) {
    const n = Number(body.stale_key_threshold_days)
    if (!Number.isInteger(n) || n < 30 || n > 365) {
      return c.json({ error: 'stale_key_threshold_days must be an integer between 30 and 365' }, 400)
    }
    patch.stale_key_threshold_days = n
  }

  if (body.leak_detection_enabled !== undefined) {
    if (typeof body.leak_detection_enabled !== 'boolean') {
      return c.json({ error: 'leak_detection_enabled must be a boolean' }, 400)
    }
    patch.leak_detection_enabled = body.leak_detection_enabled
  }

  if (Object.keys(patch).length === 0) {
    return c.json({ error: 'no fields to update' }, 400)
  }

  const { data, error } = await supabaseAdmin
    .from('organizations')
    .update(patch)
    .eq('id', orgId)
    .select('id, name, plan, allow_overage, overage_cap_multiplier, stale_key_alerts_enabled, stale_key_threshold_days, leak_detection_enabled, created_at, updated_at')
    .single()

  if (error || !data) {
    return c.json({ error: 'Update failed' }, 500)
  }

  await supabaseAdmin.from('audit_logs').insert({
    organization_id: orgId,
    user_id: userId,
    action: 'org.security.update',
    resource_type: 'organization',
    resource_id: orgId,
    metadata: patch,
  })

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
//
// Creates org + admin membership + default project + first API key in a
// single round-trip. The /onboarding flow calls this once the user has
// chosen a workspace name; the API key is returned ONCE (raw, plaintext)
// and only the hash is persisted.
//
// Body (all optional):
//   { name?: string }   — workspace name (1..80 chars, trimmed)
//                          When omitted we fall back to a derived
//                          "<local-part>'s workspace" so legacy callers
//                          (and the welcome experience) still work.
//
// Returns 409 if the user already has a membership — second invocation
// from a refresh/retry should no-op at HTTP level.
organizationsRouter.post('/bootstrap', async (c) => {
  const userId = c.get('userId')

  // Reject if already onboarded.
  const { data: existingMember } = await supabaseAdmin
    .from('org_members')
    .select('organization_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (existingMember) {
    return c.json({ error: 'Already onboarded', organizationId: existingMember.organization_id }, 409)
  }

  // Body parse — body is OPTIONAL on this endpoint (legacy clients send
  // none). Don't 400 on empty/invalid JSON; just fall through to the
  // derived default name.
  let bodyName: string | undefined
  try {
    const raw = (await c.req.json().catch(() => ({}))) as { name?: unknown }
    if (typeof raw.name === 'string') {
      const trimmed = raw.name.trim()
      if (trimmed.length > 0 && trimmed.length <= 80) bodyName = trimmed
    }
  } catch {
    // ignore — empty body is valid here.
  }

  // Resolve workspace name: explicit body wins; otherwise derive from email.
  const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId)
  const workspaceName = bodyName ?? deriveWorkspaceName(userData?.user?.email)

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

  // 3. default project — idempotent: reuse one if it already exists with
  // the same name. Belt-and-braces against the historical "two Default
  // Projects" bug where the legacy onboarding page used to POST /projects
  // *in addition* to the bootstrap call. The old onboarding code is gone
  // now, but this guard means even a stray retry/race won't dup.
  const { data: existingProject } = await supabaseAdmin
    .from('projects')
    .select('id, name, created_at')
    .eq('organization_id', org.id)
    .eq('name', 'Default Project')
    .maybeSingle()

  let project = existingProject
  if (!project) {
    const { data: created, error: projErr } = await supabaseAdmin
      .from('projects')
      .insert({ organization_id: org.id, name: 'Default Project' })
      .select('id, name, created_at')
      .single()
    if (projErr || !created) {
      await rollback()
      return c.json({ error: 'Failed to create default project' }, 500)
    }
    project = created
  }

  // 4. first API key — raw value returned once; we only store the hash.
  // sha256Hex is Web Crypto-based (Edge runtime safe) and ASYNC — must await.
  // (Previously assigned the unawaited Promise to keyHash, which serialised
  // as "[object Promise]" and broke later authentication.)
  const rawKey = `sl_live_${randomHex(32)}`
  const keyHash = await sha256Hex(rawKey)
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
