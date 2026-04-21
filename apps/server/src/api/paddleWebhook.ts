import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/db.js'
import { verifyPaddleSignature, planForPriceId, type PlanTier } from '../lib/paddle.js'

/**
 * Paddle webhook receiver. Paddle POSTs subscription lifecycle events here.
 * Every event is HMAC-signed via `Paddle-Signature: ts=<unix>;h1=<hex>`.
 *
 * Endpoint: POST /webhooks/paddle
 * Register in Paddle Dashboard → Developer Tools → Notifications:
 *   URL: https://spanlens-server.vercel.app/webhooks/paddle
 */

export const paddleWebhookRouter = new Hono()

// Paddle subscription event shape — only the fields we care about.
interface PaddleSubscriptionPayload {
  id: string  // sub_...
  customer_id: string  // ctm_...
  status: 'active' | 'trialing' | 'past_due' | 'paused' | 'canceled'
  items?: Array<{ price?: { id?: string }; price_id?: string }>
  current_billing_period?: {
    starts_at: string
    ends_at: string
  }
  scheduled_change?: { action: 'cancel' | 'pause' | 'resume' } | null
  custom_data?: { organization_id?: string } | null
}

interface PaddleEvent {
  event_id: string
  event_type: string
  occurred_at: string
  data: PaddleSubscriptionPayload
}

function extractPriceId(payload: PaddleSubscriptionPayload): string | null {
  const first = payload.items?.[0]
  if (!first) return null
  return first.price?.id ?? first.price_id ?? null
}

async function upsertSubscription(
  event: PaddleEvent,
  organizationId: string,
  plan: PlanTier,
  priceId: string,
): Promise<void> {
  const sub = event.data
  const updates = {
    organization_id: organizationId,
    paddle_subscription_id: sub.id,
    paddle_customer_id: sub.customer_id,
    paddle_price_id: priceId,
    plan,
    status: sub.status,
    current_period_start: sub.current_billing_period?.starts_at ?? null,
    current_period_end: sub.current_billing_period?.ends_at ?? null,
    cancel_at_period_end: sub.scheduled_change?.action === 'cancel',
    metadata: {
      last_event_id: event.event_id,
      last_event_type: event.event_type,
      occurred_at: event.occurred_at,
    },
  }

  const { error } = await supabaseAdmin
    .from('subscriptions')
    .upsert(updates, { onConflict: 'paddle_subscription_id' })

  if (error) {
    console.error('[paddle-webhook] upsert failed', error.message)
    throw new Error(`subscription upsert failed: ${error.message}`)
  }

  // Mirror the latest plan onto organizations.plan so UI/quotas read it easily
  if (sub.status === 'active' || sub.status === 'trialing') {
    await supabaseAdmin
      .from('organizations')
      .update({ plan, paddle_customer_id: sub.customer_id })
      .eq('id', organizationId)
  } else if (sub.status === 'canceled') {
    await supabaseAdmin
      .from('organizations')
      .update({ plan: 'free' })
      .eq('id', organizationId)
  }
}

paddleWebhookRouter.post('/paddle', async (c) => {
  const rawBody = await c.req.text()

  const valid = await verifyPaddleSignature(rawBody, c.req.header('Paddle-Signature'))
  if (!valid) {
    console.warn('[paddle-webhook] signature verification failed')
    return c.json({ error: 'invalid signature' }, 401)
  }

  let event: PaddleEvent
  try {
    event = JSON.parse(rawBody) as PaddleEvent
  } catch {
    return c.json({ error: 'invalid json body' }, 400)
  }

  // We only process subscription.* events for now. transaction.* etc. are
  // acknowledged so Paddle stops retrying but not acted on.
  const handled = new Set([
    'subscription.created',
    'subscription.activated',
    'subscription.updated',
    'subscription.paused',
    'subscription.resumed',
    'subscription.canceled',
    'subscription.past_due',
  ])

  if (!handled.has(event.event_type)) {
    return c.json({ success: true, skipped: event.event_type })
  }

  const organizationId = event.data.custom_data?.organization_id
  if (!organizationId) {
    console.error('[paddle-webhook] missing custom_data.organization_id', event.event_id)
    return c.json({ error: 'missing organization_id in custom_data' }, 400)
  }

  const priceId = extractPriceId(event.data)
  if (!priceId) {
    console.error('[paddle-webhook] missing price id', event.event_id)
    return c.json({ error: 'missing price id' }, 400)
  }

  const plan = planForPriceId(priceId)
  if (!plan) {
    console.error('[paddle-webhook] unknown price id', priceId)
    return c.json({ error: `unknown price id ${priceId}` }, 400)
  }

  try {
    await upsertSubscription(event, organizationId, plan, priceId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    return c.json({ error: msg }, 500)
  }

  return c.json({ success: true, event_type: event.event_type })
})
