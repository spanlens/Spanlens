import { supabaseAdmin } from '../lib/db.js'
import { aes256Decrypt } from '../lib/crypto.js'

export interface ResolvedProviderKey {
  /** Decrypted plaintext key — never log or persist. */
  plaintext: string
  /** UUID of the provider_keys row used. Stored on requests.provider_key_id. */
  id: string
}

/**
 * Look up + decrypt the active provider key for a request.
 *
 * Lookup priority:
 *   1. Project-specific key (provider_keys.project_id = projectId, active)
 *   2. Org-level default (provider_keys.project_id IS NULL, active)
 *
 * Returns both plaintext (for upstream Authorization) and the row id (for
 * requests.provider_key_id so the dashboard can show which key was used).
 */
export async function getDecryptedProviderKey(
  organizationId: string,
  projectId: string,
  provider: string,
): Promise<ResolvedProviderKey | null> {
  // 1. Project-specific key
  const { data: projectKey } = await supabaseAdmin
    .from('provider_keys')
    .select('id, encrypted_key')
    .eq('organization_id', organizationId)
    .eq('project_id', projectId)
    .eq('provider', provider)
    .eq('is_active', true)
    .maybeSingle()

  if (projectKey) {
    const decrypted = await aes256Decrypt(projectKey.encrypted_key as string)
    if (decrypted.length > 0) {
      return { plaintext: decrypted, id: projectKey.id as string }
    }
  }

  // 2. Org-level default fallback
  const { data: orgKey } = await supabaseAdmin
    .from('provider_keys')
    .select('id, encrypted_key')
    .eq('organization_id', organizationId)
    .is('project_id', null)
    .eq('provider', provider)
    .eq('is_active', true)
    .maybeSingle()

  if (!orgKey) return null
  const decrypted = await aes256Decrypt(orgKey.encrypted_key as string)
  if (decrypted.length === 0) return null
  return { plaintext: decrypted, id: orgKey.id as string }
}

// Strip hop-by-hop and sensitive headers before forwarding upstream
const STRIP_HEADERS = new Set([
  'authorization',
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
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

// Strip hop-by-hop headers from the upstream response before sending to client
const STRIP_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-encoding', // body already decoded by fetch
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
