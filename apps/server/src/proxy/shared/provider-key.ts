/**
 * Provider-key resolution gate shared by all 4 proxy handlers
 * (openai / anthropic / gemini / azure).
 *
 * Before this helper, each proxy duplicated the same 7-line block:
 *   const providerKey = await getDecryptedProviderKey(apiKeyId, '<p>')
 *   if (!providerKey) throw new ApiError('NO_PROVIDER_KEY', '...', {provider:'<p>'})
 *
 * Centralising it means a future change to the error message, code, or
 * details shape propagates to every provider in one edit, instead of
 * needing 4 (the failure mode the PR C audit flagged).
 */

import { ApiError } from '../../lib/errors.js'
import { getDecryptedProviderKey, type ResolvedProviderKey } from '../utils.js'

/** Provider tag used in `NO_PROVIDER_KEY` error details and the user-visible
 * message. Matches the keys in provider_keys.provider. */
export type ProxyProvider = 'openai' | 'anthropic' | 'gemini' | 'azure'

const PROVIDER_LABEL: Record<ProxyProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
  azure: 'Azure',
}

/**
 * Resolve and decrypt the active provider key for a Spanlens key id, or
 * throw a typed ApiError ready for the global onError serialiser. Returns
 * the decrypted key + metadata bag verbatim so callers can read
 * provider-specific fields (e.g. Azure's `resource_url`).
 */
export async function assertProviderKey(
  apiKeyId: string,
  provider: ProxyProvider,
): Promise<ResolvedProviderKey> {
  const providerKey = await getDecryptedProviderKey(apiKeyId, provider)
  if (!providerKey) {
    throw new ApiError(
      'NO_PROVIDER_KEY',
      `No active ${PROVIDER_LABEL[provider]} provider key registered for this Spanlens key`,
      { provider },
    )
  }
  return providerKey
}
