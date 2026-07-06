import { supabaseAdmin } from '../lib/db.js'
import { aes256Decrypt } from '../lib/crypto.js'

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
 */
export async function getDecryptedProviderKey(
  apiKeyId: string,
  provider: string,
): Promise<ResolvedProviderKey | null> {
  const { data } = await supabaseAdmin
    .from('provider_keys')
    .select('id, encrypted_key, provider_metadata')
    .eq('api_key_id', apiKeyId)
    .eq('provider', provider)
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
 * Look up + decrypt a specific provider key by ID (direct lookup — no fallback chain).
 * Used when api_keys.provider_key_id is set (unified key flow).
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
