import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'

/**
 * Audit log endpoints. The `audit_logs` table is INSERT-by-service-role only
 * (RLS lets org members SELECT). Rows are written throughout the codebase
 * whenever a meaningful action happens (api_key.create, provider_key.add,
 * billing.plan.change, etc.).
 *
 *   GET /api/v1/audit-logs?limit=50&offset=0&action=api_key.create
 */

export const auditLogsRouter = new Hono<JwtContext>()

auditLogsRouter.use('*', authJwt)

function parseIntSafe(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

export interface AuditLogRow {
  id: string
  action: string
  resource_type: string
  resource_id: string | null
  user_id: string | null
  metadata: Record<string, unknown> | null
  ip_address: string | null
  created_at: string
}

auditLogsRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const limit = Math.min(parseIntSafe(c.req.query('limit'), 50), 200)
  const offset = parseIntSafe(c.req.query('offset'), 0)
  const actionFilter = c.req.query('action')

  let query = supabaseAdmin
    .from('audit_logs')
    .select('id, action, resource_type, resource_id, user_id, metadata, ip_address, created_at', {
      count: 'exact',
    })
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (actionFilter) query = query.eq('action', actionFilter)

  const { data, error, count } = await query

  if (error) return c.json({ error: 'Failed to fetch audit logs' }, 500)

  return c.json({
    success: true,
    data: (data ?? []) as AuditLogRow[],
    meta: { total: count ?? 0, limit, offset },
  })
})
