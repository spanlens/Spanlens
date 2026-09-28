/**
 * Anthropic client helper — pre-configured for the Spanlens proxy.
 *
 *   import { createAnthropic } from '@spanlens/sdk/anthropic'
 *   const anthropic = createAnthropic()
 *
 * `@anthropic-ai/sdk` is a peer dependency.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { ClientOptions } from '@anthropic-ai/sdk'
import { readEnv, resolveProxyBaseUrl } from '../env.js'

// X-Spanlens-* request-header helpers. Canonical implementations live in
// ./_headers.ts — re-exported here so `@spanlens/sdk/anthropic` keeps its
// single-import ergonomics (`import { createAnthropic, withUser } from ...`).
export {
  PROMPT_VERSION_HEADER,
  USER_HEADER,
  SESSION_HEADER,
  LOG_BODY_HEADER,
  CACHE_HEADER,
  CACHE_DEFAULT_TTL_SECONDS,
  CACHE_MAX_TTL_SECONDS,
  withPromptVersion,
  withUser,
  withSession,
  withLogBody,
  withCache,
  cacheHeaderValue,
} from './_headers.js'

/**
 * Hosted Spanlens proxy URL. Self-hosted deployments set `SPANLENS_BASE_URL`
 * (the server origin) or pass `baseURL`.
 */
export const DEFAULT_SPANLENS_ANTHROPIC_PROXY =
  'https://api.spanlens.io/proxy/anthropic'

export function createAnthropic(options: ClientOptions = {}): Anthropic {
  const apiKey = options.apiKey ?? readEnv('SPANLENS_API_KEY')

  if (!apiKey) {
    throw new Error(
      '[spanlens] SPANLENS_API_KEY is not set. Pass { apiKey } to createAnthropic() ' +
        'or add SPANLENS_API_KEY to your environment.',
    )
  }

  return new Anthropic({
    ...options,
    apiKey,
    baseURL: options.baseURL ?? resolveProxyBaseUrl(DEFAULT_SPANLENS_ANTHROPIC_PROXY),
  })
}
