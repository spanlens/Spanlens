import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { requireRole } from '../middleware/requireRole.js'
import { supabaseAdmin } from '../lib/db.js'
import { aes256Encrypt } from '../lib/crypto.js'
import { recordAuditEvent } from '../lib/audit-log.js'
import { resetProviderKeyNamesCache, fetchProviderKeyLastUsed } from '../lib/requests-query.js'
import { invalidateProviderKeyCache } from '../lib/provider-key-cache.js'
import { validateOptionalUuid } from '../lib/params.js'
import { ApiError } from '../lib/errors.js'

/**
 * Provider AI keys (OpenAI / Anthropic / Gemini). Under the nested-keys
 * model each provider key belongs to a specific Spanlens (sl_live_*) key,
 * not to the project as a whole. So the API path here keys on `apiKeyId`
 * (the Spanlens key UUID) for both list + create.
 */

export const providerKeysRouter = new Hono<JwtContext>()

providerKeysRouter.use('*', authJwt)

const requireEdit = requireRole('admin', 'editor')

const VALID_PROVIDERS = new Set([
  'openai', 'anthropic', 'gemini', 'azure', 'mistral', 'openrouter',
  'groq', 'deepseek', 'xai', 'cohere',
])

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
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  // apiKeyId is bound into a Postgres UUID column filter — a malformed value
  // (e.g. ?apiKeyId=abc) fails UUID parsing and throws a raw 500. Validate so
  // this dual-auth read surface (MCP/BI tools) gets a clean 400 instead.
  const apiKeyIdFilter = validateOptionalUuid(c.req.query('apiKeyId'), 'apiKeyId')

  let query = supabaseAdmin
    .from('provider_keys')
    .select(SELECT_COLUMNS)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })

  if (apiKeyIdFilter) {
    query = query.eq('api_key_id', apiKeyIdFilter)
  }

  const { data, error } = await query

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to fetch provider keys')

  const rows = data ?? []
  if (rows.length === 0) {
    return c.json({ success: true, data: [] })
  }

  // One query for the whole page, not one per key.
  const lastUsedMap = await fetchProviderKeyLastUsed(
    orgId,
    rows.map((k) => k.id as string),
  )

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
      // `max(created_at)` is already an ISO-8601 'Z' string — the pg client
      // parses timestamptz, so the dashboard (which Date.parse's it) keeps
      // working without a rewrite here.
      const last_used_at = lastUsedMap.get(k.id as string) ?? null
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
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

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
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  if (typeof body.provider !== 'string' || !VALID_PROVIDERS.has(body.provider)) {
    throw new ApiError('VALIDATION_FAILED', 'provider must be one of: openai, anthropic, gemini, azure, mistral, openrouter, groq, deepseek, xai, cohere')
  }
  if (typeof body.key !== 'string' || body.key.trim().length === 0) {
    throw new ApiError('VALIDATION_FAILED', 'key is required')
  }
  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    throw new ApiError('VALIDATION_FAILED', 'name is required')
  }
  if (typeof body.api_key_id !== 'string' || body.api_key_id.trim().length === 0) {
    throw new ApiError('VALIDATION_FAILED', 'api_key_id is required')
  }
  if (!(await assertApiKeyInOrg(body.api_key_id, orgId))) {
    throw new ApiError('FORBIDDEN', 'api_key_id does not belong to this organization')
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
      throw new ApiError('VALIDATION_FAILED', result.error)
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
    throw new ApiError('INTERNAL_ERROR', 'Failed to store provider key')
  }

  // Invalidate the cached org → key-name map so the new key shows up
  // immediately on /requests instead of waiting for the 5-min TTL.
  resetProviderKeyNamesCache()

  // Drop the proxy's cached row for this (Spanlens key, provider). On a
  // fresh registration the cached entry is a *miss* — a customer who
  // fired a proxy call before adding the key would otherwise keep getting
  // NO_PROVIDER_KEY for the negative TTL after the key exists.
  invalidateProviderKeyCache(apiKeyId, body.provider)

  void recordAuditEvent(c, {
    action: 'provider_key.add',
    resourceType: 'provider_keys',
    resourceId: data.id as string,
    metadata: {
      provider: body.provider,
      name: body.name.trim(),
      api_key_id: apiKeyId,
    },
  })

  return c.json({ success: true, data }, 201)
})

