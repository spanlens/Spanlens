/**
 * Google Gemini client helper — pre-configured for the Spanlens proxy.
 *
 *   import { createGemini } from '@spanlens/sdk/gemini'
 *   const genAI = createGemini()
 *   const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
 *   // baseUrl is auto-injected for every model the client creates
 *
 * `@google/generative-ai` is a peer dependency.
 *
 * NOTE: Unlike OpenAI / Anthropic which take `baseURL` in their constructor,
 * `GoogleGenerativeAI` only accepts `baseUrl` via the optional `RequestOptions`
 * argument of its model factories (`getGenerativeModel()` and
 * `getGenerativeModelFromCachedContent()`). We wrap the instance with a Proxy
 * so callers don't have to remember this: every model created through the
 * wrapped client routes through the Spanlens proxy.
 *
 * Per-request headers: the Gemini SDK reads them from
 * `RequestOptions.customHeaders` and ignores a `headers` key. The
 * `withUser` / `withSession` / `withLogBody` / `withCache` /
 * `withPromptVersion` helpers exported from THIS subpath therefore return
 * `{ customHeaders, headers }` so they work when passed straight to
 * `generateContent(request, options)`.
 */

import {
  GoogleGenerativeAI,
  type GenerativeModel,
  type RequestOptions,
} from '@google/generative-ai'
import { readEnv, resolveProxyBaseUrl } from '../env.js'
import {
  withCache as withCacheHeaders,
  withLogBody as withLogBodyHeaders,
  withPromptVersion as withPromptVersionHeaders,
  withSession as withSessionHeaders,
  withUser as withUserHeaders,
} from './_headers.js'
import type { LogBodyMode } from '../types.js'

/**
 * Hosted Spanlens proxy URL. Self-hosted deployments set `SPANLENS_BASE_URL`
 * (the server origin) or pass `baseUrl`.
 */
export const DEFAULT_SPANLENS_GEMINI_PROXY =
  'https://api.spanlens.io/proxy/gemini'

export interface CreateGeminiOptions {
  /** Spanlens API key. Defaults to `process.env.SPANLENS_API_KEY`. */
  apiKey?: string
  /**
   * Proxy base URL. Defaults to `SPANLENS_BASE_URL` + `/proxy/gemini` when
   * that variable is set, otherwise the hosted proxy.
   */
  baseUrl?: string
}

type HeaderRecord = Record<string, string>

/** Per-request options accepted by the model factories, plus an OpenAI-style `headers` key. */
type LooseRequestOptions = RequestOptions & { headers?: HeaderRecord }

/**
 * Returns a `GoogleGenerativeAI` whose model factories automatically route
 * requests through the Spanlens proxy.
 *
 * If the caller passes their own `RequestOptions` we merge them: explicit
 * caller options win, so you can still override per model.
 */
