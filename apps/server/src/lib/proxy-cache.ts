/**
 * Opt-in exact-match proxy response cache (Helicone-style). OFF by default.
 *
 * Customers opt in per request with the `x-spanlens-cache` header:
 *   - `true`          → cache with the default TTL (3600s)
 *   - `<seconds>`     → integer TTL, capped at 86400s (24h)
 *   - anything else   → no caching (fail-safe: a malformed header never caches)
 *
 * Scope + guards:
 *   - Non-streaming only. `stream: true` requests bypass the cache entirely.
 *   - Only HTTP 200 JSON upstream responses are stored.
 *   - Bodies over 256 KB are never stored.
 *   - The cache key is sha256(api_key_id + provider + path + raw request body),
 *     so entries can never be served across Spanlens keys (and therefore never
 *     across projects or organizations). Do not remove api_key_id from the key.
 *
 * Storage: Supabase table `proxy_response_cache` (RLS enabled, NO policies —
 * server-only access via supabaseAdmin / service_role). Expired rows are
 * removed opportunistically on the miss path (no cron): the proxy handler
 * fires `deleteExpiredCacheEntry` via fireAndForget when a lookup finds a
 * stale row.
 *
 * All read/write failures here fail OPEN — a cache outage must never break
 * the proxy hot path. Errors are logged, never rethrown.
 *
 * The `x-spanlens-cache` request header is stripped before the upstream call
 * by the STRIP_PREFIXES rule in proxy/utils.ts (every `x-spanlens-*` header).
 */

import { supabaseAdmin } from './db.js'
import { sha256Hex } from './crypto.js'
import { logError } from './structured-logger.js'

export const PROXY_CACHE_HEADER = 'x-spanlens-cache'
export const PROXY_CACHE_DEFAULT_TTL_SECONDS = 3600
export const PROXY_CACHE_MAX_TTL_SECONDS = 86400
export const PROXY_CACHE_MAX_BODY_BYTES = 256 * 1024

const CACHE_TABLE = 'proxy_response_cache'

/** Token usage snapshot stored alongside the cached body so HITs log real tokens. */
export interface CachedUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
}

export interface CachedProxyResponse {
  responseStatus: number
  responseBody: string
  usage: CachedUsage
  model: string
}

export type ProxyCacheState =
  /** Header absent or invalid — caching not requested. No response header. */
  | { mode: 'off' }
  /** Header present but the request is streaming — respond `x-spanlens-cache: bypass`. */
  | { mode: 'bypass' }
  /** Caching requested, no fresh entry — store on 200 and respond `miss`. */
  | { mode: 'miss'; keyHash: string; ttlSeconds: number }
  /** Fresh entry found — serve it without calling upstream, respond `hit`. */
  | { mode: 'hit'; keyHash: string; ttlSeconds: number; entry: CachedProxyResponse }

export interface ResolvedProxyCache {
  state: ProxyCacheState
  /**
   * Set when the lookup found an EXPIRED row for this key. The caller should
   * pass `deleteExpiredCacheEntry(expiredKeyHash)` to fireAndForget so the
   * cleanup never blocks the client response (CLAUDE.md gotcha #8).
   */
  expiredKeyHash: string | null
}

/**
 * Parse the `x-spanlens-cache` request header into a TTL in seconds.
 * Returns null when caching is not requested (absent / malformed / zero /
 * negative / non-integer). `true` maps to the default TTL; integers are
 * capped at PROXY_CACHE_MAX_TTL_SECONDS.
 */
export function parseCacheTtlSeconds(header: string | null | undefined): number | null {
  if (header == null) return null
  const value = header.trim().toLowerCase()
  if (value === 'true') return PROXY_CACHE_DEFAULT_TTL_SECONDS
  if (!/^\d+$/.test(value)) return null
  const seconds = Number(value)
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return null
  return Math.min(seconds, PROXY_CACHE_MAX_TTL_SECONDS)
}

export interface CacheKeyInput {
  /** Spanlens key id — scopes the entry; cross-key reuse is impossible. */
  apiKeyId: string
  /** Provider tag from the URL path (openai / anthropic / gemini / ...). */
  provider: string
  /** Request path (e.g. /proxy/openai/v1/chat/completions). */
  path: string
  /** Raw (untransformed) request body text. */
  rawBody: string
}

/**
 * sha256 over (api_key_id + provider + path + raw request body).
 * apiKeyId / provider / path never contain a newline, and rawBody is the
 * last component, so the '\n' join is unambiguous.
 *
 * sha256Hex is async (Web Crypto) — ALWAYS await it (CLAUDE.md gotcha #12).
 */
export async function computeCacheKeyHash(input: CacheKeyInput): Promise<string> {
  return sha256Hex(`${input.apiKeyId}\n${input.provider}\n${input.path}\n${input.rawBody}`)
}

interface CacheRow {
  response_status: number | null
  response_body: string | null
  usage: Record<string, unknown> | null
  model: string | null
  expires_at: string
}

function toCachedUsage(raw: Record<string, unknown> | null): CachedUsage {
  const num = (v: unknown): number => {
    const n = Number(v ?? 0)
    return Number.isFinite(n) ? n : 0
  }
  return {
    prompt_tokens: num(raw?.['prompt_tokens']),
    completion_tokens: num(raw?.['completion_tokens']),
    total_tokens: num(raw?.['total_tokens']),
    cache_read_tokens: num(raw?.['cache_read_tokens']),
    cache_write_tokens: num(raw?.['cache_write_tokens']),
  }
}

