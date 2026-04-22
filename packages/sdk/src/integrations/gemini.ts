/**
 * Google Gemini client helper — pre-configured for the Spanlens proxy.
 *
 *   import { createGemini } from '@spanlens/sdk/gemini'
 *   const genAI = createGemini()
 *   const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
 *   // baseUrl is auto-injected for every getGenerativeModel call
 *
 * `@google/generative-ai` is a peer dependency.
 *
 * NOTE: Unlike OpenAI / Anthropic which take `baseURL` in their constructor,
 * `GoogleGenerativeAI` only accepts `baseUrl` via the optional `RequestOptions`
 * second argument of `getGenerativeModel()`. We wrap the instance with a Proxy
 * so callers don't have to remember this — every model created through the
 * wrapped client automatically routes through the Spanlens proxy.
 */

import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai'

export const DEFAULT_SPANLENS_GEMINI_PROXY =
  'https://spanlens-server.vercel.app/proxy/gemini'

export interface CreateGeminiOptions {
  /** Spanlens API key. Defaults to `process.env.SPANLENS_API_KEY`. */
  apiKey?: string
  /** Proxy base URL — override for self-hosted Spanlens. */
  baseUrl?: string
}

/**
 * Returns a `GoogleGenerativeAI` whose `getGenerativeModel()` automatically
 * routes requests through the Spanlens proxy.
 *
 * If the caller passes their own `RequestOptions` (rare) we merge — explicit
 * caller options win so you can still override per-call.
 */
export function createGemini(options: CreateGeminiOptions = {}): GoogleGenerativeAI {
  const apiKey = options.apiKey ?? readEnv('SPANLENS_API_KEY')

  if (!apiKey) {
    throw new Error(
      '[spanlens] SPANLENS_API_KEY is not set. Pass { apiKey } to createGemini() ' +
        'or add SPANLENS_API_KEY to your environment.',
    )
  }

  const baseUrl = options.baseUrl ?? DEFAULT_SPANLENS_GEMINI_PROXY
  const genAI = new GoogleGenerativeAI(apiKey)

  // Proxy-wrap so .getGenerativeModel() auto-injects baseUrl without the
  // caller having to remember it.
  return new Proxy(genAI, {
    get(target, prop, receiver): unknown {
      if (prop === 'getGenerativeModel') {
        return function wrappedGetGenerativeModel(
          modelParams: Parameters<GoogleGenerativeAI['getGenerativeModel']>[0],
          requestOptions?: Parameters<GoogleGenerativeAI['getGenerativeModel']>[1],
        ): GenerativeModel {
          return target.getGenerativeModel(modelParams, {
            baseUrl,
            ...(requestOptions ?? {}),
          })
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  })
}

function readEnv(name: string): string | undefined {
  if (typeof process !== 'undefined' && process.env) {
    return process.env[name]
  }
  return undefined
}
