import { createMiddleware } from 'hono/factory'
import type { ApiKeyContext } from './authApiKey.js'
import { checkMonthlyQuota } from '../lib/quota.js'
import { evaluateQuotaPolicy, blockMessage } from '../lib/quota-policy.js'

/**
 * Monthly request quota enforcement for `/proxy/*` (Pattern C policy).
 *
 *   Free plan              over limit → 429 free_limit
 *   Paid, overage=false    over limit → 429 overage_disabled
 *   Paid, overage=true     over limit, under hard cap → pass (overage billed)
 *   Paid, overage=true     at/past hard cap → 429 hard_cap
 *   Enterprise             unlimited → pass
 *
 * Runs AFTER authApiKey (needs organizationId). Response headers:
 *   X-RateLimit-Limit       plan's soft limit
 *   X-RateLimit-Remaining   limit - used (can go negative inside the overage band)
 *   X-RateLimit-Plan        plan string
 *   X-Overage-Active        "true" when the request passed because overage was authorized
 */
export const enforceQuota = createMiddleware<ApiKeyContext>(async (c, next) => {
  const organizationId = c.get('organizationId')
  if (!organizationId) return next() // auth middleware will have already rejected

  const check = await checkMonthlyQuota(organizationId)

  // Re-derive the decision from the raw numbers so we have the block reason
  // and overage flag. `checkMonthlyQuota` already ran the policy; this is
  // cheap + keeps the middleware's decision explicit in one place.
  const decision =
    check.limit === null
      ? ({ action: 'pass', overageActive: false } as const)
      : evaluateQuotaPolicy({
          used: check.usedThisMonth,
          limit: check.limit,
          plan: check.plan,
          allowOverage: check.allowOverage,
          capMultiplier: check.capMultiplier,
        })

  if (decision.action === 'block') {
    c.header('X-RateLimit-Limit', String(check.limit ?? 0))
    c.header('X-RateLimit-Remaining', '0')
    c.header('X-RateLimit-Plan', check.plan)
    return c.json(
      {
        error: blockMessage(decision.reason),
        reason: decision.reason,
        plan: check.plan,
        used: check.usedThisMonth,
        limit: check.limit,
        hard_cap: check.limit !== null ? check.limit * check.capMultiplier : null,
        upgrade_url: 'https://www.spanlens.io/billing',
      },
      429,
    )
  }

  // Passed. Advertise remaining quota + overage status.
  if (check.limit !== null) {
    c.header('X-RateLimit-Limit', String(check.limit))
    c.header('X-RateLimit-Remaining', String(check.limit - check.usedThisMonth))
    c.header('X-RateLimit-Plan', check.plan)
    if (decision.overageActive) c.header('X-Overage-Active', 'true')
  }

  return next()
})
