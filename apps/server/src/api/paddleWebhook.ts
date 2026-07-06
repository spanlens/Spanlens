import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { supabaseAdmin } from '../lib/db.js'
import {
  verifyPaddleSignature,
  planForPriceId,
  fetchPaddleSubscription,
  type PlanTier,
} from '../lib/paddle.js'
import { ApiError, serializeErrorEnvelope } from '../lib/errors.js'

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

// Paddle adjustment event shape — used for refund/credit handling.
interface PaddleAdjustmentPayload {
  id: string
  subscription_id: string | null
  customer_id: string
  action: 'refund' | 'credit' | 'chargeback' | 'chargeback_warning' | 'chargeback_reverse'
  status: 'pending_approval' | 'approved' | 'rejected'
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
  // ── past_due_since lifecycle (P2.7) ────────────────────────────────────
  // The auto-downgrade cron uses this column to age out delinquent subs
  // after 7 days. Three cases:
  //   1. Entering past_due:    if `past_due_since` is already set keep it
  //                            (idempotent — duplicate webhooks don't reset
  //                            the clock); otherwise stamp now().
  //   2. Recovered to active:  clear the field so a future failure starts
  //                            its own 7-day window from scratch.
  //   3. Any other status:     leave untouched (carry through canceled
  //                            for analytics).
  // ── out-of-order guard ─────────────────────────────────────────────────
  // Paddle does not guarantee delivery order: a delayed subscription.updated
  // arriving AFTER a subscription.canceled would otherwise flip status/plan
  // back to active. We stamp each applied event's occurred_at into
  // metadata.occurred_at, and skip the write ONLY when we can positively
  // determine the incoming event is strictly OLDER than the last applied one.
  // If the comparison is ambiguous (no stored timestamp, missing/invalid
  // occurred_at) we apply as before — never drop a valid update.
  const { data: existingRow } = await supabaseAdmin
    .from('subscriptions')
    .select('past_due_since, metadata')
    .eq('paddle_subscription_id', sub.id)
    .maybeSingle()

  const lastOccurredAtRaw = (existingRow as { metadata?: { occurred_at?: string } | null } | null)
    ?.metadata?.occurred_at
  const incomingTs = Date.parse(event.occurred_at)
  const lastTs = lastOccurredAtRaw ? Date.parse(lastOccurredAtRaw) : NaN
  if (!Number.isNaN(incomingTs) && !Number.isNaN(lastTs) && incomingTs < lastTs) {
    console.warn(
      '[paddle-webhook] skipping out-of-order event',
      event.event_id, event.event_type,
      'occurred_at', event.occurred_at, '<', lastOccurredAtRaw,
    )
    return
  }

