/**
 * xAI (Grok) client helper — pre-configured for the Spanlens proxy.
 *
 * xAI's API is OpenAI-compatible, so the OpenAI SDK works unchanged with
 * `baseURL` pointed at the Spanlens xAI proxy route. Requests are recorded in
 * /requests (tokens, latency, cost) and forwarded to xAI using the xAI key
 * you registered in Spanlens.
 *
 *   import { createXai, observeXai } from '@spanlens/sdk/xai'
 *   const xai = createXai()
 *
 * `openai` is a peer dependency — install it alongside this SDK.
 *
 * @example
 *   import { SpanlensClient } from '@spanlens/sdk'
 *   import { createXai, observeXai } from '@spanlens/sdk/xai'
 *
 *   const spanlens = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })
 *   const xai = createXai()
 *
 *   const trace = spanlens.startTrace({ name: 'chat' })
 *   const res = await observeXai(trace, 'chat', (headers) =>
 *     xai.chat.completions.create(
 *       { model: 'grok-4.3', messages: [{ role: 'user', content: 'Hi' }] },
 *       { headers },
 *     ),
 *   )
 *   await trace.end({ status: 'completed' })
 */

import type OpenAI from 'openai'
import type { ClientOptions } from 'openai'
import { makeSpanlensProxyClient } from './_proxy-client.js'

/** Default Spanlens xAI proxy URL. Override for self-hosted deployments. */
export const DEFAULT_SPANLENS_XAI_PROXY =
  'https://api.spanlens.io/proxy/xai/v1'

/** Build an OpenAI-compatible client whose requests flow through the Spanlens xAI proxy. */
export function createXai(options: ClientOptions = {}): OpenAI {
  return makeSpanlensProxyClient('Xai', DEFAULT_SPANLENS_XAI_PROXY, options)
}

export { observeXai } from '../observe.js'

// X-Spanlens-* request-header helpers (withUser / withSession / withLogBody /
// withCache / withPromptVersion) — canonical implementations live in
// ./_headers.ts. Re-exported so every proxy subpath has the same single-import
// ergonomics as `@spanlens/sdk/openai`.
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
