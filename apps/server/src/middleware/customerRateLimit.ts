import { createMiddleware } from 'hono/factory'
import type { ApiKeyContext } from './authApiKey.js'
import { getCustomerLimits, type CustomerLimit, type CustomerLimitScope } from '../lib/customer-limits.js'
import { checkRateLimit } from '../lib/rate-limit.js'
import { ApiError } from '../lib/errors.js'

/**
 * Customer-configurable rate limiting (Phase 2).
 *
 * Mounted AFTER proxyRateLimit + enforceQuota in every proxy, so our platform
 * ceiling and the monthly monetization gate run first. This enforces limits the
 * CUSTOMER set on their own key / project / end-users.
 *
 * Unlike proxyRateLimit (Phase 1, pass-through anti-runaway), exceeding a
 * customer-set limit DOES return 429 to the end-user — the customer configured
 * it precisely to throttle their own traffic. The 429 carries
 * details.source='customer_limit' and no Spanlens upgrade_url, so it is
 * distinguishable from a platform/plan limit.
 *
 * Hot path: a key with no configured limit short-circuits after one cached Map
 * lookup (zero Redis, zero DB). Keys with limits do 1-3 Redis calls. Fails open
 * if Redis is unavailable (checkRateLimit) — a customer throttle is best-effort,
 * not a hard security boundary, and an outage must not break their traffic.
 */
export const customerRateLimit = createMiddleware<ApiKeyContext>(async (c, next) => {
  const apiKeyId = c.get('apiKeyId')
  // Defensive: authApiKey always sets apiKeyId before this runs.
  if (!apiKeyId) return next()

  const projectId = c.get('projectId') ?? null
  const limits = await getCustomerLimits(apiKeyId, projectId)
  if (limits.empty) return next()

  const endUserId = c.req.header('x-spanlens-user') || null

  // Most-specific first; the first DENY wins (all applicable limits must pass).
  const checks: Array<{ scope: CustomerLimitScope; key: string; limit: CustomerLimit }> = []
  if (endUserId) {
    const eu = limits.endUserLimits.get(endUserId)
    if (eu) checks.push({ scope: 'end_user', key: `custlimit:eu:${apiKeyId}:${endUserId}`, limit: eu })
  }
  if (limits.keyLimit) {
    checks.push({ scope: 'api_key', key: `custlimit:key:${apiKeyId}`, limit: limits.keyLimit })
  }
  if (limits.projectLimit && projectId) {
    checks.push({ scope: 'project', key: `custlimit:proj:${projectId}`, limit: limits.projectLimit })
  }

  for (const { scope, key, limit } of checks) {
    const allowed = await checkRateLimit(key, limit.maxRequests, limit.windowSeconds)
    if (!allowed) {
      c.header('Retry-After', String(limit.windowSeconds))
      c.header('X-Spanlens-RateLimit-Scope', scope)
      c.header('X-Spanlens-RateLimit-Remaining', '0')
      throw new ApiError(
        'RATE_LIMIT',
        `Customer-configured rate limit exceeded (${scope}): ${limit.maxRequests} requests per ${limit.windowSeconds}s.`,
        {
          source: 'customer_limit',
          scope,
          limit: limit.maxRequests,
          window_seconds: limit.windowSeconds,
          ...(scope === 'end_user' && endUserId ? { end_user_id: endUserId } : {}),
        },
      )
    }
  }

  return next()
})
