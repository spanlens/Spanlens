import { Hono, type Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { supabaseAdmin } from '../lib/db.js'
import {
  verifyPaddleSignature,
  planForPriceId,
  fetchPaddleSubscription,
  type PlanTier,
} from '../lib/paddle.js'
import { ApiError, serializeErrorEnvelope } from '../lib/errors.js'
import { isUuid } from '../lib/params.js'
import { logError } from '../lib/structured-logger.js'
import {
  findOrgIdByCheckoutTransaction,
  markCheckoutSessionCompleted,
} from '../lib/billing-checkout-sessions.js'

/**
 * Paddle webhook receiver. Paddle POSTs subscription lifecycle events here.
 * Every event is HMAC-signed via `Paddle-Signature: ts=<unix>;h1=<hex>`.
 *
 * Endpoint: POST /webhooks/paddle
 * Register in Paddle Dashboard → Developer Tools → Notifications:
 *   URL: https://spanlens-server.vercel.app/webhooks/paddle
 *
 * Event handling:
 *   subscription.*         — full subscription lifecycle
 *   transaction.completed  — first-payment fallback for when subscription
 *                            events precede custom_data propagation
 *   adjustment.created     — approved refund removes that entitlement
 *
 * Write contract (quality audit 2026-09-28, C3.1 / C4.2): every state change
 * runs in ONE database function call, `apply_paddle_subscription_event` or
 * `apply_paddle_refund` (migration 20260929110000). The ordering guard, the
 * subscription upsert and the organizations.plan recompute share a single
 * transaction, so they land together or not at all. Any `{ error }` becomes a
 * 5xx, which Paddle retries; the guard re-applies an event whose occurred_at
 * equals the stored one, so a retry after a failure is applied, not skipped.
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
  /** Set on subscription.created: the checkout transaction that created it. */
  transaction_id?: string | null
}

// Paddle adjustment event shape — used for refund/credit handling.
interface PaddleAdjustmentPayload {
  id: string
  subscription_id: string | null
  transaction_id?: string | null
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

const SUBSCRIPTION_EVENTS = new Set([
  'subscription.created',
  'subscription.activated',
  'subscription.updated',
  'subscription.paused',
  'subscription.resumed',
  'subscription.canceled',
  'subscription.past_due',
])

function extractPriceId(
  payload: PaddleSubscriptionPayload | PaddleTransactionPayload,
): string | null {
  const first = payload.items?.[0]
  if (!first) return null
  return first.price?.id ?? first.price_id ?? null
}

function webhookDbFailure(
  context: Record<string, unknown>,
  publicMessage: string,
  dbMessage: string,
): ApiError {
  logError('PADDLE_WEBHOOK_FAILED', { ...context, dbError: dbMessage })
  return new ApiError('INTERNAL_ERROR', `${publicMessage}: ${dbMessage}`)
}

// ── Organization resolution (C4.1) ────────────────────────────────────────

interface OrgRefs {
  customData?: { organization_id?: string } | null | undefined
  subscriptionId?: string | null | undefined
  transactionId?: string | null | undefined
  customerId?: string | null | undefined
}

type OrgResolution =
  | { orgId: string; source: 'custom_data' | 'subscription' | 'checkout' | 'customer' }
  | { orgId: null; reason: 'not_found' | 'ambiguous_customer' }

async function orgIdForSubscription(paddleSubscriptionId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .select('organization_id')
    .eq('paddle_subscription_id', paddleSubscriptionId)
    .maybeSingle()
  if (error) throw new Error(`subscription lookup failed: ${error.message}`)
  return (data as { organization_id?: string } | null)?.organization_id ?? null
}

async function orgIdsForCustomer(paddleCustomerId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .eq('paddle_customer_id', paddleCustomerId)
    .limit(2)
  if (error) throw new Error(`customer lookup failed: ${error.message}`)
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id)
}

/**
 * Resolve the organization a Paddle event belongs to, most specific first:
 *
 *   1. custom_data.organization_id (we set it on every checkout transaction)
 *   2. the stored subscription row (paddle_subscription_id is UNIQUE)
 *   3. the checkout session that created the transaction
 *   4. paddle_customer_id, but only when exactly one org holds it
 *
 * Step 4 used to be the only fallback and it was a `maybeSingle()` whose error
 * was ignored: once one person paid for two workspaces (Paddle customers are
 * unique per email, so both orgs store the same ctm_ id), every event without
 * custom_data, and every refund, resolved to null and was dropped with a 400.
 * A read that fails throws (→ 5xx, Paddle retries) instead of guessing.
 */
