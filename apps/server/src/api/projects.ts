import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'

export const projectsRouter = new Hono<JwtContext>()

projectsRouter.use('*', authJwt)

async function getOrgId(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .eq('owner_id', userId)
    .single()
  return data?.id ?? null
}

// GET /api/v1/projects — list all projects for the user's org
projectsRouter.get('/', async (c) => {
  const userId = c.get('userId')
  const orgId = await getOrgId(userId)
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
  const userId = c.get('userId')
  const projectId = c.req.param('id')
  const orgId = await getOrgId(userId)
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
  const userId = c.get('userId')
  const orgId = await getOrgId(userId)
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
  const userId = c.get('userId')
  const projectId = c.req.param('id')
  const orgId = await getOrgId(userId)
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
  const userId = c.get('userId')
  const projectId = c.req.param('id')
  const orgId = await getOrgId(userId)
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const { error } = await supabaseAdmin
    .from('projects')
    .delete()
    .eq('id', projectId)
    .eq('organization_id', orgId)

  if (error) return c.json({ error: 'Failed to delete project' }, 500)

  return c.json({ success: true })
})
