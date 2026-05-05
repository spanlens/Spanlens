import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { requireRole } from '../middleware/requireRole.js'
import { supabaseAdmin } from '../lib/db.js'
import { randomHex, sha256Hex } from '../lib/crypto.js'

/**
 * Spanlens (sl_live_*) keys — under the unified-keys model these are
 * project-scoped and provider-agnostic. Provider AI keys live in their own
 * resource (`/api/v1/provider-keys`) and are looked up at proxy time by
 * `(project_id, provider)` from the request URL path.
 *
 * No more `api_keys.provider_key_id`. Issuing a key here just creates a
 * project credential the customer plugs into `SPANLENS_API_KEY` — that
 * single key can call any provider registered on the project.
 */

export const apiKeysRouter = new Hono<JwtContext>()

apiKeysRouter.use('*', authJwt)

const requireEdit = requireRole('admin', 'editor')

async function projectBelongsToOrg(projectId: string, orgId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('organization_id', orgId)
    .single()
  return data !== null
}

// GET /api/v1/api-keys?projectId=xxx — list Spanlens keys for a project
// (or all keys across the org's projects when projectId is omitted).
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

// POST /api/v1/api-keys/issue — mint a new sl_live_* for a project.
// Body: { name, projectId }. No provider, no AI key — those live in the
// /api/v1/provider-keys resource and are resolved at proxy time.
apiKeysRouter.post('/issue', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let body: { name?: unknown; projectId?: unknown }
  try {
    body = (await c.req.json()) as typeof body
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

  const rawKey = `sl_live_${randomHex(24)}`
  const keyHash = await sha256Hex(rawKey)
  const keyPrefix = rawKey.slice(0, 15)

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

  return c.json(
    {
      success: true,
      data: {
        ...data,
        key: rawKey, // shown to the user once — never persisted in plaintext
      },
    },
    201,
  )
})

// PATCH /api/v1/api-keys/:id — toggle is_active
apiKeysRouter.patch('/:id', requireEdit, async (c) => {
  const keyId = c.req.param('id')
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let body: { is_active?: unknown }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  if (typeof body.is_active !== 'boolean') {
    return c.json({ error: 'is_active (boolean) is required' }, 400)
  }

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
    .update({ is_active: body.is_active })
    .eq('id', keyId)
  if (error) return c.json({ error: 'Failed to update API key' }, 500)

  return c.json({ success: true })
})

// DELETE /api/v1/api-keys/:id — hard delete. No more linked provider_keys
// to clean up: provider AI keys are independent resources now.
apiKeysRouter.delete('/:id', requireEdit, async (c) => {
  const keyId = c.req.param('id')
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const { data: keyRow } = await supabaseAdmin
    .from('api_keys')
    .select('project_id')
    .eq('id', keyId)
    .single()
  if (!keyRow) return c.json({ error: 'API key not found' }, 404)

  const belongs = await projectBelongsToOrg(keyRow.project_id as string, orgId)
  if (!belongs) return c.json({ error: 'Access denied' }, 403)

  const { error } = await supabaseAdmin.from('api_keys').delete().eq('id', keyId)
  if (error) return c.json({ error: 'Failed to delete API key' }, 500)

  return c.json({ success: true })
})
