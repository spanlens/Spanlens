import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'
import { parsePositiveInt } from '../lib/params.js'

/**
 * Audit log endpoints. The `audit_logs` table is INSERT-by-service-role only
 * (RLS lets org members SELECT). Rows are written throughout the codebase
 * whenever a meaningful action happens (api_key.create, provider_key.add,
 * billing.plan.change, etc.).
 *
 *   GET /api/v1/audit-logs?limit=50&offset=0
 *       &action=api_key.create
 *       &user_id=<uuid>
 *       &from=<iso>&to=<iso>
 *
 * Response envelope: { data: AuditLogRow[], meta: { total, limit, offset } }
 *
 * `from` / `to` are inclusive ISO timestamps. `user_id` matches the
 * `user_id` column exactly (which is null for service-role-only writes
 * like cron jobs and webhook deliveries — those rows are only returnable
 * by leaving user_id unset).
 */

export const auditLogsRouter = new Hono<JwtContext>()

auditLogsRouter.use('*', authJwt)


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

// Reject bogus ISO inputs with 400 so callers see a clear error rather than
// silently getting "no results". Returns the trimmed/validated string or
// null when the caller passed nothing.
function parseIsoBound(value: string | undefined): string | null | 'invalid' {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Date.parse(trimmed)
  if (Number.isNaN(parsed)) return 'invalid'
  return new Date(parsed).toISOString()
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

auditLogsRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const limit = Math.min(parsePositiveInt(c.req.query('limit'), 50), 200)
  const offset = parsePositiveInt(c.req.query('offset'), 0)
  const actionFilter = c.req.query('action')?.trim() || null
  const userIdFilter = c.req.query('user_id')?.trim() || null

  if (userIdFilter && !UUID_RE.test(userIdFilter)) {
    return c.json({ error: 'user_id must be a UUID' }, 400)
  }

  const fromIso = parseIsoBound(c.req.query('from'))
  const toIso = parseIsoBound(c.req.query('to'))
  if (fromIso === 'invalid') return c.json({ error: 'invalid `from` timestamp' }, 400)
  if (toIso === 'invalid') return c.json({ error: 'invalid `to` timestamp' }, 400)

  let query = supabaseAdmin
    .from('audit_logs')
    .select('id, action, resource_type, resource_id, user_id, metadata, ip_address, created_at', {
      count: 'exact',
    })
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (actionFilter) query = query.eq('action', actionFilter)
  if (userIdFilter) query = query.eq('user_id', userIdFilter)
  if (fromIso) query = query.gte('created_at', fromIso)
  if (toIso) query = query.lte('created_at', toIso)

  const { data, error, count } = await query

  if (error) return c.json({ error: 'Failed to fetch audit logs' }, 500)

  return c.json({
    success: true,
    data: (data ?? []) as AuditLogRow[],
    meta: { total: count ?? 0, limit, offset },
  })
})

/**
 * GET /api/v1/audit-logs/actions
 *
 * Returns the distinct list of `action` values seen on this org's audit
 * trail so the dashboard can populate the filter dropdown without hardcoding.
 * Cheap because audit_logs has an action column index from the original
 * migration, and the org filter caps the scan to one tenant.
 */
auditLogsRouter.get('/actions', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  // Postgrest doesn't expose DISTINCT — we cap to last 1000 rows + dedupe
  // in JS. Beyond that the dropdown would be unusable anyway.
  const { data, error } = await supabaseAdmin
    .from('audit_logs')
    .select('action')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(1000)

  if (error) return c.json({ error: 'Failed to fetch actions' }, 500)

  const unique = Array.from(new Set((data ?? []).map((r) => r.action))).sort()
  return c.json({ success: true, data: unique })
})
