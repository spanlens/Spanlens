import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'

/**
 * Security endpoints for exposing the security-scan findings that
 * lib/logger.ts attached to `requests.flags`.
 *
 *   GET /api/v1/security/flagged      list recent flagged requests (paginated)
 *   GET /api/v1/security/summary      counts by flag type/pattern over a window
 */

export const securityRouter = new Hono<JwtContext>()

securityRouter.use('*', authJwt)

function parseIntSafe(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

// GET /api/v1/security/flagged?limit=50&offset=0&type=pii|injection
securityRouter.get('/flagged', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const limit = Math.min(parseIntSafe(c.req.query('limit'), 50), 200)
  const offset = parseIntSafe(c.req.query('offset'), 0) - 1 < 0 ? 0 : parseIntSafe(c.req.query('offset'), 0)

  const { data, error, count } = await supabaseAdmin
    .from('requests')
    .select('id, provider, model, status_code, latency_ms, cost_usd, flags, created_at', { count: 'exact' })
    .eq('organization_id', orgId)
    .not('flags', 'eq', '[]') // JSONB: rows where flags is not empty array
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return c.json({ error: 'Failed to fetch flagged requests' }, 500)

  return c.json({
    success: true,
    data: data ?? [],
    meta: { total: count ?? 0, limit, offset },
  })
})

interface SummaryRow {
  flag_type: string
  pattern: string
  count: number
}

// GET /api/v1/security/summary?hours=24
// Uses the `security_summary` Postgres function — LATERAL jsonb_array_elements
// + GROUP BY on the server side. Replaces the earlier "fetch all flagged
// rows, fold in JS" pattern which scaled linearly with flagged-row count.
securityRouter.get('/summary', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const hours = parseIntSafe(c.req.query('hours'), 24)

  const { data, error } = await supabaseAdmin.rpc('security_summary', {
    p_org_id: orgId,
    p_hours: hours,
  })

  if (error) return c.json({ error: 'Failed to compute summary' }, 500)

  const rows = (data as SummaryRow[] | null) ?? []
  const summary = rows.map((r) => ({
    type: r.flag_type,
    pattern: r.pattern,
    count: Number(r.count),
  }))
  const totalFlaggedRequests = summary.reduce((s, r) => s + r.count, 0)

  return c.json({
    success: true,
    data: summary,
    meta: { hours, totalFlaggedRequests },
  })
})
