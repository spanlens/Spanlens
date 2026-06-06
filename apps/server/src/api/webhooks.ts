import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { requireRole } from '../middleware/requireRole.js'
import { supabaseAdmin } from '../lib/db.js'
import { randomHex } from '../lib/crypto.js'
import { dispatchWebhookEvent } from '../lib/webhook-dispatch.js'
import { invalidateWebhookCache } from '../lib/webhook-emit.js'
import { recordAuditEvent } from '../lib/audit-log.js'

export const webhooksRouter = new Hono<JwtContext>()
webhooksRouter.use('*', authJwt)

const requireEdit = requireRole('admin', 'editor')

const VALID_EVENTS = new Set([
  'request.created',
  'trace.completed',
  'alert.triggered',
])

// ── GET /api/v1/webhooks ────────────────────────────────────────
webhooksRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const { data, error } = await supabaseAdmin
    .from('webhooks')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })

  if (error) return c.json({ error: 'Failed to fetch webhooks' }, 500)
  return c.json({ success: true, data: data ?? [] })
})

// ── POST /api/v1/webhooks ───────────────────────────────────────
webhooksRouter.post('/', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let body: {
    name?: unknown
    url?: unknown
    events?: unknown
    is_active?: unknown
  }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    return c.json({ error: 'name is required' }, 400)
  }
  if (typeof body.url !== 'string' || !body.url.startsWith('https://')) {
    return c.json({ error: 'url must start with https://' }, 400)
  }

  const events: string[] = Array.isArray(body.events)
    ? (body.events as unknown[]).filter(
        (e): e is string => typeof e === 'string' && VALID_EVENTS.has(e),
      )
    : ['request.created']

  if (events.length === 0) {
    return c.json({ error: 'At least one valid event is required' }, 400)
  }

  const insert = {
    organization_id: orgId,
    name: body.name.trim(),
    url: body.url.trim(),
    secret: randomHex(32),
    events,
    is_active: typeof body.is_active === 'boolean' ? body.is_active : true,
  }

  const { data, error } = await supabaseAdmin
    .from('webhooks')
    .insert(insert)
    .select('*')
    .single()

  if (error || !data) return c.json({ error: 'Failed to create webhook' }, 500)
  invalidateWebhookCache(orgId)

  void recordAuditEvent(c, {
    action: 'webhook.create',
    resourceType: 'webhooks',
    resourceId: data.id,
    metadata: { name: data.name, url: data.url, events: data.events },
  })

  return c.json({ success: true, data }, 201)
})

// ── PATCH /api/v1/webhooks/:id ──────────────────────────────────
webhooksRouter.patch('/:id', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  const id = c.req.param('id')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let body: {
    name?: unknown
    url?: unknown
    events?: unknown
    is_active?: unknown
  }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const updates: Record<string, unknown> = {}

  if (typeof body.name === 'string' && body.name.trim().length > 0) {
    updates['name'] = body.name.trim()
  }
  if (typeof body.url === 'string' && body.url.startsWith('https://')) {
    updates['url'] = body.url.trim()
  }
  if (Array.isArray(body.events)) {
    const events = (body.events as unknown[]).filter(
      (e): e is string => typeof e === 'string' && VALID_EVENTS.has(e),
    )
    if (events.length > 0) updates['events'] = events
  }
  if (typeof body.is_active === 'boolean') {
    updates['is_active'] = body.is_active
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400)
  }

  const { data, error } = await supabaseAdmin
    .from('webhooks')
    .update(updates)
    .eq('id', id)
    .eq('organization_id', orgId)
    .select('*')
    .single()

  if (error || !data) return c.json({ error: 'Webhook not found' }, 404)
  invalidateWebhookCache(orgId)

  void recordAuditEvent(c, {
    action: 'webhook.update',
    resourceType: 'webhooks',
    resourceId: data.id,
    metadata: { fields: Object.keys(updates) },
  })

  return c.json({ success: true, data })
})

// ── DELETE /api/v1/webhooks/:id ─────────────────────────────────
webhooksRouter.delete('/:id', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  const id = c.req.param('id')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const { error } = await supabaseAdmin
    .from('webhooks')
    .delete()
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return c.json({ error: 'Failed to delete webhook' }, 500)
  invalidateWebhookCache(orgId)

  void recordAuditEvent(c, {
    action: 'webhook.delete',
    resourceType: 'webhooks',
    resourceId: id,
  })

  return c.json({ success: true })
})

// ── POST /api/v1/webhooks/:id/test ──────────────────────────────
webhooksRouter.post('/:id/test', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  const id = c.req.param('id')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const { data: webhook, error: fetchError } = await supabaseAdmin
    .from('webhooks')
    .select('*')
    .eq('id', id)
    .eq('organization_id', orgId)
    .single()

  if (fetchError || !webhook) return c.json({ error: 'Webhook not found' }, 404)

  const result = await dispatchWebhookEvent(
    { id: webhook.id as string, url: webhook.url as string, secret: webhook.secret as string },
    'test',
    {},
  )

  return c.json({
    success: true,
    data: {
      status: result.ok ? 'success' : 'failed',
      http_status: result.httpStatus,
      error_message: result.errorMessage,
      duration_ms: result.durationMs,
    },
  })
})

// ── GET /api/v1/webhooks/:id/deliveries ─────────────────────────
webhooksRouter.get('/:id/deliveries', async (c) => {
  const orgId = c.get('orgId')
  const id = c.req.param('id')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  // Verify ownership before returning delivery records
  const { data: webhook, error: fetchError } = await supabaseAdmin
    .from('webhooks')
    .select('id')
    .eq('id', id)
    .eq('organization_id', orgId)
    .single()

  if (fetchError || !webhook) return c.json({ error: 'Webhook not found' }, 404)

  const { data, error } = await supabaseAdmin
    .from('webhook_deliveries')
    .select('*')
    .eq('webhook_id', id)
    .order('delivered_at', { ascending: false })
    .limit(10)

  if (error) return c.json({ error: 'Failed to fetch deliveries' }, 500)
  return c.json({ success: true, data: data ?? [] })
})
