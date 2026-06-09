import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { requireRole } from '../middleware/requireRole.js'
import { supabaseAdmin } from '../lib/db.js'
import { recordAuditEvent } from '../lib/audit-log.js'
import { ApiError } from '../lib/errors.js'

export const alertsRouter = new Hono<JwtContext>()
alertsRouter.use('*', authJwt)

const requireEdit = requireRole('admin', 'editor')

const VALID_ALERT_TYPES = new Set(['budget', 'error_rate', 'latency_p95'])
const VALID_CHANNEL_KINDS = new Set(['email', 'slack', 'discord'])

// ── GET /api/v1/alerts ──────────────────────────────────────────
alertsRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const { data, error } = await supabaseAdmin
    .from('alerts')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to fetch alerts')
  return c.json({ success: true, data: data ?? [] })
})

// ── POST /api/v1/alerts ─────────────────────────────────────────
alertsRouter.post('/', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

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
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    throw new ApiError('VALIDATION_FAILED', 'name is required')
  }
  if (typeof body.type !== 'string' || !VALID_ALERT_TYPES.has(body.type)) {
    throw new ApiError('VALIDATION_FAILED', 'type must be budget | error_rate | latency_p95')
  }
  if (typeof body.threshold !== 'number' || body.threshold <= 0) {
    throw new ApiError('VALIDATION_FAILED', 'threshold must be a positive number')
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
  if (error || !data) throw new ApiError('INTERNAL_ERROR', 'Failed to create alert')

  void recordAuditEvent(c, {
    action: 'alert.create',
    resourceType: 'alerts',
    resourceId: data.id,
    metadata: { name: data.name, type: data.type, threshold: data.threshold },
  })

  return c.json({ success: true, data }, 201)
})

// ── PATCH /api/v1/alerts/:id ────────────────────────────────────
alertsRouter.patch('/:id', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  const id = c.req.param('id')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

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
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  const updates: Record<string, unknown> = {}
  if (typeof body.name === 'string' && body.name.trim().length > 0) updates['name'] = body.name.trim()
  if (typeof body.threshold === 'number' && body.threshold > 0) updates['threshold'] = body.threshold
  if (typeof body.window_minutes === 'number' && body.window_minutes > 0) updates['window_minutes'] = body.window_minutes
  if (typeof body.cooldown_minutes === 'number' && body.cooldown_minutes >= 0) updates['cooldown_minutes'] = body.cooldown_minutes
  if (typeof body.is_active === 'boolean') updates['is_active'] = body.is_active

  if (Object.keys(updates).length === 0) {
    throw new ApiError('BAD_REQUEST', 'No valid fields to update')
  }

  const { data, error } = await supabaseAdmin
    .from('alerts')
    .update(updates)
    .eq('id', id)
    .eq('organization_id', orgId)
    .select('*')
    .single()
  if (error || !data) throw new ApiError('NOT_FOUND', 'Alert not found')

  void recordAuditEvent(c, {
    action: 'alert.update',
    resourceType: 'alerts',
    resourceId: data.id,
    metadata: { fields: Object.keys(updates) },
  })

  return c.json({ success: true, data })
})

// ── DELETE /api/v1/alerts/:id ───────────────────────────────────
alertsRouter.delete('/:id', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  const id = c.req.param('id')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const { error } = await supabaseAdmin
    .from('alerts')
    .delete()
    .eq('id', id)
    .eq('organization_id', orgId)
  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to delete alert')

  void recordAuditEvent(c, {
    action: 'alert.delete',
    resourceType: 'alerts',
    resourceId: id,
  })

  return c.json({ success: true })
})

// ── Channels CRUD ───────────────────────────────────────────────

alertsRouter.get('/channels', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const { data, error } = await supabaseAdmin
    .from('notification_channels')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to fetch channels')
  return c.json({ success: true, data: data ?? [] })
})

alertsRouter.post('/channels', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  let body: { kind?: unknown; target?: unknown; label?: unknown }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  if (typeof body.kind !== 'string' || !VALID_CHANNEL_KINDS.has(body.kind)) {
    throw new ApiError('VALIDATION_FAILED', 'kind must be email | slack | discord')
  }
  if (typeof body.target !== 'string' || body.target.trim().length === 0) {
    throw new ApiError('VALIDATION_FAILED', 'target is required')
  }

  // Lightweight format validation
  if (body.kind === 'email' && !body.target.includes('@')) {
    throw new ApiError('VALIDATION_FAILED', 'email target must contain @')
  }
  if ((body.kind === 'slack' || body.kind === 'discord') && !body.target.startsWith('https://')) {
    throw new ApiError('BAD_REQUEST', 'webhook target must start with https://')
  }

  const target = body.target.trim()
  // Optional human-readable label (e.g. "#prod-alerts"). Empty string → null.
  const label =
    typeof body.label === 'string' && body.label.trim().length > 0
      ? body.label.trim()
      : null

  // Dedup: a workspace can hold many channels of the same kind, but not the
  // exact same destination twice — that would double-send every alert.
  const { data: existing } = await supabaseAdmin
    .from('notification_channels')
    .select('id')
    .eq('organization_id', orgId)
    .eq('kind', body.kind)
    .eq('target', target)
    .maybeSingle()
  if (existing) {
    throw new ApiError('CONFLICT', 'A channel with this destination already exists')
  }

  const { data, error } = await supabaseAdmin
    .from('notification_channels')
    .insert({ organization_id: orgId, kind: body.kind, target, label })
    .select('*')
    .single()
  if (error || !data) throw new ApiError('INTERNAL_ERROR', 'Failed to create channel')

  void recordAuditEvent(c, {
    action: 'notification_channel.create',
    resourceType: 'notification_channels',
    resourceId: data.id,
    metadata: { kind: data.kind, label: data.label },
  })

  return c.json({ success: true, data }, 201)
})

alertsRouter.delete('/channels/:id', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  const id = c.req.param('id')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const { error } = await supabaseAdmin
    .from('notification_channels')
    .delete()
    .eq('id', id)
    .eq('organization_id', orgId)
  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to delete channel')

  void recordAuditEvent(c, {
    action: 'notification_channel.delete',
    resourceType: 'notification_channels',
    resourceId: id,
  })

  return c.json({ success: true })
})

// ── GET /api/v1/alerts/deliveries ───────────────────────────────
alertsRouter.get('/deliveries', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const { data, error } = await supabaseAdmin
    .from('alert_deliveries')
    .select('id, alert_id, channel_id, status, error_message, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to fetch deliveries')
  return c.json({ success: true, data: data ?? [] })
})
