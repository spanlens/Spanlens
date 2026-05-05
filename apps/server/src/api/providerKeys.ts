import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { requireRole } from '../middleware/requireRole.js'
import { supabaseAdmin } from '../lib/db.js'
import { aes256Encrypt } from '../lib/crypto.js'

/**
 * Provider AI keys (OpenAI / Anthropic / Gemini). Under the nested-keys
 * model each provider key belongs to a specific Spanlens (sl_live_*) key,
 * not to the project as a whole. So the API path here keys on `apiKeyId`
 * (the Spanlens key UUID) for both list + create.
 */

export const providerKeysRouter = new Hono<JwtContext>()

providerKeysRouter.use('*', authJwt)

const requireEdit = requireRole('admin', 'editor')

const VALID_PROVIDERS = new Set(['openai', 'anthropic', 'gemini'])

const SELECT_COLUMNS = 'id, provider, name, is_active, api_key_id, created_at, updated_at'

/** Verify the api_key belongs to a project owned by `orgId`. */
async function assertApiKeyInOrg(apiKeyId: string, orgId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('api_keys')
    .select('id, projects!inner(organization_id)')
    .eq('id', apiKeyId)
    .maybeSingle()
  if (!data) return false
  const project = data.projects as unknown as { organization_id: string } | null
  return project?.organization_id === orgId
}

// GET /api/v1/provider-keys?apiKeyId=xxx — list provider keys under a given
// Spanlens key. Without the filter, lists every provider key in the org
// (used by the requests-page filter dropdown).
//
// Each row is enriched with derived fields for the dashboard:
//   - last_used_at:     MAX(requests.created_at) for this key (null if unused)
//   - last_scan_at:     most-recent provider_key_leak_scans row timestamp
//   - last_scan_result: 'clean' | 'leaked' | 'error' | null
providerKeysRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const apiKeyIdFilter = c.req.query('apiKeyId')

  let query = supabaseAdmin
    .from('provider_keys')
    .select(SELECT_COLUMNS)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })

  if (apiKeyIdFilter) {
    query = query.eq('api_key_id', apiKeyIdFilter)
  }

  const { data, error } = await query

  if (error) return c.json({ error: 'Failed to fetch provider keys' }, 500)

  const rows = data ?? []
  if (rows.length === 0) {
    return c.json({ success: true, data: [] })
  }

  const enriched = await Promise.all(
    rows.map(async (k) => {
      const [{ data: lastReq }, { data: lastScan }] = await Promise.all([
        supabaseAdmin
          .from('requests')
          .select('created_at')
          .eq('provider_key_id', k.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabaseAdmin
          .from('provider_key_leak_scans')
          .select('scanned_at, result')
          .eq('provider_key_id', k.id)
          .order('scanned_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])
      return {
        ...k,
        last_used_at: lastReq?.created_at ?? null,
        last_scan_at: lastScan?.scanned_at ?? null,
        last_scan_result: (lastScan?.result as 'clean' | 'leaked' | 'error' | undefined) ?? null,
      }
    }),
  )

  return c.json({ success: true, data: enriched })
})

// POST /api/v1/provider-keys — register a new provider AI key under a
// Spanlens key. Body: { api_key_id, provider, key, name }.
providerKeysRouter.post('/', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let body: {
    provider?: unknown
    key?: unknown
    name?: unknown
    api_key_id?: unknown
  }
  try {
    body = (await c.req.json()) as typeof body
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
  if (typeof body.api_key_id !== 'string' || body.api_key_id.trim().length === 0) {
    return c.json({ error: 'api_key_id is required' }, 400)
  }
  if (!(await assertApiKeyInOrg(body.api_key_id, orgId))) {
    return c.json({ error: 'api_key_id does not belong to this organization' }, 403)
  }

  const apiKeyId = body.api_key_id
  const encryptedKey = await aes256Encrypt(body.key.trim())

  const { data, error } = await supabaseAdmin
    .from('provider_keys')
    .insert({
      organization_id: orgId,
      api_key_id: apiKeyId,
      provider: body.provider,
      name: body.name.trim(),
      encrypted_key: encryptedKey,
    })
    .select(SELECT_COLUMNS)
    .single()

  if (error || !data) {
    if (error?.code === '23505') {
      return c.json(
        {
          error:
            'An active key for this provider already exists on this Spanlens key. Revoke it first.',
        },
        409,
      )
    }
    return c.json({ error: 'Failed to store provider key' }, 500)
  }

  return c.json({ success: true, data }, 201)
})

// DELETE /api/v1/provider-keys/:id — deactivate provider key (soft delete).
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

// PATCH /api/v1/provider-keys/:id — rotate (replace encrypted_key) and/or rename.
providerKeysRouter.patch('/:id', requireEdit, async (c) => {
  const keyId = c.req.param('id')
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let body: { key?: unknown; name?: unknown }
  try {
    body = (await c.req.json()) as { key?: unknown; name?: unknown }
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
