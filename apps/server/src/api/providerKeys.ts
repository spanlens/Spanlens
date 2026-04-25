import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { requireRole } from '../middleware/requireRole.js'
import { supabaseAdmin } from '../lib/db.js'
import { aes256Encrypt } from '../lib/crypto.js'

export const providerKeysRouter = new Hono<JwtContext>()

providerKeysRouter.use('*', authJwt)

const requireEdit = requireRole('admin', 'editor')

const VALID_PROVIDERS = new Set(['openai', 'anthropic', 'gemini'])

const SELECT_COLUMNS = 'id, provider, name, is_active, project_id, created_at, updated_at'

async function assertProjectInOrg(
  projectId: string,
  orgId: string,
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('organization_id', orgId)
    .maybeSingle()
  return Boolean(data)
}

// GET /api/v1/provider-keys — list keys (never returns plain or encrypted key)
//   Optional ?projectId=xxx to filter to one project's overrides (org-default
//   rows still included — callers can distinguish by project_id === null).
providerKeysRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const projectIdFilter = c.req.query('projectId')

  let query = supabaseAdmin
    .from('provider_keys')
    .select(SELECT_COLUMNS)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })

  if (projectIdFilter) {
    query = query.eq('project_id', projectIdFilter)
  }

  const { data, error } = await query

  if (error) return c.json({ error: 'Failed to fetch provider keys' }, 500)

  return c.json({ success: true, data: data ?? [] })
})

// POST /api/v1/provider-keys — add provider key (encrypt before storing)
//   body.project_id — optional. When provided, the key scopes to that project
//   only. When omitted, the key becomes the org-level default (fallback for
//   all projects without their own override).
providerKeysRouter.post('/', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let body: {
    provider?: unknown
    key?: unknown
    name?: unknown
    project_id?: unknown
  }
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

  let projectId: string | null = null
  if (body.project_id !== undefined && body.project_id !== null) {
    if (typeof body.project_id !== 'string' || body.project_id.trim().length === 0) {
      return c.json({ error: 'project_id must be a non-empty string or null' }, 400)
    }
    if (!(await assertProjectInOrg(body.project_id, orgId))) {
      return c.json({ error: 'project_id does not belong to this organization' }, 403)
    }
    projectId = body.project_id
  }

  const encryptedKey = await aes256Encrypt(body.key.trim())

  const { data, error } = await supabaseAdmin
    .from('provider_keys')
    .insert({
      organization_id: orgId,
      project_id: projectId,
      provider: body.provider,
      name: body.name.trim(),
      encrypted_key: encryptedKey,
    })
    .select(SELECT_COLUMNS)
    .single()

  if (error || !data) {
    // Unique index violation → another active key already exists at this scope
    if (error?.code === '23505') {
      return c.json({
        error: projectId
          ? 'A key for this provider already exists on this project. Revoke it first.'
          : 'A default key for this provider already exists. Revoke it first.',
      }, 409)
    }
    return c.json({ error: 'Failed to store provider key' }, 500)
  }

  return c.json({ success: true, data }, 201)
})

// DELETE /api/v1/provider-keys/:id — deactivate provider key
providerKeysRouter.delete('/:id', requireEdit, async (c) => {
  const keyId = c.req.param('id')
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const { error } = await supabaseAdmin
    .from('provider_keys')
    .update({ is_active: false })
    .eq('id', keyId)
    .eq('organization_id', orgId)

  if (error) return c.json({ error: 'Failed to deactivate provider key' }, 500)

  return c.json({ success: true })
})

// PATCH /api/v1/provider-keys/:id — rotate key (replace encrypted_key)
providerKeysRouter.patch('/:id', requireEdit, async (c) => {
  const keyId = c.req.param('id')
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let body: { key?: unknown; name?: unknown }
  try {
    body = await c.req.json() as { key?: unknown; name?: unknown }
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const updates: Record<string, unknown> = {}
  if (typeof body.key === 'string' && body.key.trim().length > 0) {
    updates['encrypted_key'] = await aes256Encrypt(body.key.trim())
  }
  if (typeof body.name === 'string' && body.name.trim().length > 0) {
    updates['name'] = body.name.trim()
  }
  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400)
  }

  const { data, error } = await supabaseAdmin
    .from('provider_keys')
    .update(updates)
    .eq('id', keyId)
    .eq('organization_id', orgId)
    .select(SELECT_COLUMNS)
    .single()

  if (error || !data) return c.json({ error: 'Provider key not found or access denied' }, 404)

  return c.json({ success: true, data })
})
