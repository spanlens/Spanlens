/**
 * OpenAI client helper — pre-configured for the Spanlens proxy.
 *
 * Replaces:
 *   const openai = new OpenAI({
 *     apiKey: process.env.SPANLENS_API_KEY,
 *     baseURL: 'https://spanlens-server.vercel.app/proxy/openai/v1',
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

/** Default Spanlens proxy URL. Override for self-hosted deployments. */
export const DEFAULT_SPANLENS_OPENAI_PROXY =
  'https://spanlens-server.vercel.app/proxy/openai/v1'

/**
 * Build an OpenAI client whose requests flow through the Spanlens proxy.
 *
 * @param options Forwards to `new OpenAI(options)`. You can override `apiKey`
 *   and `baseURL` but usually you won't need to — defaults pick up
 *   `SPANLENS_API_KEY` and the hosted proxy URL.
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
    baseURL: options.baseURL ?? DEFAULT_SPANLENS_OPENAI_PROXY,
  })
}

function readEnv(name: string): string | undefined {
  // Node + Vercel Edge both expose process.env; guard just in case (e.g. browser).
  if (typeof process !== 'undefined' && process.env) {
    return process.env[name]
  }
  return undefined
}