/**
 * Look up a cache row by key hash. Fail-open: any Supabase error is treated
 * as a miss. Returns `expired: true` when a row exists but is past its
 * expires_at so the caller can schedule the opportunistic delete.
 */
async function lookupCacheRow(
  keyHash: string,
): Promise<{ entry: CachedProxyResponse | null; expired: boolean }> {
  try {
    const { data, error } = await supabaseAdmin
      .from(CACHE_TABLE)
      .select('response_status, response_body, usage, model, expires_at')
      .eq('key_hash', keyHash)
      .maybeSingle()

    if (error || !data) {
      if (error) {
        logError('UNCATEGORIZED', { kind: 'proxy_cache_lookup_failed' }, error)
      }
      return { entry: null, expired: false }
    }

    const row = data as unknown as CacheRow
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      return { entry: null, expired: true }
    }
    if (typeof row.response_body !== 'string' || row.response_body.length === 0) {
      // Defensive: a row without a body is useless — treat as expired so the
      // opportunistic cleanup removes it.
      return { entry: null, expired: true }
    }

    return {
      entry: {
        responseStatus: Number(row.response_status ?? 200),
        responseBody: row.response_body,
        usage: toCachedUsage(row.usage),
        model: row.model ?? '',
      },
      expired: false,
    }
  } catch (err) {
    logError('UNCATEGORIZED', { kind: 'proxy_cache_lookup_failed' }, err)
    return { entry: null, expired: false }
  }
}

export interface ResolveProxyCacheInput extends CacheKeyInput {
  /** Raw `x-spanlens-cache` request header value. */
  cacheHeader: string | null | undefined
  /** True when the request is streaming (body `stream: true`, or the Gemini
   * `:streamGenerateContent` URL) — streaming requests always bypass. */
  isStreaming: boolean
}

/**
 * Single entry point for the proxy handlers: parses the header, applies the
 * streaming bypass, computes the key, and performs the lookup. Runs at most
 * one Supabase query, and only when caching was actually requested.
 */
export async function resolveProxyCache(
  input: ResolveProxyCacheInput,
): Promise<ResolvedProxyCache> {
  const ttlSeconds = parseCacheTtlSeconds(input.cacheHeader)
  if (ttlSeconds == null) return { state: { mode: 'off' }, expiredKeyHash: null }
  if (input.isStreaming) return { state: { mode: 'bypass' }, expiredKeyHash: null }

  const keyHash = await computeCacheKeyHash(input)
  const { entry, expired } = await lookupCacheRow(keyHash)
  if (entry) {
    return { state: { mode: 'hit', keyHash, ttlSeconds, entry }, expiredKeyHash: null }
  }
  return {
    state: { mode: 'miss', keyHash, ttlSeconds },
    expiredKeyHash: expired ? keyHash : null,
  }
}

/**
 * Opportunistic cleanup for an expired row discovered on the miss path.
 * The `.lt('expires_at', now)` guard means a fresh row written by a
 * concurrent request between our lookup and this delete is left alone.
 * Never throws — intended for fireAndForget.
 */
export async function deleteExpiredCacheEntry(keyHash: string): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from(CACHE_TABLE)
      .delete()
      .eq('key_hash', keyHash)
      .lt('expires_at', new Date().toISOString())
    if (error) {
      logError('UNCATEGORIZED', { kind: 'proxy_cache_cleanup_failed' }, error)
    }
  } catch (err) {
    logError('UNCATEGORIZED', { kind: 'proxy_cache_cleanup_failed' }, err)
  }
}

export interface StoreProxyCacheInput {
  keyHash: string
  apiKeyId: string
  provider: string
  ttlSeconds: number
  /** Upstream HTTP status — anything other than 200 is not stored. */
  responseStatus: number
  /** Raw upstream response body text (must be valid JSON — callers gate on
   * a successful JSON.parse before storing). */
  responseBody: string
  usage: CachedUsage
  model: string
}

/**
 * Store a successful upstream response. Guards (non-200, oversized body) make
 * this a silent no-op. Upsert on key_hash so two concurrent misses for the
 * same request don't conflict — last writer wins, both bodies are identical
 * by construction (exact-match key). Never throws — intended for fireAndForget.
 */
export async function storeCachedProxyResponse(input: StoreProxyCacheInput): Promise<void> {
  if (input.responseStatus !== 200) return
  const bodyBytes = new TextEncoder().encode(input.responseBody).byteLength
  if (bodyBytes > PROXY_CACHE_MAX_BODY_BYTES) return

  const now = Date.now()
  try {
    const { error } = await supabaseAdmin
      .from(CACHE_TABLE)
      .upsert(
        {
          key_hash: input.keyHash,
          api_key_id: input.apiKeyId,
          provider: input.provider,
          response_status: input.responseStatus,
          response_body: input.responseBody,
          usage: input.usage,
          model: input.model,
          created_at: new Date(now).toISOString(),
          expires_at: new Date(now + input.ttlSeconds * 1000).toISOString(),
        },
        { onConflict: 'key_hash' },
      )
    if (error) {
      logError('UNCATEGORIZED', { kind: 'proxy_cache_store_failed' }, error)
    }
  } catch (err) {
    logError('UNCATEGORIZED', { kind: 'proxy_cache_store_failed' }, err)
  }
}
