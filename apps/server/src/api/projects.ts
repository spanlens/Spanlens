import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { requireRole } from '../middleware/requireRole.js'
import { supabaseAdmin } from '../lib/db.js'
import { checkProjectQuota } from '../lib/quota.js'
import { recordAuditEvent } from '../lib/audit-log.js'
import { ApiError } from '../lib/errors.js'
import { isUuid } from '../lib/params.js'

export const projectsRouter = new Hono<JwtContext>()

projectsRouter.use('*', authJwt)

const requireEdit = requireRole('admin', 'editor')
const requireAdmin = requireRole('admin')

// GET /api/v1/projects — list all projects for the user's org
projectsRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('id, name, description, created_at, updated_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to fetch projects')

  return c.json({ success: true, data: data ?? [] })
})

// GET /api/v1/projects/:id
projectsRouter.get('/:id', async (c) => {
  const projectId = c.req.param('id')
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('id, name, description, organization_id, created_at, updated_at')
    .eq('id', projectId)
    .eq('organization_id', orgId)
    .single()

  if (error || !data) throw new ApiError('NOT_FOUND', 'Project not found')

  return c.json({ success: true, data })
})

// POST /api/v1/projects
projectsRouter.post('/', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  let body: { name?: unknown; description?: unknown }
  try {
    body = await c.req.json() as { name?: unknown; description?: unknown }
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    throw new ApiError('VALIDATION_FAILED', 'name is required')
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

  if (error || !data) throw new ApiError('INTERNAL_ERROR', 'Failed to create project')

  void recordAuditEvent(c, {
    action: 'project.create',
    resourceType: 'projects',
    resourceId: data.id,
    metadata: { name: data.name },
  })

  return c.json({ success: true, data }, 201)
})

// PATCH /api/v1/projects/:id
projectsRouter.patch('/:id', requireEdit, async (c) => {
  const projectId = c.req.param('id')
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  let body: { name?: unknown; description?: unknown }
  try {
    body = await c.req.json() as { name?: unknown; description?: unknown }
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  const updates: Record<string, unknown> = {}
  if (typeof body.name === 'string' && body.name.trim().length > 0) {
    updates['name'] = body.name.trim()
  }
  if (typeof body.description === 'string') {
    updates['description'] = body.description.trim()
  }
  if (Object.keys(updates).length === 0) {
    throw new ApiError('BAD_REQUEST', 'No valid fields to update')
  }

  const { data, error } = await supabaseAdmin
    .from('projects')
    .update(updates)
    .eq('id', projectId)
    .eq('organization_id', orgId)
    .select('id, name, description, created_at, updated_at')
    .single()

  if (error || !data) throw new ApiError('NOT_FOUND', 'Project not found or access denied')

  void recordAuditEvent(c, {
    action: 'project.update',
    resourceType: 'projects',
    resourceId: data.id,
    metadata: { fields: Object.keys(updates) },
  })

  return c.json({ success: true, data })
})

// DELETE /api/v1/projects/:id
projectsRouter.delete('/:id', requireAdmin, async (c) => {
  const projectId = c.req.param('id')
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')
  // Malformed id would hit Postgres as an invalid-uuid error → raw 500.
  // Treat it like a well-formed-but-nonexistent id (same 404 as GET/PATCH).
  if (!isUuid(projectId)) throw new ApiError('NOT_FOUND', 'Project not found')

  const { error } = await supabaseAdmin
    .from('projects')
    .delete()
    .eq('id', projectId)
    .eq('organization_id', orgId)

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to delete project')

  void recordAuditEvent(c, {
    action: 'project.delete',
    resourceType: 'projects',
    resourceId: projectId,
  })

  return c.json({ success: true })
})
