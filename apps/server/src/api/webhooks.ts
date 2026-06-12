import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { requireRole } from '../middleware/requireRole.js'
import { supabaseAdmin } from '../lib/db.js'
import { randomHex } from '../lib/crypto.js'
import { dispatchWebhookEvent } from '../lib/webhook-dispatch.js'
import { invalidateWebhookCache } from '../lib/webhook-emit.js'
import { recordAuditEvent } from '../lib/audit-log.js'
import { ApiError } from '../lib/errors.js'
import { validateOutboundUrl } from '../lib/safe-url.js'

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
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const { data, error } = await supabaseAdmin
    .from('webhooks')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to fetch webhooks')
  return c.json({ success: true, data: data ?? [] })
})

// ── POST /api/v1/webhooks ───────────────────────────────────────
webhooksRouter.post('/', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  let body: {
    name?: unknown
    url?: unknown
    events?: unknown
    is_active?: unknown
  }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    throw new ApiError('VALIDATION_FAILED', 'name is required')
  }
  if (typeof body.url !== 'string') {
    throw new ApiError('BAD_REQUEST', 'url is required')
  }
  // SSRF defense — phase-2 (DNS-aware) validation at registration time.
  // dispatch-time validation in lib/webhook-dispatch.ts catches DNS rebinding
  // where the same hostname resolves to a private IP later.
  const urlCheck = await validateOutboundUrl(body.url)
  if (!urlCheck.ok) {
    throw new ApiError('BAD_REQUEST', urlCheck.message, { reason: urlCheck.reason })
  }

  const events: string[] = Array.isArray(body.events)
    ? (body.events as unknown[]).filter(
        (e): e is string => typeof e === 'string' && VALID_EVENTS.has(e),
      )
    : ['request.created']

  if (events.length === 0) {
    throw new ApiError('VALIDATION_FAILED', 'At least one valid event is required')
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

  if (error || !data) throw new ApiError('INTERNAL_ERROR', 'Failed to create webhook')
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
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  let body: {
    name?: unknown
    url?: unknown
    events?: unknown
    is_active?: unknown
  }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  const updates: Record<string, unknown> = {}

  if (typeof body.name === 'string' && body.name.trim().length > 0) {
    updates['name'] = body.name.trim()
  }
  if (typeof body.url === 'string' && body.url.length > 0) {
    // Same SSRF defense as POST — caller may be moving the webhook to a new
    // target so the full DNS-aware check must run here too.
    const urlCheck = await validateOutboundUrl(body.url)
    if (!urlCheck.ok) {
      throw new ApiError('BAD_REQUEST', urlCheck.message, { reason: urlCheck.reason })
    }
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
    throw new ApiError('BAD_REQUEST', 'No valid fields to update')
  }

  const { data, error } = await supabaseAdmin
    .from('webhooks')
    .update(updates)
    .eq('id', id)
    .eq('organization_id', orgId)
    .select('*')
    .single()

  if (error || !data) throw new ApiError('NOT_FOUND', 'Webhook not found')
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
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const { error } = await supabaseAdmin
    .from('webhooks')
    .delete()
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to delete webhook')
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
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const { data: webhook, error: fetchError } = await supabaseAdmin
    .from('webhooks')
    .select('*')
    .eq('id', id)
    .eq('organization_id', orgId)
    .single()

  if (fetchError || !webhook) throw new ApiError('NOT_FOUND', 'Webhook not found')

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
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  // Verify ownership before returning delivery records
  const { data: webhook, error: fetchError } = await supabaseAdmin
    .from('webhooks')
    .select('id')
    .eq('id', id)
    .eq('organization_id', orgId)
    .single()

  if (fetchError || !webhook) throw new ApiError('NOT_FOUND', 'Webhook not found')

  const { data, error } = await supabaseAdmin
    .from('webhook_deliveries')
    .select('*')
    .eq('webhook_id', id)
    .order('delivered_at', { ascending: false })
    .limit(10)

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to fetch deliveries')
  return c.json({ success: true, data: data ?? [] })
})
