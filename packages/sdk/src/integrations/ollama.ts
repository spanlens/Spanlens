/**
 * Ollama client helper — a pre-configured OpenAI-compatible client pointed
 * at a **local** Ollama server, plus the `observeOllama` tracer.
 *
 * Ollama runs on your own machine (`http://localhost:11434`), so unlike the
 * hosted providers it does NOT go through the Spanlens proxy — the proxy
 * can't reach your localhost. Observability instead comes from the SDK's
 * client-side tracing: wrap each call with `observeOllama()` so the span is
 * ingested and tagged `provider: 'ollama'` in the dashboard.
 *
 * Replaces:
 *   import OpenAI from 'openai'
 *   const ollama = new OpenAI({
 *     baseURL: 'http://localhost:11434/v1',
 *     apiKey: 'ollama',
 *   })
 *
 * With:
 *   import { createOllama } from '@spanlens/sdk/ollama'
 *   const ollama = createOllama()
 *
 * `openai` is a peer dependency — install it alongside this SDK.
 *
 * @example  Full traced call.
 *   import { SpanlensClient } from '@spanlens/sdk'
 *   import { createOllama, observeOllama } from '@spanlens/sdk/ollama'
 *
 *   const spanlens = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })
 *   const ollama = createOllama()
 *
 *   const trace = spanlens.startTrace({ name: 'chat' })
 *   const res = await observeOllama(trace, 'chat', (headers) =>
 *     ollama.chat.completions.create(
 *       { model: 'llama3.1', messages: [{ role: 'user', content: 'Hello' }] },
 *       { headers },
 *     ),
 *   )
 *   await trace.end({ status: 'completed' })
 */

import OpenAI from 'openai'
import type { ClientOptions } from 'openai'

/** Default local Ollama OpenAI-compatible endpoint. Override for a remote host. */
export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434/v1'

/**
 * Build an OpenAI-compatible client pointed at a local Ollama server.
 *
 * No Spanlens API key is required here — Ollama is local and the client only
 * talks to it directly. Tracing is added separately by wrapping calls with
 * `observeOllama()` (which needs a `SpanlensClient` trace). See the module
 * example above.
 *
 * @param options Forwards to `new OpenAI(options)`. `baseURL` defaults to the
 *   local Ollama endpoint; `apiKey` defaults to the throwaway string
 *   `'ollama'` (Ollama ignores it, but the OpenAI SDK requires a non-empty
 *   value). Override `baseURL` to point at a remote Ollama host.
 */
export function createOllama(options: ClientOptions = {}): OpenAI {
  return new OpenAI({
    ...options,
    // Ollama ignores the key; the OpenAI SDK just needs a non-empty string.
    apiKey: options.apiKey ?? 'ollama',
    baseURL: options.baseURL ?? DEFAULT_OLLAMA_BASE_URL,
  })
}

// Re-export the tracer so a single `@spanlens/sdk/ollama` import gives users
// both the client factory and the matching `observe` helper — mirrors how
// `@spanlens/sdk/openai` co-locates `createOpenAI` with its header helpers.
export { observeOllama } from '../observe.js'
