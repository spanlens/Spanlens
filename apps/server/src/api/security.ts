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

interface FlagRow {
  flags: Array<{ type: string; pattern: string }>
}

// GET /api/v1/security/summary?hours=24
securityRouter.get('/summary', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const hours = parseIntSafe(c.req.query('hours'), 24)
  const windowStart = new Date(Date.now() - hours * 3_600_000).toISOString()

  const { data, error } = await supabaseAdmin
    .from('requests')
    .select('flags')
    .eq('organization_id', orgId)
    .not('flags', 'eq', '[]')
    .gte('created_at', windowStart)

  if (error) return c.json({ error: 'Failed to compute summary' }, 500)

  // Fold into a per-pattern counter
  const byPattern = new Map<string, { type: string; pattern: string; count: number }>()
  for (const row of (data ?? []) as FlagRow[]) {
    for (const f of row.flags) {
      const key = `${f.type}:${f.pattern}`
      const existing = byPattern.get(key) ?? { type: f.type, pattern: f.pattern, count: 0 }
      existing.count += 1
      byPattern.set(key, existing)
    }
  }

  const summary = [...byPattern.values()].sort((a, b) => b.count - a.count)
  const totalFlaggedRequests = (data ?? []).length

  return c.json({
    success: true,
    data: summary,
    meta: { hours, totalFlaggedRequests },
  })
})
