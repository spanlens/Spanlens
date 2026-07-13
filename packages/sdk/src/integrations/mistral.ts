/**
 * Mistral client helper — pre-configured for the Spanlens proxy.
 *
 * Mistral exposes an OpenAI-compatible API, so the OpenAI SDK works unchanged
 * with `baseURL` pointed at the Spanlens Mistral proxy route. Your requests
 * are recorded in /requests (tokens, latency, cost) and forwarded to Mistral
 * using the Mistral key you registered in Spanlens.
 *
 *   import { createMistral, observeMistral } from '@spanlens/sdk/mistral'
 *   const mistral = createMistral()
 *
 * `openai` is a peer dependency — install it alongside this SDK.
 *
 * @example  Full traced call.
 *   import { SpanlensClient } from '@spanlens/sdk'
 *   import { createMistral, observeMistral } from '@spanlens/sdk/mistral'
 *
 *   const spanlens = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })
 *   const mistral = createMistral()
 *
 *   const trace = spanlens.startTrace({ name: 'chat' })
 *   const res = await observeMistral(trace, 'chat', (headers) =>
 *     mistral.chat.completions.create(
 *       { model: 'mistral-small-latest', messages: [{ role: 'user', content: 'Hi' }] },
 *       { headers },
 *     ),
 *   )
 *   await trace.end({ status: 'completed' })
 */

import type OpenAI from 'openai'
import type { ClientOptions } from 'openai'
import { makeSpanlensProxyClient } from './_proxy-client.js'

/** Default Spanlens Mistral proxy URL. Override for self-hosted deployments. */
export const DEFAULT_SPANLENS_MISTRAL_PROXY =
  'https://api.spanlens.io/proxy/mistral/v1'

/** Build an OpenAI-compatible client whose requests flow through the Spanlens Mistral proxy. */
export function createMistral(options: ClientOptions = {}): OpenAI {
  return makeSpanlensProxyClient('Mistral', DEFAULT_SPANLENS_MISTRAL_PROXY, options)
}

// Re-export the tracer so a single `@spanlens/sdk/mistral` import gives both
// the client factory and the matching `observe` helper.
export { observeMistral } from '../observe.js'

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
