import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../../middleware/authJwt.js'
import { requireSystemAdmin } from '../../middleware/requireSystemAdmin.js'
import { supabaseAdmin } from '../../lib/db.js'

/**
 * Admin-only internal_alerts management.
 *
 *   GET  /api/v1/admin/alerts            list unresolved (default) or all
 *   POST /api/v1/admin/alerts/:id/resolve  mark one resolved
 *
 * Authorization: SPANLENS_ADMIN_EMAILS env var (see requireSystemAdmin).
 *
 * The list endpoint defaults to `unresolved=true` because the operator
 * workflow is "show me what's broken right now." Resolved history is
 * available behind `?unresolved=false` for audit, but kept off the
 * default view to reduce noise.
 */
export const adminAlertsRouter = new Hono<JwtContext>()

adminAlertsRouter.use('*', authJwt)
adminAlertsRouter.use('*', requireSystemAdmin)

adminAlertsRouter.get('/', async (c) => {
  const unresolvedOnly = c.req.query('unresolved') !== 'false'

  let query = supabaseAdmin
    .from('internal_alerts')
    .select('id, kind, severity, message, details, resolved_at, resolved_by, created_at')
    .order('created_at', { ascending: false })
    .limit(200)

  if (unresolvedOnly) {
    query = query.is('resolved_at', null)
  }

  const { data, error } = await query
  if (error) {
    return c.json({ error: 'Failed to fetch alerts' }, 500)
  }

  return c.json({ success: true, data: data ?? [] })
})

adminAlertsRouter.post('/:id/resolve', async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId')

  const { data, error } = await supabaseAdmin
    .from('internal_alerts')
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: userId,
    })
    .eq('id', id)
    .is('resolved_at', null) // Idempotent — already-resolved rows are not touched.
    .select('id, resolved_at')
    .maybeSingle()

  if (error) return c.json({ error: `Resolve failed: ${error.message}` }, 500)
  if (!data) return c.json({ error: 'Alert not found or already resolved' }, 404)

  return c.json({ success: true, data })
})
