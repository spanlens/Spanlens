import { Hono } from 'hono'
import type { JwtContext } from '../middleware/authJwt.js'
import { authJwtOrApiKey } from '../middleware/authJwtOrApiKey.js'
import { recommendModelSwaps, getTokenPercentiles } from '../lib/model-recommend.js'
import { getCacheSavings } from '../lib/cache-savings.js'
import { parsePositiveFloat } from '../lib/params.js'
import { ApiError } from '../lib/errors.js'

/**
 * GET /api/v1/recommendations
 *   ?hours=168        analysis window (default 7 days)
 *   ?minSavings=5     only return recommendations projecting ≥ USD savings / month
 *
 * Returns suggested cheaper model substitutions based on the org's request
 * patterns — avg prompt/completion tokens per (provider, model) bucket.
 * Each item also includes `achieved`, `priorWindowCostUsd`, and
 * `actualMonthlySavingsUsd` for models whose spend dropped ≥70% vs the
 * prior comparable window.
 *
 * GET /api/v1/recommendations/percentiles
 *   ?provider=openai  required
 *   ?model=gpt-4o     required (can be a dated variant)
 *   ?hours=168        analysis window (default 7 days)
 *
 * Returns P50/P95/P99 token distribution for the given model, used by the
 * Savings "Simulate" dialog to visualise how actual token usage compares to
 * the substitute envelope. Lazy-fetched only when the dialog opens.
 */

export const recommendationsRouter = new Hono<JwtContext>()

recommendationsRouter.use('*', authJwtOrApiKey)


// ── Shape returned by the percentiles query ──────────────────────────────────
//
// `percentile_cont` yields `double precision`, which the driver parses into a
// JS number, while `count(*)` is `int8` and arrives as a string to avoid
// precision loss. Both are coerced with `Number()` below rather than trusted.

// ── Routes ───────────────────────────────────────────────────────────────────

recommendationsRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const hours = parsePositiveFloat(c.req.query('hours'), 24 * 7)
  const minSavingsUsd = parsePositiveFloat(c.req.query('minSavings'), 5)

  const recommendations = await recommendModelSwaps(orgId, { hours, minSavingsUsd })
  return c.json({
    success: true,
    data: recommendations,
    meta: {
      hours,
      minSavingsUsd,
      count: recommendations.length,
    },
  })
})

/**
 * GET /api/v1/recommendations/cache-savings
 *
 * Month-to-date USD saved by prompt caching (cached input tokens billed at
 * the provider's discounted cache-read rate instead of the full input rate).
 * Powers the "Prompt caching saved you $X this month" card on /savings.
 */
recommendationsRouter.get('/cache-savings', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  try {
    const summary = await getCacheSavings(orgId)
    return c.json({ success: true, data: summary })
  } catch (err) {
    console.error('cache-savings failed', err)
    throw new ApiError('INTERNAL_ERROR', 'Failed to compute cache savings')
  }
})

recommendationsRouter.get('/percentiles', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const provider = c.req.query('provider')
  const model    = c.req.query('model')
  const hours    = parsePositiveFloat(c.req.query('hours'), 24 * 7)

  if (!provider || provider.length > 64) {
    throw new ApiError('VALIDATION_FAILED', 'provider is required (max 64 chars)')
  }
  if (!model || model.length > 128) {
    throw new ApiError('VALIDATION_FAILED', 'model is required (max 128 chars)')
  }

  try {
    const data = await getTokenPercentiles(orgId, { provider, model, hours })
    return c.json({ success: true, data })
  } catch (err) {
    console.error('percentiles failed', err)
    throw new ApiError('INTERNAL_ERROR', 'Failed to compute token percentiles')
  }
})
