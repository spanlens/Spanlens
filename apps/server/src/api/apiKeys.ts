import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { requireRole } from '../middleware/requireRole.js'
import { supabaseAdmin } from '../lib/db.js'
import { randomHex, sha256Hex, aes256Encrypt } from '../lib/crypto.js'

export const apiKeysRouter = new Hono<JwtContext>()

apiKeysRouter.use('*', authJwt)

const requireEdit = requireRole('admin', 'editor')

const VALID_PROVIDERS = new Set(['openai', 'anthropic', 'gemini'])

async function projectBelongsToOrg(projectId: string, orgId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('organization_id', orgId)
    .single()
  return data !== null
}

// GET /api/v1/api-keys?projectId=xxx — list keys with provider info
apiKeysRouter.get('/', async (c) => {
  const projectId = c.req.query('projectId')
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let query = supabaseAdmin
    .from('api_keys')
    .select('id, project_id, name, key_prefix, is_active, last_used_at, created_at, provider_key_id, provider_keys(provider)')
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

  const rows = (data ?? []).map((row) => ({
    id: row.id,
    project_id: row.project_id,
    name: row.name,
    key_prefix: row.key_prefix,
    is_active: row.is_active,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
    provider_key_id: row.provider_key_id ?? null,
    provider: (row.provider_keys as unknown as { provider: string } | null)?.provider ?? null,
  }))

  return c.json({ success: true, data: rows })
})

// POST /api/v1/api-keys/issue — create provider key + linked Spanlens key in one step.
// User provides their real AI API key; we store it encrypted and return sl_live_xxx.
apiKeysRouter.post('/issue', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let body: { provider?: unknown; key?: unknown; name?: unknown; projectId?: unknown }
  try {
    body = await c.req.json() as typeof body
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (typeof body.provider !== 'string' || !VALID_PROVIDERS.has(body.provider)) {
    return c.json({ error: 'provider must be one of: openai, anthropic, gemini' }, 400)
  }
  if (typeof body.key !== 'string' || body.key.trim().length === 0) {
    return c.json({ error: 'key is required' }, 400)
  }
  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    return c.json({ error: 'name is required' }, 400)
  }
  if (typeof body.projectId !== 'string') {
    return c.json({ error: 'projectId is required' }, 400)
  }

  const belongs = await projectBelongsToOrg(body.projectId, orgId)
  if (!belongs) return c.json({ error: 'Project not found' }, 404)

  const encryptedKey = await aes256Encrypt(body.key.trim())

  const { data: pk, error: pkErr } = await supabaseAdmin
    .from('provider_keys')
    .insert({
      organization_id: orgId,
      project_id: body.projectId,
      provider: body.provider,
      name: body.name.trim(),
      encrypted_key: encryptedKey,
      is_active: true,
    })
    .select('id')
    .single()

  if (pkErr || !pk) return c.json({ error: 'Failed to create provider key' }, 500)

  const rawKey = `sl_live_${randomHex(24)}`
  const keyHash = await sha256Hex(rawKey)
  const keyPrefix = rawKey.slice(0, 15)

  const { data: ak, error: akErr } = await supabaseAdmin
    .from('api_keys')
    .insert({
      project_id: body.projectId,
      name: body.name.trim(),
      key_hash: keyHash,
      key_prefix: keyPrefix,
      provider_key_id: pk.id,
    })
    .select('id, project_id, name, key_prefix, is_active, created_at')
    .single()

  if (akErr || !ak) {
    await supabaseAdmin.from('provider_keys').delete().eq('id', pk.id)
    return c.json({ error: 'Failed to create API key' }, 500)
  }

  return c.json({
    success: true,
    data: {
      ...ak,
      key: rawKey,
      provider: body.provider,
      provider_key_id: pk.id,
    },
  }, 201)
})

// PATCH /api/v1/api-keys/:id — toggle is_active
apiKeysRouter.patch('/:id', requireEdit, async (c) => {
  const keyId = c.req.param('id')
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let body: { is_active?: unknown }
  try {
    body = await c.req.json() as typeof body
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

// PATCH /api/v1/api-keys/:id/rotate-ai-key — replace the linked AI provider key
apiKeysRouter.patch('/:id/rotate-ai-key', requireEdit, async (c) => {
  const keyId = c.req.param('id')
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let body: { key?: unknown }
  try {
    body = await c.req.json() as typeof body
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  if (typeof body.key !== 'string' || body.key.trim().length === 0) {
    return c.json({ error: 'key is required' }, 400)
  }

  const { data: keyRow } = await supabaseAdmin
    .from('api_keys')
    .select('project_id, provider_key_id')
    .eq('id', keyId)
    .single()
  if (!keyRow) return c.json({ error: 'API key not found' }, 404)
  if (!keyRow.provider_key_id) {
    return c.json({ error: 'This key has no linked AI provider key' }, 400)
  }

  const belongs = await projectBelongsToOrg(keyRow.project_id as string, orgId)
  if (!belongs) return c.json({ error: 'Access denied' }, 403)

  const encrypted = await aes256Encrypt(body.key.trim())
  const { error } = await supabaseAdmin
    .from('provider_keys')
    .update({ encrypted_key: encrypted })
    .eq('id', keyRow.provider_key_id as string)
  if (error) return c.json({ error: 'Failed to rotate AI key' }, 500)

  return c.json({ success: true })
})

// DELETE /api/v1/api-keys/:id — hard delete api_key + linked provider_key
apiKeysRouter.delete('/:id', requireEdit, async (c) => {
  const keyId = c.req.param('id')
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const { data: keyRow } = await supabaseAdmin
    .from('api_keys')
    .select('project_id, provider_key_id')
    .eq('id', keyId)
    .single()
  if (!keyRow) return c.json({ error: 'API key not found' }, 404)

  const belongs = await projectBelongsToOrg(keyRow.project_id as string, orgId)
  if (!belongs) return c.json({ error: 'Access denied' }, 403)

  const { error: akErr } = await supabaseAdmin.from('api_keys').delete().eq('id', keyId)
  if (akErr) return c.json({ error: 'Failed to delete API key' }, 500)

  if (keyRow.provider_key_id) {
    await supabaseAdmin.from('provider_keys').delete().eq('id', keyRow.provider_key_id as string)
  }

  return c.json({ success: true })
})
