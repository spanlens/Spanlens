import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { recommendModelSwaps } from '../lib/model-recommend.js'

/**
 * GET /api/v1/recommendations
 *   ?hours=168        analysis window (default 7 days)
 *   ?minSavings=5     only return recommendations projecting ≥ USD savings / month
 *
 * Returns suggested cheaper model substitutions based on the org's request
 * patterns — avg prompt/completion tokens per (provider, model) bucket.
 */

export const recommendationsRouter = new Hono<JwtContext>()

recommendationsRouter.use('*', authJwt)

function parsePositive(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

recommendationsRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const hours = parsePositive(c.req.query('hours'), 24 * 7)
  const minSavingsUsd = parsePositive(c.req.query('minSavings'), 5)

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
