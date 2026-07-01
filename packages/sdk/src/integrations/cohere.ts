/**
 * Cohere client helper — pre-configured for the Spanlens proxy.
 *
 * Cohere exposes an OpenAI-compatibility layer, so the OpenAI SDK works with
 * `baseURL` pointed at the Spanlens Cohere proxy route. Requests are recorded
 * in /requests (tokens, latency, cost) and forwarded to Cohere using the
 * Cohere key you registered in Spanlens. Use Cohere model ids
 * (`command-a-03-2025`, `command-r-08-2024`, ...), not `gpt-*` names.
 *
 *   import { createCohere, observeCohere } from '@spanlens/sdk/cohere'
 *   const cohere = createCohere()
 *
 * `openai` is a peer dependency — install it alongside this SDK.
 *
 * @example
 *   import { SpanlensClient } from '@spanlens/sdk'
 *   import { createCohere, observeCohere } from '@spanlens/sdk/cohere'
 *
 *   const spanlens = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })
 *   const cohere = createCohere()
 *
 *   const trace = spanlens.startTrace({ name: 'chat' })
 *   const res = await observeCohere(trace, 'chat', (headers) =>
 *     cohere.chat.completions.create(
 *       { model: 'command-a-03-2025', messages: [{ role: 'user', content: 'Hi' }] },
 *       { headers },
 *     ),
 *   )
 *   await trace.end({ status: 'completed' })
 */

import type OpenAI from 'openai'
import type { ClientOptions } from 'openai'
import { makeSpanlensProxyClient } from './_proxy-client.js'

/** Default Spanlens Cohere proxy URL. Override for self-hosted deployments. */
export const DEFAULT_SPANLENS_COHERE_PROXY =
  'https://spanlens-server.vercel.app/proxy/cohere/v1'

/** Build an OpenAI-compatible client whose requests flow through the Spanlens Cohere proxy. */
export function createCohere(options: ClientOptions = {}): OpenAI {
  return makeSpanlensProxyClient('Cohere', DEFAULT_SPANLENS_COHERE_PROXY, options)
}

export { observeCohere } from '../observe.js'
