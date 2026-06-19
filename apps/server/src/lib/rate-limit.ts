import { Redis } from '@upstash/redis'
import { Ratelimit } from '@upstash/ratelimit'
import type { Plan } from './quota.js'
import { logError, logWarn } from './structured-logger.js'

/**
 * Per-minute proxy ceilings keyed by plan.
 *
 * Applied per organization (all API keys in the same org share the bucket).
 * Enterprise is unlimited (null).
 *
 * These are pure anti-runaway ceilings, NOT a monetization lever — monetization
 * lives entirely in the monthly quota (enforceQuota, which runs right after
 * proxyRateLimit on every proxy request). BYOK means we bear no LLM cost on
 * overage, and the proxy is the customer's critical path, so the ceilings are
 * set ~10x a realistic sustained rate and overage no longer hard-rejects
 * (see proxyRateLimit in middleware/rateLimit.ts). Each is env-overridable so
 * the ceiling can be tuned without a deploy.
 */
function ceilingFromEnv(envVar: string, fallback: number): number {
  const raw = process.env[envVar]
  if (raw == null || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export const PROXY_RATE_LIMITS: Record<Plan, number | null> = {
  free:       ceilingFromEnv('PROXY_RATE_LIMIT_FREE',    600),
  starter:    ceilingFromEnv('PROXY_RATE_LIMIT_STARTER', 3_000),
  team:       ceilingFromEnv('PROXY_RATE_LIMIT_TEAM',    15_000),
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

// Module-level guard so a misconfigured prod (missing KV env vars) warns ONCE
// rather than on every request. Reset implicitly per process / per test
// (vi.resetModules drops this module's state).
let _unconfiguredWarned = false

/**
 * Checks whether `key` is within the sliding-window rate limit.
 *
 * Returns true (allow) when:
 *   - the request is within the limit
 *   - Redis is not configured (fails open — transient misconfiguration
 *     should never block legitimate traffic)
 *   - any Redis error occurs (fails open)
 *
 * Returns false (deny) only when the limit is positively exceeded.
 *
 * Fail-open is RETAINED on both backend-down paths (a Redis outage must never
 * block legitimate traffic), but both are now emitted with the stable,
 * alertable `RATE_LIMIT_BACKEND_DOWN` code so a silent outage is visible in
 * the log drain / Sentry instead of disappearing. No in-process fallback
 * counter is added here — see docs/plans/platform-review-roadmap-2026-06.md.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
): Promise<boolean> {
  const limiter = getLimiter(limit)

  if (!limiter) {
    // Redis not configured — fail open (dev / misconfigured prod). Warn once
    // so a prod deploy missing KV_REST_API_URL/TOKEN does not silently
    // disable ALL rate limiting with zero signal.
    if (!_unconfiguredWarned) {
      _unconfiguredWarned = true
      logWarn('RATE_LIMIT_BACKEND_DOWN', { kind: 'redis_unconfigured' })
    }
    return true
  }

  try {
    const { success } = await limiter.limit(key)
    return success
  } catch (err) {
    // Transient Redis error — fail open, but with a stable code (was a
    // free-form console.error before, which Sentry could not alert on).
    logError('RATE_LIMIT_BACKEND_DOWN', { kind: 'redis_error', key }, err)
    return true
  }
}
