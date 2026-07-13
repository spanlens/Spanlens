/**
 * Canonical X-Spanlens-* request-header helpers, shared by every proxy
 * integration subpath (`@spanlens/sdk/openai`, `/anthropic`, `/gemini`,
 * `/groq`, `/deepseek`, `/xai`, `/cohere`, `/ollama`, `/mistral`,
 * `/openrouter`).
 *
 * Each helper returns `{ headers: { ... } }`, which is exactly the shape the
 * OpenAI / Anthropic SDKs accept as per-request options, so you can pass the
 * result directly as the second argument of `chat.completions.create()` /
 * `messages.create()`. Combine helpers by merging their `headers`:
 *
 *   { headers: { ...withUser(u).headers, ...withSession(s).headers } }
 *
 * This module has no external dependencies on purpose — integrations that do
 * not require the `openai` peer dependency (e.g. `@spanlens/sdk/gemini`)
 * re-export from here without pulling one in.
 */

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

/**
 * Tag a single request with a Spanlens prompt version — links the request
 * row to a `prompt_versions` entry so it shows up in the A/B comparison
 * on /prompts.
 *
 * @param id Either a raw `prompt_versions.id` UUID, `"<name>@<version>"`
 *           (e.g. `"chatbot-system@3"`), or `"<name>@latest"` to always
 *           resolve to the latest version server-side.
 *
 * @example
 *   import { createOpenAI, withPromptVersion } from '@spanlens/sdk/openai'
 *   const openai = createOpenAI()
 *
 *   const res = await openai.chat.completions.create(
 *     { model: 'gpt-4o-mini', messages: [...] },
 *     withPromptVersion('chatbot-system@3'),
 *   )
 */
export function withPromptVersion(id: string): { headers: Record<string, string> } {
  return { headers: { [PROMPT_VERSION_HEADER]: id } }
}

/**
 * Tag a request with an end-user ID — populates `requests.user_id` so the
 * dashboard can filter and aggregate by user.
 *
 * @example
 *   import { createOpenAI, withUser } from '@spanlens/sdk/openai'
 *   const openai = createOpenAI()
 *
 *   const res = await openai.chat.completions.create(
 *     { model: 'gpt-4o-mini', messages: [...] },
 *     withUser(currentUser.id),
 *   )
 */
export function withUser(userId: string): { headers: Record<string, string> } {
  return { headers: { [USER_HEADER]: userId } }
}

/**
 * Tag a request with a session ID — groups requests that belong to the same
 * conversation or workflow for end-user attribution.
 *
 * @example
 *   import { createOpenAI, withSession } from '@spanlens/sdk/openai'
 *   const openai = createOpenAI()
 *
 *   const res = await openai.chat.completions.create(
 *     { model: 'gpt-4o-mini', messages: [...] },
 *     withSession(currentSession.id),
 *   )
 *
 * Combine with `withUser` and `withPromptVersion` by merging headers:
 *   { headers: { ...withUser(u).headers, ...withSession(s).headers } }
 */
export function withSession(sessionId: string): { headers: Record<string, string> } {
  return { headers: { [SESSION_HEADER]: sessionId } }
}

/**
 * Opt out of body logging for a single request. The proxy still records
 * tokens, latency, cost, model — just not the prompt/response bodies.
 *
 * - `'full'` (server default): stores request_body + response_body with
 *   API-key pattern masking. Setting this explicitly is a no-op.
 * - `'meta'`: prompts and responses are NOT stored, but token/cost/latency
 *   metadata is. Use when prompts contain customer PII you don't want on
 *   the Spanlens side.
 * - `'none'`: same as `'meta'` plus drops `user_id` and `session_id` from
 *   the log row. For the strictest data-minimization deployments.
 *
 * @example
 *   import { createOpenAI, withLogBody } from '@spanlens/sdk/openai'
 *   const openai = createOpenAI()
 *
 *   const res = await openai.chat.completions.create(
 *     { model: 'gpt-4o-mini', messages: patientPrompt },
 *     withLogBody('meta'),
 *   )
 *
 * Combine with other helpers by merging headers:
 *   { headers: { ...withLogBody('meta').headers, ...withUser(u).headers } }
 */
export function withLogBody(mode: LogBodyMode): { headers: Record<string, string> } {
  return { headers: { [LOG_BODY_HEADER]: mode } }
}

/**
 * Serialize a `withCache` argument into the `x-spanlens-cache` header value,
 * or `null` when the input is not a valid cache directive.
 *
 * Semantics mirror the server (`apps/server/src/lib/proxy-cache.ts`):
 *   - `true` (or omitted) → `'true'` (server applies the default 3600s TTL).
 *   - a positive integer  → the integer as a string, clamped to
 *     CACHE_MAX_TTL_SECONDS (86400) so the emitted value is never rejected.
 *   - anything else (non-integer, zero, negative, NaN) → `null`. The helper
 *     emits no header, matching how the server treats a malformed value as
 *     "no caching" rather than throwing.
 */
export function cacheHeaderValue(ttl?: number | true): string | null {
  if (ttl === undefined || ttl === true) return 'true'
  if (typeof ttl !== 'number' || !Number.isInteger(ttl) || ttl <= 0) return null
  return String(Math.min(ttl, CACHE_MAX_TTL_SECONDS))
}

/**
 * Opt a single request into the Spanlens proxy response cache — repeated,
 * byte-identical requests are served from the cache instead of calling the
 * provider again, so they cost nothing and return in milliseconds.
 *
 * Caching is off by default and only applies to non-streaming requests whose
 * upstream response is a 200 JSON body under 256 KB. Entries are scoped to your
 * Spanlens API key, so they are never shared across keys, projects, or orgs.
 * See the {@link https://spanlens.io/docs/proxy#response-caching proxy caching docs}
 * for the full rules.
 *
 * @param ttl `true` (or omitted) caches with the default TTL
 *   ({@link CACHE_DEFAULT_TTL_SECONDS}, 1 hour). A positive integer sets the TTL
 *   in seconds; the server caps it at {@link CACHE_MAX_TTL_SECONDS} (24h) and
 *   this helper clamps to the same ceiling. Invalid values (non-integer, zero,
 *   negative) emit no header, matching the server's fail-safe.
 *
 * @example
 *   import { createOpenAI, withCache } from '@spanlens/sdk/openai'
 *   const openai = createOpenAI()
 *
 *   // Default TTL (1 hour)
 *   const res = await openai.chat.completions.create(
 *     { model: 'gpt-4o-mini', messages: [...] },
 *     withCache(),
 *   )
 *
 *   // Custom TTL (10 minutes)
 *   const res2 = await openai.chat.completions.create(
 *     { model: 'gpt-4o-mini', messages: [...] },
 *     withCache(600),
 *   )
 *
 * Combine with other helpers by merging headers:
 *   { headers: { ...withCache(600).headers, ...withUser(u).headers } }
 */
export function withCache(ttl?: number | true): { headers: Record<string, string> } {
  const value = cacheHeaderValue(ttl)
  return { headers: value == null ? {} : { [CACHE_HEADER]: value } }
}
