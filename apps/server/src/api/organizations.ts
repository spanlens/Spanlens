import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'

export const organizationsRouter = new Hono<JwtContext>()

organizationsRouter.use('*', authJwt)

// GET /api/v1/organizations/me — get the current user's organization
organizationsRouter.get('/me', async (c) => {
  const userId = c.get('userId')

  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('id, name, plan, created_at, updated_at')
    .eq('owner_id', userId)
    .single()

  if (error || !data) {
    return c.json({ error: 'Organization not found' }, 404)
  }

  return c.json({ success: true, data })
})

// POST /api/v1/organizations — create organization (called during onboarding)
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

  // Check if user already has an org
  const { data: existing } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .eq('owner_id', userId)
    .single()

  if (existing) {
    return c.json({ error: 'Organization already exists for this user' }, 409)
  }

  const { data, error } = await supabaseAdmin
    .from('organizations')
    .insert({ name: body.name.trim(), owner_id: userId })
    .select('id, name, plan, created_at, updated_at')
    .single()

  if (error || !data) {
    return c.json({ error: 'Failed to create organization' }, 500)
  }

  // Inject org_id into user JWT app_metadata so the web client can
  // determine org membership without round-tripping to this API on
  // every dashboard page load. The client MUST call refreshSession()
  // after this POST to pick up the updated claims.
  const { error: metaError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    app_metadata: { org_id: data.id },
  })
  if (metaError) {
    // Log but do not fail: org row already exists; metadata will be
    // refreshed the next time it's needed, and the worst case is one
    // extra redirect through /onboarding that self-corrects.
    console.error('Failed to update user app_metadata with org_id', metaError)
  }

  return c.json({ success: true, data }, 201)
})

// PATCH /api/v1/organizations/:id — update org name
organizationsRouter.patch('/:id', async (c) => {
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
