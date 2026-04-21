import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/db.js'
import {
  verifyPaddleSignature,
  planForPriceId,
  fetchPaddleSubscription,
  type PlanTier,
} from '../lib/paddle.js'

/**
 * Paddle webhook receiver. Paddle POSTs subscription lifecycle events here.
 * Every event is HMAC-signed via `Paddle-Signature: ts=<unix>;h1=<hex>`.
 *
 * Endpoint: POST /webhooks/paddle
 * Register in Paddle Dashboard → Developer Tools → Notifications:
 *   URL: https://spanlens-server.vercel.app/webhooks/paddle
 *
 * Event handling:
 *   subscription.*         — full subscription lifecycle upsert
 *   transaction.completed  — first-payment fallback for when subscription
 *                            events precede custom_data propagation
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

// Paddle transaction event shape — used for transaction.completed fallback.
interface PaddleTransactionPayload {
  id: string  // txn_...
  customer_id: string  // ctm_...
  subscription_id: string | null
  status: string
  items?: Array<{ price?: { id?: string }; price_id?: string }>
  custom_data?: { organization_id?: string } | null
}

interface PaddleEvent {
  event_id: string
  event_type: string
  occurred_at: string
  data: PaddleSubscriptionPayload | PaddleTransactionPayload
}

function extractPriceId(
  payload: PaddleSubscriptionPayload | PaddleTransactionPayload,
): string | null {
  const first = payload.items?.[0]
  if (!first) return null
  return first.price?.id ?? first.price_id ?? null
}

/**
 * Resolve the organization ID for a Paddle event.
 *
 * Paddle subscriptions do NOT inherit custom_data from the originating
 * transaction, so subscription events often arrive with an empty
 * custom_data. We fall back to looking up the org by paddle_customer_id
 * (stored during checkout creation).
 */
async function resolveOrgId(
  customData: { organization_id?: string } | null | undefined,
  paddleCustomerId: string,
): Promise<string | null> {
  if (customData?.organization_id) return customData.organization_id

  const { data } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .eq('paddle_customer_id', paddleCustomerId)
    .maybeSingle()

  return data?.id ?? null
}

async function upsertSubscription(
  event: PaddleEvent,
  sub: PaddleSubscriptionPayload,
  organizationId: string,
  plan: PlanTier,
  priceId: string,
): Promise<void> {
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

  const subscriptionEvents = new Set([
    'subscription.created',
    'subscription.activated',
    'subscription.updated',
    'subscription.paused',
    'subscription.resumed',
    'subscription.canceled',
    'subscription.past_due',
  ])

  // ── subscription.* events ──────────────────────────────────────
  if (subscriptionEvents.has(event.event_type)) {
    const sub = event.data as PaddleSubscriptionPayload

    const organizationId = await resolveOrgId(sub.custom_data, sub.customer_id)
    if (!organizationId) {
      console.error('[paddle-webhook] could not resolve org for sub event', event.event_id, sub.customer_id)
      return c.json({ error: 'organization not found' }, 400)
    }

    const priceId = extractPriceId(sub)
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
      await upsertSubscription(event, sub, organizationId, plan, priceId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error'
      return c.json({ error: msg }, 500)
    }

    return c.json({ success: true, event_type: event.event_type })
  }

  // ── transaction.completed fallback ────────────────────────────
  // Paddle fires this reliably on first payment with the transaction's
  // custom_data (which we populate). Use it to update organizations.plan
  // immediately while subscription events may lag or lack custom_data.
  if (event.event_type === 'transaction.completed') {
    const tx = event.data as PaddleTransactionPayload

    // Only act on subscription transactions (not one-time payments)
    if (!tx.subscription_id) {
      return c.json({ success: true, skipped: 'non-subscription transaction' })
    }

    const organizationId = await resolveOrgId(tx.custom_data, tx.customer_id)
    if (!organizationId) {
      console.error('[paddle-webhook] could not resolve org for transaction', event.event_id, tx.customer_id)
      return c.json({ error: 'organization not found' }, 400)
    }

    const priceId = extractPriceId(tx)
    if (!priceId) {
      console.error('[paddle-webhook] missing price id in transaction', event.event_id)
      return c.json({ error: 'missing price id' }, 400)
    }

    const plan = planForPriceId(priceId)
    if (!plan) {
      console.error('[paddle-webhook] unknown price id in transaction', priceId)
      return c.json({ error: `unknown price id ${priceId}` }, 400)
    }

    // Enrich with billing period + exact status from Paddle API. The
    // transaction payload doesn't carry those fields.
    const subDetail = await fetchPaddleSubscription(tx.subscription_id)

    const syntheticSub: PaddleSubscriptionPayload = {
      id: tx.subscription_id,
      customer_id: tx.customer_id,
      status: (subDetail?.status as PaddleSubscriptionPayload['status']) ?? 'active',
      items: subDetail?.items ?? tx.items ?? [],
      custom_data: tx.custom_data ?? null,
      ...(subDetail?.current_billing_period
        ? { current_billing_period: subDetail.current_billing_period }
        : {}),
      ...(subDetail?.scheduled_change !== undefined
        ? { scheduled_change: subDetail.scheduled_change }
        : {}),
    }
    try {
      await upsertSubscription(event, syntheticSub, organizationId, plan, priceId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error'
      return c.json({ error: msg }, 500)
    }

    return c.json({ success: true, event_type: event.event_type })
  }

  // All other event types — acknowledge without processing
  return c.json({ success: true, skipped: event.event_type })
})
