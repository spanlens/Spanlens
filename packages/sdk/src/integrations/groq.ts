/**
 * Groq client helper — pre-configured for the Spanlens proxy.
 *
 * Groq exposes an OpenAI-compatible API, so the OpenAI SDK works unchanged
 * with `baseURL` pointed at the Spanlens Groq proxy route. Your requests are
 * recorded in /requests (tokens, latency, cost) and forwarded to Groq using
 * the Groq key you registered in Spanlens.
 *
 *   import { createGroq, observeGroq } from '@spanlens/sdk/groq'
 *   const groq = createGroq()
 *
 * `openai` is a peer dependency — install it alongside this SDK.
 *
 * @example  Full traced call.
 *   import { SpanlensClient } from '@spanlens/sdk'
 *   import { createGroq, observeGroq } from '@spanlens/sdk/groq'
 *
 *   const spanlens = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })
 *   const groq = createGroq()
 *
 *   const trace = spanlens.startTrace({ name: 'chat' })
 *   const res = await observeGroq(trace, 'chat', (headers) =>
 *     groq.chat.completions.create(
 *       { model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: 'Hi' }] },
 *       { headers },
 *     ),
 *   )
 *   await trace.end({ status: 'completed' })
 */

import type OpenAI from 'openai'
import type { ClientOptions } from 'openai'
import { makeSpanlensProxyClient } from './_proxy-client.js'

/** Default Spanlens Groq proxy URL. Override for self-hosted deployments. */
export const DEFAULT_SPANLENS_GROQ_PROXY =
  'https://spanlens-server.vercel.app/proxy/groq/v1'

/** Build an OpenAI-compatible client whose requests flow through the Spanlens Groq proxy. */
export function createGroq(options: ClientOptions = {}): OpenAI {
  return makeSpanlensProxyClient('Groq', DEFAULT_SPANLENS_GROQ_PROXY, options)
}

// Re-export the tracer so a single `@spanlens/sdk/groq` import gives both the
// client factory and the matching `observe` helper.
export { observeGroq } from '../observe.js'