export function createGemini(options: CreateGeminiOptions = {}): GoogleGenerativeAI {
  const apiKey = options.apiKey ?? readEnv('SPANLENS_API_KEY')

  if (!apiKey) {
    throw new Error(
      '[spanlens] SPANLENS_API_KEY is not set. Pass { apiKey } to createGemini() ' +
        'or add SPANLENS_API_KEY to your environment.',
    )
  }

  const baseUrl = options.baseUrl ?? resolveProxyBaseUrl(DEFAULT_SPANLENS_GEMINI_PROXY)
  const genAI = new GoogleGenerativeAI(apiKey)
  const withProxy = (requestOptions?: LooseRequestOptions): RequestOptions =>
    proxiedRequestOptions(baseUrl, requestOptions)

  // Proxy-wrap both model factories. `getGenerativeModelFromCachedContent`
  // builds its model directly (it never calls getGenerativeModel), so leaving
  // it unwrapped sent the Spanlens key straight to Google.
  return new Proxy(genAI, {
    get(target, prop, receiver): unknown {
      if (prop === 'getGenerativeModel') {
        return function wrappedGetGenerativeModel(
          modelParams: Parameters<GoogleGenerativeAI['getGenerativeModel']>[0],
          requestOptions?: LooseRequestOptions,
        ): GenerativeModel {
          return target.getGenerativeModel(modelParams, withProxy(requestOptions))
        }
      }
      if (prop === 'getGenerativeModelFromCachedContent') {
        return function wrappedGetGenerativeModelFromCachedContent(
          cachedContent: Parameters<GoogleGenerativeAI['getGenerativeModelFromCachedContent']>[0],
          modelParams?: Parameters<GoogleGenerativeAI['getGenerativeModelFromCachedContent']>[1],
          requestOptions?: LooseRequestOptions,
        ): GenerativeModel {
          return target.getGenerativeModelFromCachedContent(
            cachedContent,
            modelParams,
            withProxy(requestOptions),
          )
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  })
}

/**
 * Proxy `baseUrl` first, caller options on top. An OpenAI-style `headers`
 * map (for example from the helpers on `@spanlens/sdk/openai`) is folded into
 * `customHeaders`, the only header field the Gemini SDK sends.
 */
function proxiedRequestOptions(
  baseUrl: string,
  requestOptions: LooseRequestOptions = {},
): RequestOptions {
  const { headers, ...rest } = requestOptions
  const merged: RequestOptions = { baseUrl, ...rest }
  if (!headers) return merged
  return {
    ...merged,
    customHeaders: { ...headers, ...toHeaderRecord(rest.customHeaders) },
  }
}

function toHeaderRecord(headers: RequestOptions['customHeaders']): HeaderRecord {
  if (!headers) return {}
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    const record: HeaderRecord = {}
    headers.forEach((value, key) => {
      record[key] = value
    })
    return record
  }
  return { ...(headers as HeaderRecord) }
}

// ── X-Spanlens-* request-header helpers, Gemini shape ────────────────────────

/**
 * What the Gemini header helpers return. Pass it as the per-request options
 * argument of `generateContent()` / `generateContentStream()` /
 * `countTokens()`, or merge several helpers through `customHeaders`:
 *
 *   model.generateContent(request, {
 *     customHeaders: { ...withUser(u).customHeaders, ...withLogBody('meta').customHeaders },
 *   })
 */
export interface GeminiSpanlensHeaders {
  /** The field `@google/generative-ai` actually sends on the wire. */
  customHeaders: HeaderRecord
  /**
   * The same map under the OpenAI-style key, kept so hand-written
   * `...helper().headers` merges keep compiling. The Gemini SDK ignores it.
   */
  headers: HeaderRecord
}

function forGemini(helper: { headers: HeaderRecord }): GeminiSpanlensHeaders {
  return { customHeaders: { ...helper.headers }, headers: { ...helper.headers } }
}

/** Tag a request with a Spanlens prompt version (`name@version`, `name@latest`, or UUID). */
export function withPromptVersion(id: string): GeminiSpanlensHeaders {
  return forGemini(withPromptVersionHeaders(id))
}

/** Tag a request with an end-user ID (`requests.user_id`). */
export function withUser(userId: string): GeminiSpanlensHeaders {
  return forGemini(withUserHeaders(userId))
}

/** Tag a request with a session ID (`requests.session_id`). */
export function withSession(sessionId: string): GeminiSpanlensHeaders {
  return forGemini(withSessionHeaders(sessionId))
}

/** Control body retention for a request: `'full' | 'meta' | 'none'`. */
export function withLogBody(mode: LogBodyMode): GeminiSpanlensHeaders {
  return forGemini(withLogBodyHeaders(mode))
}

/** Opt a request into the proxy response cache (`true` = 1 hour, or a TTL in seconds). */
export function withCache(ttl?: number | true): GeminiSpanlensHeaders {
  return forGemini(withCacheHeaders(ttl))
}

// Header names and the cache-value serializer are shape-independent, so they
// are the canonical ./_headers.ts exports.
export {
  PROMPT_VERSION_HEADER,
  USER_HEADER,
  SESSION_HEADER,
  LOG_BODY_HEADER,
  CACHE_HEADER,
  CACHE_DEFAULT_TTL_SECONDS,
  CACHE_MAX_TTL_SECONDS,
  cacheHeaderValue,
} from './_headers.js'
