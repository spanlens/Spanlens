import { supabaseAdmin } from './db.js'

/**
 * Customer-configured rate limits (Phase 2). Read on the proxy hot path, so the
 * lookup is cached per Spanlens key with a short TTL + request coalescing,
 * mirroring the plan cache in requests-query.ts and the auth cache in
 * authApiKey.ts. The common case (a key with NO configured limit) caches the
 * empty result too, so it costs one Map lookup and zero DB round-trips.
 *
 * Config rows live in the `customer_rate_limits` table (migration
 * 20260619000000). Enforcement is in middleware/customerRateLimit.ts.
 */

export type CustomerLimitScope = 'api_key' | 'project' | 'end_user'

export interface CustomerLimit {
  readonly scope: CustomerLimitScope
  readonly maxRequests: number
  readonly windowSeconds: number
}

export interface ResolvedCustomerLimits {
  /** Cap on all traffic through this Spanlens key. */
  readonly keyLimit: CustomerLimit | null
  /** Cap across every key in the key's project. */
  readonly projectLimit: CustomerLimit | null
  /** Per-end-user caps for this key, keyed by the x-spanlens-user value. */
  readonly endUserLimits: ReadonlyMap<string, CustomerLimit>
  /** True when nothing is configured — lets the middleware short-circuit. */
  readonly empty: boolean
}

interface CachedLimits extends ResolvedCustomerLimits {
  expiresAt: number
}

const TTL_MS = 30 * 1000 // 30s — matches getOrgPlan; downgrades apply quickly
const cache = new Map<string, CachedLimits>()
const inflight = new Map<string, Promise<CachedLimits>>()

const EMPTY: ResolvedCustomerLimits = {
  keyLimit: null,
  projectLimit: null,
  endUserLimits: new Map(),
  empty: true,
}

interface LimitRow {
  target_type: CustomerLimitScope
  end_user_id: string | null
  max_requests: number | string
  window_seconds: number | string
}

/**
 * Resolves all active limits relevant to a request: the key-level limit and
 * the key's end-user limits (both keyed on api_key_id), plus the project-level
 * limit (keyed on project_id). Cached per apiKeyId.
 *
 * Falls back to the empty set on any lookup error — a config-read blip must
 * never break the customer's proxy traffic.
 */
export async function getCustomerLimits(
  apiKeyId: string,
  projectId: string | null,
): Promise<ResolvedCustomerLimits> {
  const cached = cache.get(apiKeyId)
  if (cached && cached.expiresAt > Date.now()) return cached

  const existing = inflight.get(apiKeyId)
  if (existing) return existing

  const fetchPromise = (async (): Promise<CachedLimits> => {
    try {
      let query = supabaseAdmin
        .from('customer_rate_limits')
        .select('target_type, end_user_id, max_requests, window_seconds')
        .eq('is_active', true)
      query = projectId
        ? query.or(`api_key_id.eq.${apiKeyId},project_id.eq.${projectId}`)
        : query.eq('api_key_id', apiKeyId)

      const { data, error } = await query
      if (error) throw error

      const rows = (data ?? []) as LimitRow[]
      let keyLimit: CustomerLimit | null = null
      let projectLimit: CustomerLimit | null = null
      const endUserLimits = new Map<string, CustomerLimit>()

      for (const r of rows) {
        const limit: CustomerLimit = {
          scope: r.target_type,
          maxRequests: Number(r.max_requests),
          windowSeconds: Number(r.window_seconds),
        }
        if (r.target_type === 'api_key') keyLimit = limit
        else if (r.target_type === 'project') projectLimit = limit
        else if (r.target_type === 'end_user' && r.end_user_id) {
          endUserLimits.set(r.end_user_id, limit)
        }
      }

      const resolved: CachedLimits = {
        keyLimit,
        projectLimit,
        endUserLimits,
        empty: !keyLimit && !projectLimit && endUserLimits.size === 0,
        expiresAt: Date.now() + TTL_MS,
      }
      cache.set(apiKeyId, resolved)
      return resolved
    } catch {
      // Fail open: cache an empty set briefly so a transient error does not
      // hammer the DB on every request, and never block proxy traffic.
      const fallback: CachedLimits = { ...EMPTY, endUserLimits: new Map(), expiresAt: Date.now() + TTL_MS }
      cache.set(apiKeyId, fallback)
      return fallback
    } finally {
      inflight.delete(apiKeyId)
    }
  })()

  inflight.set(apiKeyId, fetchPromise)
  return fetchPromise
}

/** Invalidate the cache for one key after a CRUD write touching it. */
export function invalidateCustomerLimitsCache(apiKeyId: string): void {
  cache.delete(apiKeyId)
  inflight.delete(apiKeyId)
}

/**
 * Flush the whole cache. Used after a project-level write (which affects every
 * key under the project — we don't track that mapping in-process) and by tests.
 */
export function resetCustomerLimitsCache(): void {
  cache.clear()
  inflight.clear()
}
