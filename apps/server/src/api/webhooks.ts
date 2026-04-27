import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { requireRole } from '../middleware/requireRole.js'
import { supabaseAdmin } from '../lib/db.js'

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
    events,
    is_active: typeof body.is_active === 'boolean' ? body.is_active : true,
  }

  const { data, error } = await supabaseAdmin
    .from('webhooks')
    .insert(insert)
    .select('*')
    .single()

  if (error || !data) return c.json({ error: 'Failed to create webhook' }, 500)
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

  const payload = JSON.stringify({
    event: 'test',
    timestamp: new Date().toISOString(),
    webhook_id: id,
  })

  // HMAC-SHA256 signature using Web Crypto API (Edge-compatible)
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(webhook.secret as string),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    keyMaterial,
    encoder.encode(payload),
  )
  const signature = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  const startMs = Date.now()
  let httpStatus: number | null = null
  let errorMessage: string | null = null
  let status: 'success' | 'failed' = 'failed'

  try {
    const res = await fetch(webhook.url as string, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Spanlens-Signature': `sha256=${signature}`,
      },
      body: payload,
      signal: AbortSignal.timeout(10_000),
    })
    httpStatus = res.status
    status = res.ok ? 'success' : 'failed'
    if (!res.ok) {
      errorMessage = `HTTP ${res.status}`
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : 'Request failed'
  }

  const durationMs = Date.now() - startMs

  // Record the delivery (fire-and-forget, non-blocking)
  void Promise.resolve(
    supabaseAdmin
      .from('webhook_deliveries')
      .insert({
        webhook_id: id,
        event_type: 'test',
        status,
        http_status: httpStatus,
        error_message: errorMessage,
        duration_ms: durationMs,
      }),
  ).catch(console.error)

  return c.json({
    success: true,
    data: { status, http_status: httpStatus, error_message: errorMessage, duration_ms: durationMs },
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
