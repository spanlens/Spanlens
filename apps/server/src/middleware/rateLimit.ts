import { createMiddleware } from 'hono/factory'
import { supabaseAdmin } from '../lib/db.js'
import { sha256Hex } from '../lib/crypto.js'
import { checkRateLimit, PROXY_RATE_LIMITS, API_RATE_LIMIT } from '../lib/rate-limit.js'
import type { ApiKeyContext } from './authApiKey.js'
import type { JwtContext } from './authJwt.js'
import type { Plan } from '../lib/quota.js'

/**
 * Per-minute rate limit for proxy routes (plan-aware).
 *
 * Must run AFTER authApiKey (needs organizationId in context).
 * Fetches the org's plan to determine the applicable limit:
 *
 *   free       →    60 req/min
 *   starter    →   300 req/min
 *   team       → 1,500 req/min
 *   enterprise → unlimited
 *
 * All API keys within the same organization share one bucket, so a team
 * that issues multiple keys cannot multiply its quota.
 *
 * Fails open on DB errors to avoid blocking traffic during outages.
 */
export const proxyRateLimit = createMiddleware<ApiKeyContext>(async (c, next) => {
  const organizationId = c.get('organizationId')
  if (!organizationId) return next()

  // Fetch the org's plan for limit lookup
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('plan')
    .eq('id', organizationId)
    .single()

  const plan = ((org?.plan as Plan | undefined) ?? 'free') as Plan
  const limit = PROXY_RATE_LIMITS[plan]

  // Enterprise has no per-minute limit
  if (limit === null) return next()

  const allowed = await checkRateLimit(`proxy:${organizationId}`, limit)

  c.header('X-RateLimit-Limit', String(limit))
  c.header('X-RateLimit-Window', '60s')

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

  c.header('X-RateLimit-Limit', String(API_RATE_LIMIT))
  c.header('X-RateLimit-Window', '60s')

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

  return next()
})
