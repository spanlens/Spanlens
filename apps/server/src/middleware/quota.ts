import { createMiddleware } from 'hono/factory'
import type { ApiKeyContext } from './authApiKey.js'
import { checkMonthlyQuota } from '../lib/quota.js'

/**
 * Monthly request quota enforcement for `/proxy/*`.
 *
 * Runs AFTER authApiKey (needs organizationId). On over-quota returns 429
 * with a JSON body the client can surface to the user (and the Spanlens
 * dashboard shows the same limit).
 */
export const enforceQuota = createMiddleware<ApiKeyContext>(async (c, next) => {
  const organizationId = c.get('organizationId')
  if (!organizationId) return next() // auth middleware will have already rejected

  const check = await checkMonthlyQuota(organizationId)
  if (!check.allowed) {
    c.header('X-RateLimit-Limit', String(check.limit ?? 0))
    c.header('X-RateLimit-Remaining', '0')
    c.header('X-RateLimit-Plan', check.plan)
    return c.json(
      {
        error: 'Monthly request quota exceeded',
        plan: check.plan,
        used: check.usedThisMonth,
        limit: check.limit,
        upgrade_url: 'https://spanlens-web.vercel.app/billing',
      },
      429,
    )
  }

  // Advertise remaining quota on every successful proxy call — free-plan
  // clients can build their own "approaching limit" UI from these headers.
  if (check.limit !== null) {
    c.header('X-RateLimit-Limit', String(check.limit))
    c.header('X-RateLimit-Remaining', String(check.limit - check.usedThisMonth))
    c.header('X-RateLimit-Plan', check.plan)
  }

  return next()
})