async function resolveOrgId(refs: OrgRefs): Promise<OrgResolution> {
  const fromCustomData = refs.customData?.organization_id
  if (fromCustomData && isUuid(fromCustomData)) {
    return { orgId: fromCustomData, source: 'custom_data' }
  }

  if (refs.subscriptionId) {
    const orgId = await orgIdForSubscription(refs.subscriptionId)
    if (orgId) return { orgId, source: 'subscription' }
  }

  if (refs.transactionId) {
    const orgId = await findOrgIdByCheckoutTransaction(refs.transactionId)
    if (orgId) return { orgId, source: 'checkout' }
  }

  if (refs.customerId) {
    const orgIds = await orgIdsForCustomer(refs.customerId)
    if (orgIds.length === 1) return { orgId: orgIds[0]!, source: 'customer' }
    if (orgIds.length > 1) return { orgId: null, reason: 'ambiguous_customer' }
  }

  return { orgId: null, reason: 'not_found' }
}

async function requireOrgId(event: PaddleEvent, refs: OrgRefs): Promise<string> {
  let resolution: OrgResolution
  try {
    resolution = await resolveOrgId(refs)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw webhookDbFailure(
      { stage: 'resolve_org', eventId: event.event_id, eventType: event.event_type },
      'organization lookup failed',
      message,
    )
  }
  if (resolution.orgId === null) {
    logError('PADDLE_WEBHOOK_FAILED', {
      stage: 'resolve_org',
      reason: resolution.reason,
      eventId: event.event_id,
      eventType: event.event_type,
      paddleSubscriptionId: refs.subscriptionId ?? null,
      paddleTransactionId: refs.transactionId ?? null,
      paddleCustomerId: refs.customerId ?? null,
    })
    throw new ApiError('BAD_REQUEST', 'organization not found')
  }
  return resolution.orgId
}

// ── Subscription writes ───────────────────────────────────────────────────

async function applySubscriptionEvent(
  event: PaddleEvent,
  sub: PaddleSubscriptionPayload,
  organizationId: string,
  plan: PlanTier,
  priceId: string,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc('apply_paddle_subscription_event', {
    p_organization_id: organizationId,
    p_paddle_subscription_id: sub.id,
    p_paddle_customer_id: sub.customer_id,
    p_paddle_price_id: priceId,
    p_plan: plan,
    p_status: sub.status,
    p_current_period_start: sub.current_billing_period?.starts_at ?? null,
    p_current_period_end: sub.current_billing_period?.ends_at ?? null,
    p_cancel_at_period_end: sub.scheduled_change?.action === 'cancel',
    p_metadata: {
      last_event_id: event.event_id,
      last_event_type: event.event_type,
      occurred_at: event.occurred_at,
    },
  })

  if (error) {
    throw webhookDbFailure(
      {
        stage: 'apply_subscription_event',
        orgId: organizationId,
        eventId: event.event_id,
        eventType: event.event_type,
        paddleSubscriptionId: sub.id,
        status: sub.status,
        dbCode: (error as { code?: string }).code ?? null,
      },
      'subscription event could not be applied',
      error.message,
    )
  }

  const applied = (data as { applied?: boolean } | null)?.applied !== false
  if (!applied) {
    console.warn(
      '[paddle-webhook] skipping out-of-order event',
      event.event_id, event.event_type, 'occurred_at', event.occurred_at,
    )
  }
  return applied
}

/**
 * Cancellations don't need a valid (currently-configured) price ID: the sub
 * may reference an archived/rotated price that no longer maps. Fall back to
 * the stored row's plan / price so the canceled status is still recorded.
 */
async function cancelFallback(
  sub: PaddleSubscriptionPayload,
  priceId: string | null,
): Promise<{ plan: PlanTier; priceId: string }> {
  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .select('plan, paddle_price_id')
    .eq('paddle_subscription_id', sub.id)
    .maybeSingle()
  if (error) {
    throw webhookDbFailure(
      { stage: 'cancel_fallback', paddleSubscriptionId: sub.id },
      'subscription lookup failed',
      error.message,
    )
  }
  const existing = data as { plan?: PlanTier; paddle_price_id?: string } | null
  return {
    plan: existing?.plan ?? 'starter',
    priceId: existing?.paddle_price_id ?? priceId ?? 'unknown',
  }
}

