/**
 * DeepSeek client helper — pre-configured for the Spanlens proxy.
 *
 * DeepSeek exposes an OpenAI-compatible API, so the OpenAI SDK works unchanged
 * with `baseURL` pointed at the Spanlens DeepSeek proxy route. Requests are
 * recorded in /requests (tokens, latency, cost) and forwarded to DeepSeek
 * using the DeepSeek key you registered in Spanlens.
 *
 *   import { createDeepSeek, observeDeepSeek } from '@spanlens/sdk/deepseek'
 *   const deepseek = createDeepSeek()
 *
 * `openai` is a peer dependency — install it alongside this SDK.
 *
 * @example
 *   import { SpanlensClient } from '@spanlens/sdk'
 *   import { createDeepSeek, observeDeepSeek } from '@spanlens/sdk/deepseek'
 *
 *   const spanlens = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })
 *   const deepseek = createDeepSeek()
 *
 *   const trace = spanlens.startTrace({ name: 'chat' })
 *   const res = await observeDeepSeek(trace, 'chat', (headers) =>
 *     deepseek.chat.completions.create(
 *       { model: 'deepseek-chat', messages: [{ role: 'user', content: 'Hi' }] },
 *       { headers },
 *     ),
 *   )
 *   await trace.end({ status: 'completed' })
 */

import type OpenAI from 'openai'
import type { ClientOptions } from 'openai'
import { makeSpanlensProxyClient } from './_proxy-client.js'

/** Default Spanlens DeepSeek proxy URL. Override for self-hosted deployments. */
export const DEFAULT_SPANLENS_DEEPSEEK_PROXY =
  'https://api.spanlens.io/proxy/deepseek/v1'

/** Build an OpenAI-compatible client whose requests flow through the Spanlens DeepSeek proxy. */
export function createDeepSeek(options: ClientOptions = {}): OpenAI {
  return makeSpanlensProxyClient('DeepSeek', DEFAULT_SPANLENS_DEEPSEEK_PROXY, options)
}

export { observeDeepSeek } from '../observe.js'

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
