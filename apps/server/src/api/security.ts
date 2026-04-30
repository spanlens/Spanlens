import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'

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

function parseIntSafe(raw: string | undefined, fallback: number, min = 1): number {
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isInteger(n) && n >= min ? n : fallback
}

// GET /api/v1/security/flagged?limit=50&offset=0
securityRouter.get('/flagged', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const limit = Math.min(parseIntSafe(c.req.query('limit'), 50), 200)
  const offset = parseIntSafe(c.req.query('offset'), 0, 0)

  const { data, error, count } = await supabaseAdmin
    .from('requests')
    .select('id, provider, model, status_code, latency_ms, cost_usd, flags, response_flags, created_at', { count: 'exact' })
    .eq('organization_id', orgId)
    .eq('has_security_flags', true)
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
securityRouter.get('/summary', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const hours = Math.min(parseIntSafe(c.req.query('hours'), 24), 720)

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
  const totalFlags = summary.reduce((s, r) => s + r.count, 0)

  return c.json({
    success: true,
    data: summary,
    meta: { hours, totalFlags },
  })
})

// GET /api/v1/security/settings
// Returns org-level alert setting + list of all projects with their block setting.
securityRouter.get('/settings', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

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

  if (orgResult.error) return c.json({ error: 'Failed to fetch settings' }, 500)
  if (projectsResult.error) return c.json({ error: 'Failed to fetch projects' }, 500)

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
securityRouter.patch('/alert', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let body: { enabled?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (typeof body.enabled !== 'boolean') {
    return c.json({ error: 'enabled must be a boolean' }, 400)
  }

  const { error } = await supabaseAdmin
    .from('organizations')
    .update({ security_alert_enabled: body.enabled })
    .eq('id', orgId)

  if (error) return c.json({ error: 'Failed to update alert setting' }, 500)

  return c.json({ success: true, data: { alertEnabled: body.enabled } })
})

// PATCH /api/v1/security/projects/:projectId/block
// Body: { enabled: boolean }
securityRouter.patch('/projects/:projectId/block', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const projectId = c.req.param('projectId')

  let body: { enabled?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (typeof body.enabled !== 'boolean') {
    return c.json({ error: 'enabled must be a boolean' }, 400)
  }

  // Verify the project belongs to this org before updating
  const { data: project, error: fetchError } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('organization_id', orgId)
    .single()

  if (fetchError || !project) {
    return c.json({ error: 'Project not found' }, 404)
  }

  const { error } = await supabaseAdmin
    .from('projects')
    .update({ security_block_enabled: body.enabled })
    .eq('id', projectId)
    .eq('organization_id', orgId) // defense-in-depth: re-scope to this org

  if (error) return c.json({ error: 'Failed to update block setting' }, 500)

  return c.json({ success: true, data: { projectId, blockEnabled: body.enabled } })
})
