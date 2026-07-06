import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { requireRole } from '../middleware/requireRole.js'
import { supabaseAdmin } from '../lib/db.js'
import { requestsScope, selectRequests, countRequests } from '../lib/requests-query.js'
import { fromClickhouseTimestamp } from '../lib/clickhouse.js'
import { getSecuritySummary } from '../lib/stats-queries.js'
import { parseIntMin, parsePositiveInt } from '../lib/params.js'
import { ApiError } from '../lib/errors.js'

/**
 * Security endpoints:
 *
 *   GET  /api/v1/security/flagged              list recent flagged requests (paginated)
 *   GET  /api/v1/security/summary              counts by flag type/pattern over a window
 *   GET  /api/v1/security/settings             org alert + per-project block settings
 *   PATCH /api/v1/security/alert               toggle org-level security alert emails
 *   PATCH /api/v1/security/projects/:id/block  toggle per-project injection blocking
 */

export const securityRouter = new Hono<JwtContext>()

securityRouter.use('*', authJwt)

// Org-wide security toggles are admin-only (matches organizations.ts
// branding/security PATCH gating). Reads stay open to viewers.
const requireAdmin = requireRole('admin')

// GET /api/v1/security/flagged?limit=50&offset=0
securityRouter.get('/flagged', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const limit = Math.min(parsePositiveInt(c.req.query('limit'), 50), 200)
  const offset = parseIntMin(c.req.query('offset'), 0, 0)

  interface FlaggedRow {
    id: string
    provider: string
    model: string
    status_code: number
    latency_ms: number
    cost_usd: string | number | null
    flags: string
    response_flags: string
    created_at: string
  }
  try {
    const scope = await requestsScope(orgId)
    const [rows, total] = await Promise.all([
      selectRequests<FlaggedRow>({
        scope,
        select: 'id, provider, model, status_code, latency_ms, cost_usd, flags, response_flags, created_at',
        filters: 'has_security_flags = 1',
        orderBy: 'created_at DESC',
        limit,
        offset,
      }),
      countRequests({ scope, filters: 'has_security_flags = 1' }),
    ])
    // ClickHouse stores JSON columns as strings; parse back to arrays so the
    // dashboard response contract matches what supabase-js used to return.
    const parseFlags = (s: string): unknown => {
      try { return JSON.parse(s) } catch { return [] }
    }
    const data = rows.map((r) => ({
      ...r,
      cost_usd: r.cost_usd == null ? null : Number(r.cost_usd),
      flags: parseFlags(r.flags),
      response_flags: parseFlags(r.response_flags),
      // Convert ClickHouse DateTime64 to canonical ISO UTC (gotcha #18).
      created_at: fromClickhouseTimestamp(r.created_at) ?? r.created_at,
    }))
    return c.json({
      success: true,
      data,
      meta: { total, limit, offset },
    })
  } catch (err) {
    console.error('[security:flagged] ClickHouse query failed:', err instanceof Error ? err.message : err)
    throw new ApiError('INTERNAL_ERROR', 'Failed to fetch flagged requests')
  }
})

// GET /api/v1/security/summary?hours=24
securityRouter.get('/summary', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const hours = Math.min(parsePositiveInt(c.req.query('hours'), 24), 720)

  try {
    const rows = await getSecuritySummary(orgId, hours)
    const summary = rows.map((r) => ({
      type: r.flag_type,
      pattern: r.pattern,
      count: r.count,
    }))
    const totalFlags = summary.reduce((s, r) => s + r.count, 0)
    return c.json({
      success: true,
      data: summary,
      meta: { hours, totalFlags },
    })
  } catch (err) {
    console.error('[security:summary] ClickHouse query failed:', err instanceof Error ? err.message : err)
    throw new ApiError('INTERNAL_ERROR', 'Failed to compute summary')
  }
})

// GET /api/v1/security/settings
// Returns org-level alert setting + list of all projects with their block setting.
securityRouter.get('/settings', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const [orgResult, projectsResult] = await Promise.all([
    supabaseAdmin
      .from('organizations')
      .select('security_alert_enabled')
      .eq('id', orgId)
      .single(),
    supabaseAdmin
      .from('projects')
      .select('id, name, security_block_enabled')
      .eq('organization_id', orgId)
      .order('name', { ascending: true }),
  ])

  if (orgResult.error) throw new ApiError('INTERNAL_ERROR', 'Failed to fetch settings')
  if (projectsResult.error) throw new ApiError('INTERNAL_ERROR', 'Failed to fetch projects')

  return c.json({
    success: true,
    data: {
      alertEnabled: orgResult.data?.security_alert_enabled ?? false,
      projects: (projectsResult.data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        blockEnabled: p.security_block_enabled,
      })),
    },
  })
})

// PATCH /api/v1/security/alert
// Body: { enabled: boolean }
securityRouter.patch('/alert', requireAdmin, async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  let body: { enabled?: unknown }
  try {
    body = await c.req.json()
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  if (typeof body.enabled !== 'boolean') {
    throw new ApiError('VALIDATION_FAILED', 'enabled must be a boolean')
  }

  const { error } = await supabaseAdmin
    .from('organizations')
    .update({ security_alert_enabled: body.enabled })
    .eq('id', orgId)

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to update alert setting')

  return c.json({ success: true, data: { alertEnabled: body.enabled } })
})

// PATCH /api/v1/security/projects/:projectId/block
// Body: { enabled: boolean }
securityRouter.patch('/projects/:projectId/block', requireAdmin, async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const projectId = c.req.param('projectId')

  let body: { enabled?: unknown }
  try {
    body = await c.req.json()
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  if (typeof body.enabled !== 'boolean') {
    throw new ApiError('VALIDATION_FAILED', 'enabled must be a boolean')
  }

  // Verify the project belongs to this org before updating
  const { data: project, error: fetchError } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('organization_id', orgId)
    .single()

  if (fetchError || !project) {
    throw new ApiError('NOT_FOUND', 'Project not found')
  }

  const { error } = await supabaseAdmin
    .from('projects')
    .update({ security_block_enabled: body.enabled })
    .eq('id', projectId)
    .eq('organization_id', orgId) // defense-in-depth: re-scope to this org

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to update block setting')

  return c.json({ success: true, data: { projectId, blockEnabled: body.enabled } })
})
