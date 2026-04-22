import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { detectAnomalies } from '../lib/anomaly.js'

/**
 * GET /api/v1/anomalies
 *   ?observationHours=1          (default 1)
 *   &referenceHours=168          (default 7 days)
 *   &sigma=3                     (default 3)
 *   &projectId=<uuid>            (optional scope)
 *
 * Returns the provider/model buckets whose recent latency or cost deviates
 * past the threshold from their 7-day baseline.
 */

export const anomaliesRouter = new Hono<JwtContext>()

anomaliesRouter.use('*', authJwt)

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

anomaliesRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const observationHours = parsePositiveNumber(c.req.query('observationHours'), 1)
  const referenceHours = parsePositiveNumber(c.req.query('referenceHours'), 24 * 7)
  const sigmaThreshold = parsePositiveNumber(c.req.query('sigma'), 3)
  const projectId = c.req.query('projectId')

  const anomalies = await detectAnomalies(orgId, {
    observationHours,
    referenceHours,
    sigmaThreshold,
    ...(projectId ? { projectId } : {}),
  })

  return c.json({
    success: true,
    data: anomalies,
    meta: {
      observationHours,
      referenceHours,
      sigmaThreshold,
      count: anomalies.length,
    },
  })
})
