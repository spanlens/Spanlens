import { createMiddleware } from 'hono/factory'
import { sha256Hex } from '../lib/crypto.js'
import { checkRateLimit, PROXY_RATE_LIMITS, API_RATE_LIMIT } from '../lib/rate-limit.js'
import type { ApiKeyContext } from './authApiKey.js'
import type { JwtContext } from './authJwt.js'

/**
 * Per-minute rate limit for proxy routes (plan-aware).
 *
 * Must run AFTER authApiKey (needs organizationId + plan in context).
 * Reads the org's plan straight off c.get('plan') — authApiKey caches
 * the plan together with the auth lookup and writes it to context,
 * so this middleware no longer needs a second `organizations` SELECT.
 * Pre-R-5 every proxy request was 2 round-trips (api_keys + plan);
 * post-R-5 it's 1 round-trip (cached) or 0 (cache hit).
 *
 *   free       →    60 req/min
 *   starter    →   300 req/min
 *   team       → 1,500 req/min
 *   enterprise → unlimited
 *
 * All API keys within the same organization share one bucket, so a team
 * that issues multiple keys cannot multiply its quota.
 *
 * Fails open when context is missing (defensive — authApiKey should
 * always populate plan, but a route that mounts proxyRateLimit without
 * the auth gate would otherwise crash).
 */
export const proxyRateLimit = createMiddleware<ApiKeyContext>(async (c, next) => {
  const organizationId = c.get('organizationId')
  if (!organizationId) return next()

  // Plan is hoisted onto context by authApiKey (R-4/R-5). Default to
  // 'free' if for any reason it wasn't set — same fail-open behaviour
  // the old DB lookup had on errors.
  const plan = c.get('plan') ?? 'free'
  const limit = PROXY_RATE_LIMITS[plan]

  // Enterprise has no per-minute limit
  if (limit === null) return next()

  const allowed = await checkRateLimit(`proxy:${organizationId}`, limit)

  // R-5: surface the standard three headers on every response so
  // clients can implement adaptive backoff without us telling them.
  // X-RateLimit-Reset is a unix epoch second (per the conventional
  // header semantics), aligned to the start of the next minute window
  // — that's the natural reset boundary for a per-minute bucket.
  const nowSec = Math.floor(Date.now() / 1000)
  const resetAt = (Math.floor(nowSec / 60) + 1) * 60
  c.header('X-RateLimit-Limit', String(limit))
  c.header('X-RateLimit-Window', '60s')
  c.header('X-RateLimit-Reset', String(resetAt))

  if (!allowed) {
    c.header('X-RateLimit-Remaining', '0')
    c.header('Retry-After', '60')
    return c.json(
      {
        error: `Rate limit exceeded: ${limit} requests/min on the ${plan} plan. Upgrade or retry after 60 seconds.`,
        limit,
        window: '60s',
        upgrade_url: 'https://www.spanlens.io/pricing',
      },
      429,
    )
  }

  // For successful requests we don't know the exact remaining count
  // without bouncing through the rate-limit store, but signalling
  // "at least one slot is left" via the standard header is more useful
  // to clients than omitting the field entirely.
  c.header('X-RateLimit-Remaining', String(Math.max(0, limit - 1)))
  return next()
})

/**
 * Per-minute rate limit for dashboard API routes (/api/v1/*).
 *
 * Unified across all plans (120 req/min) — normal dashboard usage
 * never approaches this; it only triggers against scrapers or runaway
 * automation scripts.
 *
 * Uses a hash of the Bearer token as the rate-limit key so it can
 * run at the app level (before authJwt resolves the userId/orgId).
 * The hash changes on token refresh, which is acceptable — a new
 * token gets a fresh bucket.
 *
 * Fails open when no Authorization header is present so that public
 * endpoints (e.g. /api/v1/waitlist) are unaffected.
 */
export const apiRateLimit = createMiddleware<JwtContext>(async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return next()

  const token = authHeader.slice(7)
  const tokenHash = await sha256Hex(token)

  const allowed = await checkRateLimit(`api:${tokenHash}`, API_RATE_LIMIT)

  const nowSec = Math.floor(Date.now() / 1000)
  const resetAt = (Math.floor(nowSec / 60) + 1) * 60
  c.header('X-RateLimit-Limit', String(API_RATE_LIMIT))
  c.header('X-RateLimit-Window', '60s')
  c.header('X-RateLimit-Reset', String(resetAt))

  if (!allowed) {
    c.header('X-RateLimit-Remaining', '0')
    c.header('Retry-After', '60')
    return c.json(
      {
        error: `API rate limit exceeded: ${API_RATE_LIMIT} requests/min. Retry after 60 seconds.`,
        limit: API_RATE_LIMIT,
        window: '60s',
      },
      429,
    )
  }

  c.header('X-RateLimit-Remaining', String(Math.max(0, API_RATE_LIMIT - 1)))
  return next()
})
