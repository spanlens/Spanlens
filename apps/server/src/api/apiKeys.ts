import { Hono } from 'hono'
import { randomBytes, createHash } from 'crypto'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'

export const apiKeysRouter = new Hono<JwtContext>()

apiKeysRouter.use('*', authJwt)

async function projectBelongsToOrg(projectId: string, orgId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('organization_id', orgId)
    .single()
  return data !== null
}

// GET /api/v1/api-keys?projectId=xxx — list keys (no plain key returned)
apiKeysRouter.get('/', async (c) => {
  const projectId = c.req.query('projectId')
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let query = supabaseAdmin
    .from('api_keys')
    .select('id, project_id, name, key_prefix, is_active, last_used_at, created_at')
    .order('created_at', { ascending: false })

  if (projectId) {
    const belongs = await projectBelongsToOrg(projectId, orgId)
    if (!belongs) return c.json({ error: 'Project not found' }, 404)
    query = query.eq('project_id', projectId)
  } else {
    // Return keys for all projects in this org
    const { data: projects } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('organization_id', orgId)
    const projectIds = (projects ?? []).map((p) => p.id as string)
    if (projectIds.length === 0) return c.json({ success: true, data: [] })
    query = query.in('project_id', projectIds)
  }

  const { data, error } = await query
  if (error) return c.json({ error: 'Failed to fetch API keys' }, 500)

  return c.json({ success: true, data: data ?? [] })
})

// POST /api/v1/api-keys — create key; returns plain key ONCE
apiKeysRouter.post('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let body: { name?: unknown; projectId?: unknown }
  try {
    body = await c.req.json() as { name?: unknown; projectId?: unknown }
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    return c.json({ error: 'name is required' }, 400)
  }
  if (typeof body.projectId !== 'string') {
    return c.json({ error: 'projectId is required' }, 400)
  }

  const belongs = await projectBelongsToOrg(body.projectId, orgId)
  if (!belongs) return c.json({ error: 'Project not found' }, 404)

  const rawKey = `sl_live_${randomBytes(24).toString('hex')}`
  const keyHash = createHash('sha256').update(rawKey).digest('hex')
  const keyPrefix = rawKey.slice(0, 15) // "sl_live_" + 7 hex chars

  const { data, error } = await supabaseAdmin
    .from('api_keys')
    .insert({
      project_id: body.projectId,
      name: body.name.trim(),
      key_hash: keyHash,
      key_prefix: keyPrefix,
    })
    .select('id, project_id, name, key_prefix, is_active, created_at')
    .single()

  if (error || !data) return c.json({ error: 'Failed to create API key' }, 500)

  // Return plain key ONCE — never stored, never retrievable again
  return c.json({ success: true, data: { ...data, key: rawKey } }, 201)
})

// DELETE /api/v1/api-keys/:id — deactivate (soft delete)
apiKeysRouter.delete('/:id', async (c) => {
  const keyId = c.req.param('id')
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  // Verify ownership via project → org chain
  const { data: keyRow } = await supabaseAdmin
    .from('api_keys')
    .select('project_id')
    .eq('id', keyId)
    .single()

  if (!keyRow) return c.json({ error: 'API key not found' }, 404)

  const belongs = await projectBelongsToOrg(keyRow.project_id as string, orgId)
  if (!belongs) return c.json({ error: 'Access denied' }, 403)

  const { error } = await supabaseAdmin
    .from('api_keys')
    .update({ is_active: false })
    .eq('id', keyId)

  if (error) return c.json({ error: 'Failed to deactivate API key' }, 500)

  return c.json({ success: true })
})