// DELETE /api/v1/provider-keys/:id — immediate hard delete.
//
// Matches the api_keys DELETE contract: deletion is instant and permanent
// (the 72-hour pending_deletions grace window was dropped — see apiKeys.ts
// for the rationale). The encrypted provider key is unrecoverable after
// this; if the delete was a mistake the user re-adds the key from the
// provider's dashboard.
//
// Request rows keep the deleted key's id, and the dashboard renders those as
// "(deleted)" rather than blank: fetchProviderKeyNames in
// lib/requests-query.ts null-coalesces ids it can no longer resolve.
providerKeysRouter.delete('/:id', requireEdit, async (c) => {
  const keyId = c.req.param('id')
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  // api_key_id rides along in the snapshot purely so we can address the
  // proxy's row cache after the delete — the cache is keyed by
  // (api_key_id, provider), and both are gone once the row is.
  const { data: snapshot } = await supabaseAdmin
    .from('provider_keys')
    .select('id, provider, name, api_key_id')
    .eq('id', keyId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!snapshot) throw new ApiError('NOT_FOUND', 'Provider key not found')

  const { error } = await supabaseAdmin
    .from('provider_keys')
    .delete()
    .eq('id', keyId)
    .eq('organization_id', orgId)
  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to delete provider key')

  resetProviderKeyNamesCache()

  // Hard delete is immediate and permanent — the proxy must stop presenting
  // this credential upstream immediately too, not 30s from now.
  const deletedApiKeyId = (snapshot as { api_key_id?: string }).api_key_id
  const deletedProvider = (snapshot as { provider?: string }).provider
  if (deletedApiKeyId) invalidateProviderKeyCache(deletedApiKeyId, deletedProvider)

  void recordAuditEvent(c, {
    action: 'provider_key.delete',
    resourceType: 'provider_keys',
    resourceId: keyId,
    metadata: {
      provider: (snapshot as { provider?: string }).provider,
      name: (snapshot as { name?: string }).name,
    },
  })

  return c.json({ success: true })
})

// PATCH /api/v1/provider-keys/:id — rotate (replace encrypted_key) and/or rename.
providerKeysRouter.patch('/:id', requireEdit, async (c) => {
  const keyId = c.req.param('id')
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  let body: { key?: unknown; name?: unknown }
  try {
    body = (await c.req.json()) as { key?: unknown; name?: unknown }
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  const updates: Record<string, unknown> = {}
  if (typeof body.key === 'string' && body.key.trim().length > 0) {
    updates['encrypted_key'] = await aes256Encrypt(body.key.trim())
  }
  if (typeof body.name === 'string' && body.name.trim().length > 0) {
    updates['name'] = body.name.trim()
  }
  if (Object.keys(updates).length === 0) {
    throw new ApiError('BAD_REQUEST', 'No valid fields to update')
  }

  const { data, error } = await supabaseAdmin
    .from('provider_keys')
    .update(updates)
    .eq('id', keyId)
    .eq('organization_id', orgId)
    .select(SELECT_COLUMNS)
    .single()

  if (error || !data) throw new ApiError('NOT_FOUND', 'Provider key not found or access denied')

  resetProviderKeyNamesCache()

  // A rotation replaced encrypted_key: the proxy's cached ciphertext is now
  // the OLD credential and would keep being decrypted and sent upstream for
  // the rest of the TTL. Invalidate unconditionally — a rename is a no-op
  // for the cache but costs one Map delete on a cold path, which is cheaper
  // than a branch that could get the rotation case wrong later.
  // SELECT_COLUMNS already returns api_key_id + provider, so no extra query.
  const cachedApiKeyId = (data as { api_key_id?: string }).api_key_id
  if (cachedApiKeyId) {
    invalidateProviderKeyCache(cachedApiKeyId, data.provider as string)
  }

  // Rotate vs rename are operationally different — rotating exposes a fresh
  // secret to upstream providers, renaming is cosmetic. Surface both action
  // names so the audit log filter can distinguish them.
  const isRotate = 'encrypted_key' in updates
  void recordAuditEvent(c, {
    action: isRotate ? 'provider_key.rotate' : 'provider_key.update',
    resourceType: 'provider_keys',
    resourceId: keyId,
    metadata: {
      provider: data.provider,
      name: data.name,
      fields: Object.keys(updates).filter((k) => k !== 'encrypted_key'),
      rotated: isRotate,
    },
  })

  return c.json({ success: true, data })
})
