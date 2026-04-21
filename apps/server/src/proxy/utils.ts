import { supabaseAdmin } from '../lib/db.js'
import { aes256Decrypt } from '../lib/crypto.js'

export async function getDecryptedProviderKey(
  organizationId: string,
  provider: string,
): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('provider_keys')
    .select('encrypted_key')
    .eq('organization_id', organizationId)
    .eq('provider', provider)
    .eq('is_active', true)
    .limit(1)
    .single()

  if (!data) return null
  const decrypted = await aes256Decrypt(data.encrypted_key as string)
  return decrypted.length > 0 ? decrypted : null
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

export function buildUpstreamHeaders(
  incoming: Headers,
  overrides: Record<string, string>,
): Headers {
  const out = new Headers()
  incoming.forEach((value, key) => {
    if (!STRIP_HEADERS.has(key.toLowerCase())) {
      out.set(key, value)
    }
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
