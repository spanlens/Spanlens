/**
 * Anthropic client helper — pre-configured for the Spanlens proxy.
 *
 *   import { createAnthropic } from '@spanlens/sdk/anthropic'
 *   const anthropic = createAnthropic()
 *
 * `@anthropic-ai/sdk` is a peer dependency.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { ClientOptions } from '@anthropic-ai/sdk'
import type { LogBodyMode } from '../types.js'

export const PROMPT_VERSION_HEADER = 'x-spanlens-prompt-version'
export const USER_HEADER = 'x-spanlens-user'
export const SESSION_HEADER = 'x-spanlens-session'
export const LOG_BODY_HEADER = 'x-spanlens-log-body'
export const CACHE_HEADER = 'x-spanlens-cache'

/** Default TTL applied server-side when the cache header is `true`. */
export const CACHE_DEFAULT_TTL_SECONDS = 3600
/** Server caps any requested TTL at this many seconds (24h). */
export const CACHE_MAX_TTL_SECONDS = 86400

export const DEFAULT_SPANLENS_ANTHROPIC_PROXY =
  'https://api.spanlens.io/proxy/anthropic'

export function createAnthropic(options: ClientOptions = {}): Anthropic {
  const apiKey = options.apiKey ?? readEnv('SPANLENS_API_KEY')

  if (!apiKey) {
    throw new Error(
      '[spanlens] SPANLENS_API_KEY is not set. Pass { apiKey } to createAnthropic() ' +
        'or add SPANLENS_API_KEY to your environment.',
    )
  }

  return new Anthropic({
    ...options,
    apiKey,
    baseURL: options.baseURL ?? DEFAULT_SPANLENS_ANTHROPIC_PROXY,
  })
}

function readEnv(name: string): string | undefined {
  if (typeof process !== 'undefined' && process.env) {
    return process.env[name]
  }
  return undefined
}

/**
 * Tag a single Anthropic request with a Spanlens prompt version.
 *
 * @param id Either a raw `prompt_versions.id` UUID, `"<name>@<version>"`, or
 *           `"<name>@latest"`.
 *
 * @example
 *   import { createAnthropic, withPromptVersion } from '@spanlens/sdk/anthropic'
 *   const anthropic = createAnthropic()
 *
 *   const msg = await anthropic.messages.create(
 *     { model: 'claude-3-5-sonnet-20241022', max_tokens: 1024, messages: [...] },
 *     withPromptVersion('greeter@latest'),
 *   )
 */
export function withPromptVersion(id: string): { headers: Record<string, string> } {
  return { headers: { [PROMPT_VERSION_HEADER]: id } }
}

/** Tag a request with an end-user ID. Same semantics as the OpenAI helper. */
export function withUser(userId: string): { headers: Record<string, string> } {
  return { headers: { [USER_HEADER]: userId } }
}

/** Tag a request with a session ID. Same semantics as the OpenAI helper. */
export function withSession(sessionId: string): { headers: Record<string, string> } {
  return { headers: { [SESSION_HEADER]: sessionId } }
}

/**
 * Opt out of body logging for a single request. See the OpenAI helper for
 * full semantics — modes are identical (`'full'` | `'meta'` | `'none'`).
 *
 * @example
 *   import { createAnthropic, withLogBody } from '@spanlens/sdk/anthropic'
 *   const anthropic = createAnthropic()
 *
 *   const msg = await anthropic.messages.create(
 *     { model: 'claude-3-5-sonnet-20241022', max_tokens: 1024, messages },
 *     withLogBody('meta'),
 *   )
 */
export function withLogBody(mode: LogBodyMode): { headers: Record<string, string> } {
  return { headers: { [LOG_BODY_HEADER]: mode } }
}

/**
 * Serialize a `withCache` argument into the `x-spanlens-cache` header value,
 * or `null` when the input is not a valid cache directive. Same semantics as
 * the OpenAI helper.
 */
export function cacheHeaderValue(ttl?: number | true): string | null {
  if (ttl === undefined || ttl === true) return 'true'
  if (typeof ttl !== 'number' || !Number.isInteger(ttl) || ttl <= 0) return null
  return String(Math.min(ttl, CACHE_MAX_TTL_SECONDS))
}

/**
 * Opt a single Anthropic request into the Spanlens proxy response cache. See
 * the OpenAI helper for full semantics — behavior is identical.
 *
 * @param ttl `true` (or omitted) uses the default TTL
 *   ({@link CACHE_DEFAULT_TTL_SECONDS}, 1 hour); a positive integer sets seconds,
 *   clamped to {@link CACHE_MAX_TTL_SECONDS} (24h). Invalid values emit no header.
 *
 * @example
 *   import { createAnthropic, withCache } from '@spanlens/sdk/anthropic'
 *   const anthropic = createAnthropic()
 *
 *   const msg = await anthropic.messages.create(
 *     { model: 'claude-3-5-sonnet-20241022', max_tokens: 1024, messages },
 *     withCache(600),
 *   )
 */
export function withCache(ttl?: number | true): { headers: Record<string, string> } {
  const value = cacheHeaderValue(ttl)
  return { headers: value == null ? {} : { [CACHE_HEADER]: value } }
}
