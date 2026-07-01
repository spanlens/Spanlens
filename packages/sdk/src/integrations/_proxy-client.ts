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

function readEnv(name: string): string | undefined {
  // Node + Vercel Edge both expose process.env; guard for browser bundles.
  if (typeof process !== 'undefined' && process.env) {
    return process.env[name]
  }
  return undefined
}

/**
 * Build an OpenAI-SDK client whose requests flow through a Spanlens proxy
 * route for an OpenAI-compatible provider.
 *
 * @param providerLabel Capitalized helper name used in the missing-key error
 *   (e.g. `'Groq'` → "...pass { apiKey } to createGroq()").
 * @param defaultProxyUrl Default `baseURL` (the hosted Spanlens proxy route).
 * @param options Forwards to `new OpenAI(options)`. `apiKey` defaults to
 *   `SPANLENS_API_KEY`; override `baseURL` for self-hosted deployments.
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
    baseURL: options.baseURL ?? defaultProxyUrl,
  })
}
