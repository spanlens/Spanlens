import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'
import { parsePositiveInt } from '../lib/params.js'
import { ApiError } from '../lib/errors.js'

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

export interface AuditLogQuery {
  limit: number
  offset: number
  /** Exact match on the `action` column. */
  action?: string | null
  /** Exact match on the actor. Callers must validate the UUID shape first. */
  userId?: string | null
  /** Inclusive lower bound, already normalised to ISO by the caller. */
  from?: string | null
  /** Inclusive upper bound, already normalised to ISO by the caller. */
  to?: string | null
}

/**
 * Shared read for the org's audit trail.
 *
 * Extracted from the GET / handler so `GET /api/v1/dashboard/summary` can
 * serve the dashboard's "Recent activity" strip from the same query. Input
 * validation deliberately stays in the route handler: the composite endpoint
 * builds its own (already-trusted) arguments and has no query string to
 * reject, so it should not pay for — or depend on — HTTP-level parsing.
 */
export async function fetchAuditLogs(
  orgId: string,
  opts: AuditLogQuery,
): Promise<{ rows: AuditLogRow[]; total: number }> {
  let query = supabaseAdmin
    .from('audit_logs')
    .select('id, action, resource_type, resource_id, user_id, metadata, ip_address, created_at', {
      count: 'exact',
    })
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .range(opts.offset, opts.offset + opts.limit - 1)

  if (opts.action) query = query.eq('action', opts.action)
  if (opts.userId) query = query.eq('user_id', opts.userId)
  if (opts.from) query = query.gte('created_at', opts.from)
  if (opts.to) query = query.lte('created_at', opts.to)

  const { data, error, count } = await query

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to fetch audit logs')

  return { rows: (data ?? []) as AuditLogRow[], total: count ?? 0 }
}

auditLogsRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const limit = Math.min(parsePositiveInt(c.req.query('limit'), 50), 200)
  const offset = parsePositiveInt(c.req.query('offset'), 0)
  const actionFilter = c.req.query('action')?.trim() || null
  const userIdFilter = c.req.query('user_id')?.trim() || null

  if (userIdFilter && !UUID_RE.test(userIdFilter)) {
    throw new ApiError('VALIDATION_FAILED', 'user_id must be a UUID')
  }

  const fromIso = parseIsoBound(c.req.query('from'))
  const toIso = parseIsoBound(c.req.query('to'))
  if (fromIso === 'invalid') throw new ApiError('VALIDATION_FAILED', 'invalid `from` timestamp')
  if (toIso === 'invalid') throw new ApiError('VALIDATION_FAILED', 'invalid `to` timestamp')

  const { rows, total } = await fetchAuditLogs(orgId, {
    limit,
    offset,
    action: actionFilter,
    userId: userIdFilter,
    from: fromIso,
    to: toIso,
  })

  return c.json({
    success: true,
    data: rows,
    meta: { total, limit, offset },
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
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  // Postgrest doesn't expose DISTINCT — we cap to last 1000 rows + dedupe
  // in JS. Beyond that the dropdown would be unusable anyway.
  const { data, error } = await supabaseAdmin
    .from('audit_logs')
    .select('action')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(1000)

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to fetch actions')

  const unique = Array.from(new Set((data ?? []).map((r) => r.action))).sort()
  return c.json({ success: true, data: unique })
})
