import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'
import { aes256Encrypt } from '../lib/crypto.js'

export const providerKeysRouter = new Hono<JwtContext>()

providerKeysRouter.use('*', authJwt)

const VALID_PROVIDERS = new Set(['openai', 'anthropic', 'gemini'])

// GET /api/v1/provider-keys — list keys (never returns plain or encrypted key)
providerKeysRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const { data, error } = await supabaseAdmin
    .from('provider_keys')
    .select('id, provider, name, is_active, created_at, updated_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })

  if (error) return c.json({ error: 'Failed to fetch provider keys' }, 500)

  return c.json({ success: true, data: data ?? [] })
})

// POST /api/v1/provider-keys — add provider key (encrypt before storing)
providerKeysRouter.post('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let body: { provider?: unknown; key?: unknown; name?: unknown }
  try {
    body = await c.req.json() as { provider?: unknown; key?: unknown; name?: unknown }
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

  const encryptedKey = aes256Encrypt(body.key.trim())

  const { data, error } = await supabaseAdmin
    .from('provider_keys')
    .insert({
      organization_id: orgId,
      provider: body.provider,
      name: body.name.trim(),
      encrypted_key: encryptedKey,
    })
    .select('id, provider, name, is_active, created_at, updated_at')
    .single()

  if (error || !data) return c.json({ error: 'Failed to store provider key' }, 500)

  return c.json({ success: true, data }, 201)
})

// DELETE /api/v1/provider-keys/:id — deactivate provider key
providerKeysRouter.delete('/:id', async (c) => {
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
providerKeysRouter.patch('/:id', async (c) => {
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
    updates['encrypted_key'] = aes256Encrypt(body.key.trim())
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
    .select('id, provider, name, is_active, created_at, updated_at')
    .single()

  if (error || !data) return c.json({ error: 'Provider key not found or access denied' }, 404)

  return c.json({ success: true, data })
})
