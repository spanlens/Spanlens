/**
 * OpenAI client helper — pre-configured for the Spanlens proxy.
 *
 * Replaces:
 *   const openai = new OpenAI({
 *     apiKey: process.env.SPANLENS_API_KEY,
 *     baseURL: 'https://api.spanlens.io/proxy/openai/v1',
 *   })
 *
 * With:
 *   import { createOpenAI } from '@spanlens/sdk/openai'
 *   const openai = createOpenAI()
 *
 * The returned client behaves identically to a normal `new OpenAI(...)` —
 * only the `baseURL` is redirected to the Spanlens proxy (which records
 * the call in /requests, enforces quota, etc.) and `apiKey` defaults to
 * `process.env.SPANLENS_API_KEY`.
 *
 * `openai` is a peer dependency — install it alongside this SDK.
 */

import OpenAI from 'openai'
import type { ClientOptions } from 'openai'
import { readEnv, resolveProxyBaseUrl } from '../env.js'

/**
 * Hosted Spanlens proxy URL. Self-hosted deployments set `SPANLENS_BASE_URL`
 * (the server origin) or pass `baseURL`.
 */
export const DEFAULT_SPANLENS_OPENAI_PROXY =
  'https://api.spanlens.io/proxy/openai/v1'

// X-Spanlens-* request-header helpers. Canonical implementations live in
// ./_headers.ts — re-exported here so `@spanlens/sdk/openai` keeps its
// single-import ergonomics (`import { createOpenAI, withUser } from ...`).
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
 * Build an OpenAI client whose requests flow through the Spanlens proxy.
 *
 * @param options Forwards to `new OpenAI(options)`. You can override `apiKey`
 *   and `baseURL` but usually you won't need to — defaults pick up
 *   `SPANLENS_API_KEY`, then `SPANLENS_BASE_URL` (self-hosted origin) or the
 *   hosted proxy URL.
 *
 * @throws Error if `apiKey` is missing (env + explicit both unset).
 */
export function createOpenAI(options: ClientOptions = {}): OpenAI {
  const apiKey = options.apiKey ?? readEnv('SPANLENS_API_KEY')

  if (!apiKey) {
    throw new Error(
      '[spanlens] SPANLENS_API_KEY is not set. Pass { apiKey } to createOpenAI() ' +
        'or add SPANLENS_API_KEY to your environment (e.g. .env.local, Vercel env).',
    )
  }

  return new OpenAI({
    ...options,
    apiKey,
    baseURL: options.baseURL ?? resolveProxyBaseUrl(DEFAULT_SPANLENS_OPENAI_PROXY),
  })
}
