import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { requireRole } from '../middleware/requireRole.js'
import { supabaseAdmin } from '../lib/db.js'
import { getOrgClickhouse } from '../lib/clickhouse.js'
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

const VALID_PROVIDERS = new Set(['openai', 'anthropic', 'gemini', 'azure'])

const SELECT_COLUMNS =
  'id, provider, name, is_active, api_key_id, provider_metadata, created_at, updated_at'

/**
 * Normalize a user-supplied Azure resource URL.
 *
 * Accepts forms customers commonly paste from the Azure portal:
 *   "https://my-resource.openai.azure.com"
 *   "https://my-resource.openai.azure.com/"  (trailing slash)
 *   "https://my-resource.services.ai.azure.com"  (Foundry alternate domain)
 *
 * Returns the canonical origin (no trailing slash). Rejects anything
 * that isn't an https URL on one of the two Azure domain families —
 * we don't want to let customers proxy through arbitrary hosts.
 *
 * Exported for unit tests (see __tests__/azure-resource-url.test.ts).
 */
export function normalizeAzureResourceUrl(input: string): { ok: true; url: string } | { ok: false; error: string } {
  let parsed: URL
  try {
    parsed = new URL(input.trim())
  } catch {
    return { ok: false, error: 'resource_url must be a valid URL (e.g. https://my-resource.openai.azure.com)' }
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'resource_url must use https://' }
  }
  const host = parsed.hostname.toLowerCase()
  const isAzureHost =
    host.endsWith('.openai.azure.com') ||
    host.endsWith('.services.ai.azure.com')
  if (!isAzureHost) {
    return {
      ok: false,
      error:
        'resource_url host must end in .openai.azure.com or .services.ai.azure.com',
    }
  }
  return { ok: true, url: parsed.origin }
}

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

  // Bulk-fetch last_used_at for every provider key in ONE ClickHouse query —
  // was N+1 (one supabase round-trip per key) before the migration. Same fix
  // pattern as lib/stale-key-digest.ts.
  const keyIds = rows.map((k) => k.id as string)
  const lastUsedMap = new Map<string, string>()
  const { client: ch } = getOrgClickhouse(orgId)
  try {
    const result = await ch.query({
      query:
        'SELECT provider_key_id AS id, max(created_at) AS last_used_at ' +
        'FROM requests ' +
        'WHERE organization_id = {orgId:UUID} ' +
        '  AND provider_key_id IN {keyIds:Array(UUID)} ' +
        'GROUP BY provider_key_id',
      query_params: { orgId, keyIds },
      format: 'JSONEachRow',
    })
    const lastUsedRows = (await result.json()) as Array<{ id: string; last_used_at: string }>
    for (const row of lastUsedRows) lastUsedMap.set(row.id, row.last_used_at)
  } catch (err) {
    console.error(
      '[providerKeys] last-used lookup failed:',
      err instanceof Error ? err.message : err,
    )
  }

  // leak-scan lookup stays N+1 because the source table is still in Supabase
  // and is low-volume (~1 row per key per scan day). Could be batched too but
  // not on the hot path.
  const enriched = await Promise.all(
    rows.map(async (k) => {
      const { data: lastScan } = await supabaseAdmin
        .from('provider_key_leak_scans')
        .select('scanned_at, result')
        .eq('provider_key_id', k.id)
        .order('scanned_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const rawLastUsed = lastUsedMap.get(k.id as string)
      // ClickHouse DateTime64 prints as 'YYYY-MM-DD HH:MM:SS.fff' — rewrite to
      // ISO with 'T'/'Z' so the dashboard (which Date.parse's it) keeps working.
      const last_used_at = rawLastUsed
        ? rawLastUsed.replace(' ', 'T') + 'Z'
        : null
      return {
        ...k,
        last_used_at,
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
    /** Azure only: { resource_url: 'https://x.openai.azure.com' }. Ignored for other providers. */
    provider_metadata?: unknown
  }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (typeof body.provider !== 'string' || !VALID_PROVIDERS.has(body.provider)) {
    return c.json({ error: 'provider must be one of: openai, anthropic, gemini, azure' }, 400)
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

  // Azure requires a resource_url in provider_metadata. Validate + normalize
  // BEFORE the DB INSERT so error messages are user-friendly — the DB CHECK
  // constraint would otherwise return a generic "violates check" message.
  let providerMetadata: Record<string, unknown> = {}
  if (body.provider === 'azure') {
    const meta = body.provider_metadata as { resource_url?: unknown } | undefined
    if (!meta || typeof meta.resource_url !== 'string') {
      return c.json(
        { error: 'provider_metadata.resource_url is required for azure' },
        400,
      )
    }
    const result = normalizeAzureResourceUrl(meta.resource_url)
    if (!result.ok) {
      return c.json({ error: result.error }, 400)
    }
    providerMetadata = { resource_url: result.url }
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
      provider_metadata: providerMetadata,
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
