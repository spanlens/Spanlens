import { supabaseAdmin } from '../lib/db.js'
import { aes256Decrypt } from '../lib/crypto.js'
import { loadProviderKeyRow } from '../lib/provider-key-cache.js'

export interface ResolvedProviderKey {
  /** Decrypted plaintext key — never log or persist. */
  plaintext: string
  /** UUID of the provider_keys row used. Stored on requests.provider_key_id. */
  id: string
  /**
   * Provider-specific config. For 'azure': { resource_url: 'https://x.openai.azure.com' }.
   * For openai/anthropic/gemini this is `{}` (column has DEFAULT '{}' in DB).
   * Type is `Record<string, unknown>` because the shape varies per provider —
   * each proxy is responsible for narrowing what it needs.
   */
  metadata: Record<string, unknown>
}

/**
 * Look up + decrypt the active provider key for a Spanlens key + provider.
 *
 * Under the nested-keys model (migration 20260505080000), each Spanlens
 * (sl_live_*) key owns its own set of provider AI keys. The proxy
 * receives the Spanlens key's id from authApiKey + the provider from the
 * URL path, then resolves them here.
 *
 * Returns plaintext (for upstream Authorization), the row id (for
 * requests.provider_key_id so the dashboard can show which key was used),
 * and provider_metadata (e.g. Azure resource_url).
 *
 * P3.2: the row lookup goes through lib/provider-key-cache.ts (30s TTL,
 * in-flight coalescing) so this is no longer a Supabase round-trip on
 * every proxied call. Only the **ciphertext** is cached — decryption
 * still happens here, on every request, so no decrypted provider
 * credential is ever held in process memory beyond the request that uses
 * it (CLAUDE.md "보안 규칙" rule 3). Do not "optimise" that by caching
 * the ResolvedProviderKey: aes256Decrypt is microseconds, the round-trip
 * we removed was tens of milliseconds, and the plaintext is the only
 * part an attacker could not already read out of the database.
 *
 * Note the empty-plaintext guard below (Known Gotcha #5) keeps working
 * with the cache in place: a wrong ENCRYPTION_KEY makes the decrypt fail
 * on every request rather than being remembered as a success.
 */
export async function getDecryptedProviderKey(
  apiKeyId: string,
  provider: string,
): Promise<ResolvedProviderKey | null> {
  const row = await loadProviderKeyRow(apiKeyId, provider)

  if (!row) return null
  const decrypted = await aes256Decrypt(row.encryptedKey)
  if (decrypted.length === 0) return null
  return {
    plaintext: decrypted,
    id: row.id,
    metadata: row.metadata,
  }
}

/**
 * Look up + decrypt a specific provider key by ID (direct lookup — no fallback chain).
 * Used when api_keys.provider_key_id is set (unified key flow).
 *
 * Deliberately NOT cached, unlike getDecryptedProviderKey above. Its only
 * caller is the replay-run handler in api/requests.ts (`POST
 * /api/v1/requests/:id/replay/run`), which is a human clicking "replay" in
 * the dashboard behind requireRole('admin','editor') — one lookup per
 * click, against a *historical* provider_key_id read off an old request
 * row. Caching it would add an invalidation surface (this lookup is keyed
 * by row id + org, so it needs its own key space) to save a round-trip
 * nobody is waiting on in a loop. If a future caller puts this on a hot
 * path, cache it then — and wire it into the same invalidation sites.
 */
export async function getDecryptedProviderKeyById(
  keyId: string,
  organizationId: string,
): Promise<ResolvedProviderKey | null> {
  const { data } = await supabaseAdmin
    .from('provider_keys')
    .select('id, encrypted_key, provider_metadata')
    .eq('id', keyId)
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .maybeSingle()

  if (!data) return null
  const decrypted = await aes256Decrypt(data.encrypted_key as string)
  if (decrypted.length === 0) return null
  return {
    plaintext: decrypted,
    id: data.id as string,
    metadata: (data.provider_metadata as Record<string, unknown> | null) ?? {},
  }
}

/**
 * Returns whether injection blocking is enabled for a project.
 * Called only when injection flags are detected — zero overhead for clean requests.
 */
export async function isBlockingEnabled(projectId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('projects')
    .select('security_block_enabled')
    .eq('id', projectId)
    .single()
  return data?.security_block_enabled === true
}

// Strip hop-by-hop and sensitive headers before forwarding upstream.
// content-length is stripped because the proxy may modify the body
// (e.g. inject stream_options) so the original length is wrong.
// Node.js undici (unlike Cloudflare Workers fetch) throws on mismatch.
// Let fetch recalculate content-length from the actual body.
//
// authorization / x-api-key / x-goog-api-key are ALL Spanlens key transports
// accepted by authApiKey (Bearer, OpenAI-style, Gemini-style). They carry the
// caller's sl_live_* key and must never reach the upstream provider — each
// proxy re-adds the real provider credential via `overrides`, which is applied
// after this strip. Missing x-api-key/x-goog-api-key here leaks the Spanlens
// key to OpenAI/Google on every request that authenticates via those headers.
const STRIP_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'x-goog-api-key',
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-length',
  'te',
  'upgrade',
  'proxy-authorization',
  'proxy-connection',
])

// Any header starting with one of these prefixes is stripped — these are
// Spanlens-internal metadata and must never reach the upstream provider.
const STRIP_PREFIXES = ['x-spanlens-']

export function buildUpstreamHeaders(
  incoming: Headers,
  overrides: Record<string, string>,
): Headers {
  const out = new Headers()
  incoming.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (STRIP_HEADERS.has(lower)) return
    if (STRIP_PREFIXES.some((p) => lower.startsWith(p))) return
    out.set(key, value)
  })
  for (const [k, v] of Object.entries(overrides)) {
    out.set(k, v)
  }
  return out
}

// Strip hop-by-hop headers from the upstream response before sending to client.
// content-length is stripped alongside content-encoding: undici transparently
// decompresses gzip/br responses but leaves the ORIGINAL (compressed)
// content-length on the headers. Forwarding that stale length makes Node
// truncate the (larger) decoded body to the compressed byte count, so the
// client receives a cut-off JSON payload. Let the runtime recompute the length
// from the actual body we send.
const STRIP_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-encoding', // body already decoded by fetch
  'content-length', // stale (compressed) length after fetch decodes the body
  'te',
])

export function buildDownstreamHeaders(upstream: Headers): Headers {
  const out = new Headers()
  upstream.forEach((value, key) => {
    if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
      out.set(key, value)
    }
  })
  return out
}
