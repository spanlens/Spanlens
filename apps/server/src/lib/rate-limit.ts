import { Redis } from '@upstash/redis'
import { Ratelimit } from '@upstash/ratelimit'
import type { Plan } from './quota.js'

/**
 * Per-minute proxy ingestion limits keyed by plan.
 *
 * Applied per organization (all API keys in the same org share the bucket).
 * Enterprise is unlimited (null).
 */
export const PROXY_RATE_LIMITS: Record<Plan, number | null> = {
  free:       60,
  starter:    300,
  team:       1_500,
  enterprise: null,
}

/**
 * Unified per-minute limit for all dashboard API routes (/api/v1/*).
 *
 * Same for every plan — dashboard usage is human-paced so this only
 * ever triggers against scrapers or runaway automation.
 */
export const API_RATE_LIMIT = 120

// ---------------------------------------------------------------------------
// Redis singleton — lazy init so the module is safe to import without env vars
// ---------------------------------------------------------------------------

let _redis: Redis | null = null

function getRedis(): Redis | null {
  if (_redis) return _redis

  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN

  if (!url || !token) return null

  _redis = new Redis({ url, token })
  return _redis
}

// ---------------------------------------------------------------------------
// Ratelimit instances — one per unique limit value (free/starter/team/api)
// ---------------------------------------------------------------------------

const _limiters = new Map<number, Ratelimit>()

function getLimiter(limit: number): Ratelimit | null {
  const redis = getRedis()
  if (!redis) return null

  if (!_limiters.has(limit)) {
    _limiters.set(
      limit,
      new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(limit, '60 s'),
        // Prefix all keys so they don't collide with other Redis data
        prefix: 'spanlens:rl',
      }),
    )
  }

  return _limiters.get(limit)!
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Checks whether `key` is within the sliding-window rate limit.
 *
 * Returns true (allow) when:
 *   - the request is within the limit
 *   - Redis is not configured (fails open — transient misconfiguration
 *     should never block legitimate traffic)
 *   - any Redis error occurs (fails open with a console warning)
 *
 * Returns false (deny) only when the limit is positively exceeded.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
): Promise<boolean> {
  const limiter = getLimiter(limit)

  if (!limiter) {
    // Redis not configured — fail open (dev / misconfigured prod)
    return true
  }

  try {
    const { success } = await limiter.limit(key)
    return success
  } catch (err) {
    console.error('[rate-limit] Redis error — failing open:', err)
    return true
  }
}
