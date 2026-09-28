/**
 * Shared factory for OpenAI-compatible providers routed through the Spanlens
 * proxy (Groq, DeepSeek, xAI, Cohere, ...).
 *
 * These providers all speak the OpenAI Chat Completions wire protocol, so the
 * client is just `new OpenAI(...)` with `baseURL` pointed at the matching
 * Spanlens proxy route (which records the call in /requests, enforces quota,
 * and forwards to the real provider using the encrypted provider key stored
 * server-side). `apiKey` is your **Spanlens** key (SPANLENS_API_KEY), not the
 * upstream provider key — the provider key never leaves the server.
 *
 * `openai` is a peer dependency — install it alongside this SDK.
 */

import OpenAI from 'openai'
import type { ClientOptions } from 'openai'
import { readEnv, resolveProxyBaseUrl } from '../env.js'

/**
 * Build an OpenAI-SDK client whose requests flow through a Spanlens proxy
 * route for an OpenAI-compatible provider.
 *
 * @param providerLabel Capitalized helper name used in the missing-key error
 *   (e.g. `'Groq'` → "...pass { apiKey } to createGroq()").
 * @param defaultProxyUrl The hosted Spanlens proxy route. When
 *   `SPANLENS_BASE_URL` is set, its path is appended to that origin instead.
 * @param options Forwards to `new OpenAI(options)`. `apiKey` defaults to
 *   `SPANLENS_API_KEY`; an explicit `baseURL` wins over everything.
 *
 * @throws Error if `apiKey` is missing (env + explicit both unset).
 */
export function makeSpanlensProxyClient(
  providerLabel: string,
  defaultProxyUrl: string,
  options: ClientOptions = {},
): OpenAI {
  const apiKey = options.apiKey ?? readEnv('SPANLENS_API_KEY')

  if (!apiKey) {
    throw new Error(
      `[spanlens] SPANLENS_API_KEY is not set. Pass { apiKey } to create${providerLabel}() ` +
        'or add SPANLENS_API_KEY to your environment (e.g. .env.local, Vercel env).',
    )
  }

  return new OpenAI({
    ...options,
    apiKey,
    baseURL: options.baseURL ?? resolveProxyBaseUrl(defaultProxyUrl),
  })
}
