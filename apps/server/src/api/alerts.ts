import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { requireRole } from '../middleware/requireRole.js'
import { supabaseAdmin } from '../lib/db.js'

export const alertsRouter = new Hono<JwtContext>()
alertsRouter.use('*', authJwt)

const requireEdit = requireRole('admin', 'editor')

const VALID_ALERT_TYPES = new Set(['budget', 'error_rate', 'latency_p95'])
const VALID_CHANNEL_KINDS = new Set(['email', 'slack', 'discord'])

// ── GET /api/v1/alerts ──────────────────────────────────────────
alertsRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const { data, error } = await supabaseAdmin
    .from('alerts')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })

  if (error) return c.json({ error: 'Failed to fetch alerts' }, 500)
  return c.json({ success: true, data: data ?? [] })
})

// ── POST /api/v1/alerts ─────────────────────────────────────────
alertsRouter.post('/', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let body: {
    name?: unknown
    type?: unknown
    threshold?: unknown
    window_minutes?: unknown
    cooldown_minutes?: unknown
    project_id?: unknown
  }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    return c.json({ error: 'name is required' }, 400)
  }
  if (typeof body.type !== 'string' || !VALID_ALERT_TYPES.has(body.type)) {
    return c.json({ error: 'type must be budget | error_rate | latency_p95' }, 400)
  }
  if (typeof body.threshold !== 'number' || body.threshold <= 0) {
    return c.json({ error: 'threshold must be a positive number' }, 400)
  }

  const insert = {
    organization_id: orgId,
    name: body.name.trim(),
    type: body.type,
    threshold: body.threshold,
    window_minutes:
      typeof body.window_minutes === 'number' && body.window_minutes > 0
        ? body.window_minutes
        : 60,
    cooldown_minutes:
      typeof body.cooldown_minutes === 'number' && body.cooldown_minutes >= 0
        ? body.cooldown_minutes
        : 60,
    project_id: typeof body.project_id === 'string' ? body.project_id : null,
  }

  const { data, error } = await supabaseAdmin
    .from('alerts')
    .insert(insert)
    .select('*')
    .single()
  if (error || !data) return c.json({ error: 'Failed to create alert' }, 500)
  return c.json({ success: true, data }, 201)
})

// ── PATCH /api/v1/alerts/:id ────────────────────────────────────
alertsRouter.patch('/:id', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  const id = c.req.param('id')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let body: {
    name?: unknown
    threshold?: unknown
    window_minutes?: unknown
    cooldown_minutes?: unknown
    is_active?: unknown
  }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const updates: Record<string, unknown> = {}
  if (typeof body.name === 'string' && body.name.trim().length > 0) updates['name'] = body.name.trim()
  if (typeof body.threshold === 'number' && body.threshold > 0) updates['threshold'] = body.threshold
  if (typeof body.window_minutes === 'number' && body.window_minutes > 0) updates['window_minutes'] = body.window_minutes
  if (typeof body.cooldown_minutes === 'number' && body.cooldown_minutes >= 0) updates['cooldown_minutes'] = body.cooldown_minutes
  if (typeof body.is_active === 'boolean') updates['is_active'] = body.is_active

  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400)
  }

  const { data, error } = await supabaseAdmin
    .from('alerts')
    .update(updates)
    .eq('id', id)
    .eq('organization_id', orgId)
    .select('*')
    .single()
  if (error || !data) return c.json({ error: 'Alert not found' }, 404)
  return c.json({ success: true, data })
})

// ── DELETE /api/v1/alerts/:id ───────────────────────────────────
alertsRouter.delete('/:id', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  const id = c.req.param('id')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const { error } = await supabaseAdmin
    .from('alerts')
    .delete()
    .eq('id', id)
    .eq('organization_id', orgId)
  if (error) return c.json({ error: 'Failed to delete alert' }, 500)
  return c.json({ success: true })
})

// ── Channels CRUD ───────────────────────────────────────────────

alertsRouter.get('/channels', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const { data, error } = await supabaseAdmin
    .from('notification_channels')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
  if (error) return c.json({ error: 'Failed to fetch channels' }, 500)
  return c.json({ success: true, data: data ?? [] })
})

alertsRouter.post('/channels', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let body: { kind?: unknown; target?: unknown }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (typeof body.kind !== 'string' || !VALID_CHANNEL_KINDS.has(body.kind)) {
    return c.json({ error: 'kind must be email | slack | discord' }, 400)
  }
  if (typeof body.target !== 'string' || body.target.trim().length === 0) {
    return c.json({ error: 'target is required' }, 400)
  }

  // Lightweight format validation
  if (body.kind === 'email' && !body.target.includes('@')) {
    return c.json({ error: 'email target must contain @' }, 400)
  }
  if ((body.kind === 'slack' || body.kind === 'discord') && !body.target.startsWith('https://')) {
    return c.json({ error: 'webhook target must start with https://' }, 400)
  }

  const { data, error } = await supabaseAdmin
    .from('notification_channels')
    .insert({ organization_id: orgId, kind: body.kind, target: body.target.trim() })
    .select('*')
    .single()
  if (error || !data) return c.json({ error: 'Failed to create channel' }, 500)
  return c.json({ success: true, data }, 201)
})

alertsRouter.delete('/channels/:id', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  const id = c.req.param('id')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const { error } = await supabaseAdmin
    .from('notification_channels')
    .delete()
    .eq('id', id)
    .eq('organization_id', orgId)
  if (error) return c.json({ error: 'Failed to delete channel' }, 500)
  return c.json({ success: true })
})

// ── GET /api/v1/alerts/deliveries ───────────────────────────────
alertsRouter.get('/deliveries', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const { data, error } = await supabaseAdmin
    .from('alert_deliveries')
    .select('id, alert_id, channel_id, status, error_message, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) return c.json({ error: 'Failed to fetch deliveries' }, 500)
  return c.json({ success: true, data: data ?? [] })
})