// ── Event handlers ────────────────────────────────────────────────────────

async function handleSubscriptionEvent(c: Context, event: PaddleEvent): Promise<Response> {
  const sub = event.data as PaddleSubscriptionPayload
  const priceId = extractPriceId(sub)
  const knownPlan = priceId ? planForPriceId(priceId) : null

  if (!knownPlan && event.event_type !== 'subscription.canceled') {
    // Return 200 so Paddle does not retry: this is a config gap (missing
    // PADDLE_PRICE_* env var), not a transient error. Logged prominently.
    if (!priceId) {
      console.error('[paddle-webhook] missing price id', event.event_id)
      return c.json({ skipped: 'missing price id', event_id: event.event_id })
    }
    console.error(
      '[paddle-webhook] unknown price id, add PADDLE_PRICE_* env var:',
      priceId, 'event_id:', event.event_id,
    )
    return c.json({ skipped: 'unknown price id', price_id: priceId, event_id: event.event_id })
  }

  const organizationId = await requireOrgId(event, {
    customData: sub.custom_data,
    subscriptionId: sub.id,
    transactionId: sub.transaction_id ?? null,
    customerId: sub.customer_id,
  })

  const resolved = knownPlan
    ? { plan: knownPlan, priceId: priceId ?? 'unknown' }
    : await cancelFallback(sub, priceId)

  const applied = await applySubscriptionEvent(event, sub, organizationId, resolved.plan, resolved.priceId)
  return c.json({ success: true, event_type: event.event_type, applied })
}

async function handleTransactionCompleted(c: Context, event: PaddleEvent): Promise<Response> {
  const tx = event.data as PaddleTransactionPayload

  // Only act on subscription transactions (not one-time payments)
  if (!tx.subscription_id) {
    return c.json({ success: true, skipped: 'non-subscription transaction' })
  }

  const organizationId = await requireOrgId(event, {
    customData: tx.custom_data,
    subscriptionId: tx.subscription_id,
    transactionId: tx.id,
    customerId: tx.customer_id,
  })

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
      '[paddle-webhook] unknown price id in transaction, add PADDLE_PRICE_* env var:',
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
  const applied = await applySubscriptionEvent(event, syntheticSub, organizationId, plan, priceId)
  await markCheckoutSessionCompleted(tx.id)

  return c.json({ success: true, event_type: event.event_type, applied })
}

/**
 * adjustment.created — an approved refund (e.g. the 14-day money-back
 * guarantee) removes the refunded subscription's entitlement immediately, so
 * the customer cannot keep paid access after getting their money back. Paddle
 * also sends subscription.canceled, but there is a window between the two.
 * The recompute keeps the org on any OTHER live subscription it still pays
 * for, instead of forcing 'free'.
 */
async function handleAdjustment(c: Context, event: PaddleEvent): Promise<Response> {
  const adj = event.data as unknown as PaddleAdjustmentPayload
  if (adj.action !== 'refund' || adj.status !== 'approved') {
    return c.json({ success: true, event_type: event.event_type })
  }

  const organizationId = await requireOrgId(event, {
    subscriptionId: adj.subscription_id,
    transactionId: adj.transaction_id ?? null,
    customerId: adj.customer_id,
  })

  const { data, error } = await supabaseAdmin.rpc('apply_paddle_refund', {
    p_organization_id: organizationId,
    p_paddle_subscription_id: adj.subscription_id ?? null,
  })
  if (error) {
    throw webhookDbFailure(
      {
        stage: 'apply_refund',
        orgId: organizationId,
        eventId: event.event_id,
        adjustmentId: adj.id,
        paddleSubscriptionId: adj.subscription_id,
      },
      'refund could not be applied',
      error.message,
    )
  }

  const orgPlan = (data as { org_plan?: string } | null)?.org_plan ?? null
  console.warn('[paddle-webhook] refund approved, org plan recomputed', organizationId, adj.id, orgPlan)
  return c.json({ success: true, event_type: event.event_type, org_plan: orgPlan })
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

  if (SUBSCRIPTION_EVENTS.has(event.event_type)) return handleSubscriptionEvent(c, event)
  if (event.event_type === 'transaction.completed') return handleTransactionCompleted(c, event)
  if (event.event_type === 'adjustment.created') return handleAdjustment(c, event)

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