  let pastDueSinceUpdate: { past_due_since: string | null } | Record<string, never> = {}
  if (sub.status === 'past_due') {
    if (!(existingRow as { past_due_since?: string | null } | null)?.past_due_since) {
      pastDueSinceUpdate = { past_due_since: new Date().toISOString() }
    }
  } else if (sub.status === 'active' || sub.status === 'trialing') {
    pastDueSinceUpdate = { past_due_since: null }
  }

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
    ...pastDueSinceUpdate,
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
    throw new ApiError('UNAUTHORIZED', 'invalid signature')
  }

  let event: PaddleEvent
  try {
    event = JSON.parse(rawBody) as PaddleEvent
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'invalid json body')
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
    const isTerminal = event.event_type === 'subscription.canceled'

    const organizationId = await resolveOrgId(sub.custom_data, sub.customer_id)
    if (!organizationId) {
      console.error('[paddle-webhook] could not resolve org for sub event', event.event_id, sub.customer_id)
      throw new ApiError('BAD_REQUEST', 'organization not found')
    }

    const priceId = extractPriceId(sub)
    // Cancellations don't need a valid (currently-configured) price ID — the
    // sub may reference an archived/rotated price that no longer maps. We
    // still want to record the canceled status, so fall back to the row's
    // existing plan/price_id from the DB.
    let plan: PlanTier | null = priceId ? planForPriceId(priceId) : null
    let resolvedPriceId = priceId

    if (!plan) {
      if (isTerminal) {
        const { data: existing } = await supabaseAdmin
          .from('subscriptions')
          .select('plan, paddle_price_id')
          .eq('paddle_subscription_id', sub.id)
          .maybeSingle()
        plan = (existing?.plan as PlanTier | undefined) ?? 'starter'
        resolvedPriceId = existing?.paddle_price_id ?? priceId ?? 'unknown'
      } else {
        if (!priceId) {
          console.error('[paddle-webhook] missing price id', event.event_id)
          // Return 200 so Paddle does not retry — this is a config gap, not
          // a transient error.  Add PADDLE_PRICE_* env vars to resolve.
          return c.json({ skipped: 'missing price id', event_id: event.event_id })
        }
        // Unknown price ID means PADDLE_PRICE_* env var is not configured for
        // this price.  Return 200 to stop Paddle's retry loop; log prominently
        // so the operator knows to set the env var.
        console.error(
          '[paddle-webhook] unknown price id — add PADDLE_PRICE_* env var:',
          priceId, 'event_id:', event.event_id,
        )
        return c.json({ skipped: 'unknown price id', price_id: priceId, event_id: event.event_id })
      }
    }

    try {
      await upsertSubscription(event, sub, organizationId, plan, resolvedPriceId ?? 'unknown')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error'
      throw new ApiError('INTERNAL_ERROR', msg)
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
      throw new ApiError('BAD_REQUEST', 'organization not found')
    }

    const priceId = extractPriceId(tx)
    if (!priceId) {
      console.error('[paddle-webhook] missing price id in transaction', event.event_id)
      throw new ApiError('BAD_REQUEST', 'missing price id')
    }

    const plan = planForPriceId(priceId)
    if (!plan) {
      // Return 200 to stop Paddle's retry loop; operator must add the
      // PADDLE_PRICE_* env var to process this event type going forward.
      console.error(
        '[paddle-webhook] unknown price id in transaction — add PADDLE_PRICE_* env var:',
        priceId, 'event_id:', event.event_id,
      )
      return c.json({ skipped: 'unknown price id', price_id: priceId, event_id: event.event_id })
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
      throw new ApiError('INTERNAL_ERROR', msg)
    }

    return c.json({ success: true, event_type: event.event_type })
  }

  // ── adjustment.created — refund approved → downgrade plan ────────
  // Paddle fires this when a refund or credit is applied (e.g. 14-day
  // money-back guarantee). We immediately revert the org to free so the
  // customer cannot retain paid access after receiving their money back.
  // Paddle will also send subscription.canceled separately, but there is a
  // race window between the two events — handling it here closes that gap.
  if (event.event_type === 'adjustment.created') {
    const adj = event.data as unknown as PaddleAdjustmentPayload

    if (adj.action === 'refund' && adj.status === 'approved') {
      const organizationId = await resolveOrgId(null, adj.customer_id)
      if (!organizationId) {
        console.error('[paddle-webhook] could not resolve org for adjustment', event.event_id, adj.customer_id)
        throw new ApiError('BAD_REQUEST', 'organization not found')
      }

      await supabaseAdmin
        .from('organizations')
        .update({ plan: 'free' })
        .eq('id', organizationId)

      console.warn('[paddle-webhook] refund approved — org downgraded to free', organizationId, adj.id)
    }

    return c.json({ success: true, event_type: event.event_type })
  }

  // All other event types — acknowledge without processing
  return c.json({ success: true, skipped: event.event_type })
})

// Standalone router onError handler. paddleWebhookRouter's unit tests
// call .request() directly (no parent app), so the global app.onError
// never fires for thrown ApiError. Without this local handler a thrown
// auth error would surface as 500 plaintext and Paddle would retry the
// webhook forever (and the contract tests would see the wrong status
// code). Wire the shared serializeErrorEnvelope helper here so the
// router emits the same envelope the rest of the app does.
paddleWebhookRouter.onError((err, c) => {
  const requestId =
    ((c as unknown as { get: (k: string) => string | undefined }).get('requestId')) ?? null
  const { status, body } = serializeErrorEnvelope(err, requestId)
  return c.json(body, status as ContentfulStatusCode)
})
