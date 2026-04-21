import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'
import { checkProjectQuota } from '../lib/quota.js'

export const projectsRouter = new Hono<JwtContext>()

projectsRouter.use('*', authJwt)

// GET /api/v1/projects — list all projects for the user's org
projectsRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('id, name, description, created_at, updated_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })

  if (error) return c.json({ error: 'Failed to fetch projects' }, 500)

  return c.json({ success: true, data: data ?? [] })
})

// GET /api/v1/projects/:id
projectsRouter.get('/:id', async (c) => {
  const projectId = c.req.param('id')
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('id, name, description, organization_id, created_at, updated_at')
    .eq('id', projectId)
    .eq('organization_id', orgId)
    .single()

  if (error || !data) return c.json({ error: 'Project not found' }, 404)

  return c.json({ success: true, data })
})

// POST /api/v1/projects
projectsRouter.post('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let body: { name?: unknown; description?: unknown }
  try {
    body = await c.req.json() as { name?: unknown; description?: unknown }
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    return c.json({ error: 'name is required' }, 400)
  }

  // Enforce per-plan project limit (Free 1 / Starter 5 / Team 20 / Enterprise ∞)
  const quota = await checkProjectQuota(orgId)
  if (!quota.allowed) {
    return c.json(
      {
        error: `Project limit reached for ${quota.plan} plan (${quota.used}/${quota.limit}). Upgrade to add more projects.`,
        plan: quota.plan,
        used: quota.used,
        limit: quota.limit,
      },
      403,
    )
  }

  const description =
    typeof body.description === 'string' ? body.description.trim() : null

  const { data, error } = await supabaseAdmin
    .from('projects')
    .insert({ organization_id: orgId, name: body.name.trim(), description })
    .select('id, name, description, created_at, updated_at')
    .single()

  if (error || !data) return c.json({ error: 'Failed to create project' }, 500)

  return c.json({ success: true, data }, 201)
})

// PATCH /api/v1/projects/:id
projectsRouter.patch('/:id', async (c) => {
  const projectId = c.req.param('id')
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let body: { name?: unknown; description?: unknown }
  try {
    body = await c.req.json() as { name?: unknown; description?: unknown }
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const updates: Record<string, unknown> = {}
  if (typeof body.name === 'string' && body.name.trim().length > 0) {
    updates['name'] = body.name.trim()
  }
  if (typeof body.description === 'string') {
    updates['description'] = body.description.trim()
  }
  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400)
  }

  const { data, error } = await supabaseAdmin
    .from('projects')
    .update(updates)
    .eq('id', projectId)
    .eq('organization_id', orgId)
    .select('id, name, description, created_at, updated_at')
    .single()

  if (error || !data) return c.json({ error: 'Project not found or access denied' }, 404)

  return c.json({ success: true, data })
})

// DELETE /api/v1/projects/:id
projectsRouter.delete('/:id', async (c) => {
  const projectId = c.req.param('id')
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const { error } = await supabaseAdmin
    .from('projects')
    .delete()
    .eq('id', projectId)
    .eq('organization_id', orgId)

  if (error) return c.json({ error: 'Failed to delete project' }, 500)

  return c.json({ success: true })
})
