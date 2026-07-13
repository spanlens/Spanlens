/**
 * OpenRouter client helper — pre-configured for the Spanlens proxy.
 *
 * OpenRouter is a meta-provider: one API key, one OpenAI-compatible base URL,
 * 100+ models from 30+ providers (OpenAI, Anthropic, Mistral, Meta, DeepSeek,
 * Qwen, ...). The OpenAI SDK works unchanged with `baseURL` pointed at the
 * Spanlens OpenRouter proxy route. Your requests are recorded in /requests
 * (tokens, latency, cost) and forwarded to OpenRouter using the OpenRouter
 * key you registered in Spanlens.
 *
 *   import { createOpenRouter, observeOpenRouter } from '@spanlens/sdk/openrouter'
 *   const openrouter = createOpenRouter()
 *
 * `openai` is a peer dependency — install it alongside this SDK.
 *
 * @example  Full traced call.
 *   import { SpanlensClient } from '@spanlens/sdk'
 *   import { createOpenRouter, observeOpenRouter } from '@spanlens/sdk/openrouter'
 *
 *   const spanlens = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })
 *   const openrouter = createOpenRouter()
 *
 *   const trace = spanlens.startTrace({ name: 'chat' })
 *   const res = await observeOpenRouter(trace, 'chat', (headers) =>
 *     openrouter.chat.completions.create(
 *       { model: 'anthropic/claude-3.5-sonnet', messages: [{ role: 'user', content: 'Hi' }] },
 *       { headers },
 *     ),
 *   )
 *   await trace.end({ status: 'completed' })
 */

import type OpenAI from 'openai'
import type { ClientOptions } from 'openai'
import { makeSpanlensProxyClient } from './_proxy-client.js'

/** Default Spanlens OpenRouter proxy URL. Override for self-hosted deployments. */
export const DEFAULT_SPANLENS_OPENROUTER_PROXY =
  'https://api.spanlens.io/proxy/openrouter/v1'

/** Build an OpenAI-compatible client whose requests flow through the Spanlens OpenRouter proxy. */
export function createOpenRouter(options: ClientOptions = {}): OpenAI {
  return makeSpanlensProxyClient('OpenRouter', DEFAULT_SPANLENS_OPENROUTER_PROXY, options)
}

// Re-export the tracer so a single `@spanlens/sdk/openrouter` import gives
// both the client factory and the matching `observe` helper.
export { observeOpenRouter } from '../observe.js'

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
