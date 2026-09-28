import { Hono, type Context } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { requireRole } from '../middleware/requireRole.js'
import { supabaseAdmin } from '../lib/db.js'
import {
  createPaddleCustomer,
  createPaddleCheckoutTransaction,
  findPaddleCustomerByEmail,
  cancelPaddleSubscription,
  classifyPaddleFailure,
  PaddleApiError,
} from '../lib/paddle.js'
import { checkMonthlyQuota } from '../lib/quota.js'
import { recordAuditEvent } from '../lib/audit-log.js'
import { ApiError } from '../lib/errors.js'
import { logError } from '../lib/structured-logger.js'
import {
  reserveCheckoutSession,
  openCheckoutSession,
  failCheckoutSession,
} from '../lib/billing-checkout-sessions.js'

/**
 * Turns a Paddle failure into the error the customer should see, and puts the
 * part they should not see in the log.
 *
 * The old code concatenated Paddle's own words onto an `UPSTREAM_FAILED` and
 * shipped the result to the browser, so an under-scoped API key surfaced as
 * `502 … not authorized to create|read transaction`. That is our configuration
 * described to a customer: it tells them nothing they can act on, and it is not
 * theirs to read. Worse, every cause looked identical, so the only way to tell
 * a missing permission from a Paddle outage was to open the runtime logs.
 *
 * Now the cause decides both halves. `stage` names the call so the log says
 * which step failed without the reader having to infer it from a URL.
 */
function paddleFailure(err: unknown, stage: string, orgId: string): ApiError {
  const kind = classifyPaddleFailure(err)

  logError('PADDLE_API_FAILED', {
    orgId,
    stage,
    kind,
    // Paddle's status and its own error code are the two fields worth grepping
    // when this shows up; `detail` carries the sentence that names the cause.
    paddleStatus: err instanceof PaddleApiError ? err.status : null,
    paddleCode: err instanceof PaddleApiError ? err.code : null,
  }, err)

  if (kind === 'unavailable') {
    return new ApiError(
      'UPSTREAM_FAILED',
      'The payment provider is not responding. Please try again in a few minutes.',
    )
  }

  // credentials and request are both ours to fix, and neither improves by being
  // retried, so they read the same to the customer.
  return new ApiError(
    'BILLING_NOT_CONFIGURED',
    'Checkout is unavailable because of a billing problem on our side. ' +
      'We have been notified. Please contact support@spanlens.io if it persists.',
  )
}

/**
 * Dashboard billing endpoints — JWT authenticated.
 *
 *   GET  /api/v1/billing/subscription  → current subscription state
 *   GET  /api/v1/billing/quota         → monthly quota usage
 *   POST /api/v1/billing/checkout      → create a Paddle checkout URL for a plan
 *   POST /api/v1/billing/cancel        → cancel active subscription at period end
 */

export const billingRouter = new Hono<JwtContext>()

billingRouter.use('*', authJwt)

// ── GET /api/v1/billing/subscription ────────────────────────────
billingRouter.get('/subscription', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .select(
      'id, paddle_subscription_id, paddle_price_id, plan, status, current_period_start, current_period_end, cancel_at_period_end, updated_at',
    )
    .eq('organization_id', orgId)
    .in('status', ['active', 'trialing', 'past_due', 'paused'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to fetch subscription')

  return c.json({ success: true, data: data ?? null })
})

// ── GET /api/v1/billing/quota ───────────────────────────────────
billingRouter.get('/quota', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const quota = await checkMonthlyQuota(orgId)
  return c.json({ success: true, data: quota })
})

const LIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due', 'paused']

// Guard against double-billing. The Paddle webhook upserts subscriptions by
// paddle_subscription_id, so a second checkout completed against a live
// subscription persists a SECOND row and Paddle bills both. Reject up front.
// A failed read refuses the checkout (fail closed): the old code ignored the
// `{ error }` and let the checkout through when the guard could not run.
async function assertNoLiveSubscription(orgId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .select('id')
    .eq('organization_id', orgId)
    .in('status', LIVE_SUBSCRIPTION_STATUSES)
    .limit(1)
    .maybeSingle()
  if (error) {
    logError('UNCATEGORIZED', { orgId, area: 'billing.checkout', stage: 'live_subscription_guard', dbError: error.message })
    throw new ApiError('INTERNAL_ERROR', 'Checkout could not be started. Please try again.')
  }
  if (data) {
    throw new ApiError(
      'CONFLICT',
      'This workspace already has an active subscription; use plan change instead',
    )
  }
}

async function parseCheckoutPlan(c: Context<JwtContext>): Promise<{ plan: string; priceId: string }> {
  let body: { plan?: unknown }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  const plan = typeof body.plan === 'string' ? body.plan : ''
  const priceIdByPlan: Record<string, string | undefined> = {
    starter: process.env['PADDLE_PRICE_STARTER'],
    team: process.env['PADDLE_PRICE_TEAM'],
    enterprise: process.env['PADDLE_PRICE_ENTERPRISE'],
  }
  const priceId = priceIdByPlan[plan]
  if (!priceId) {
    throw new ApiError('VALIDATION_FAILED', `Unknown or unconfigured plan: ${plan}`)
  }
  return { plan, priceId }
}

/**
 * Resolve the Paddle customer: stored id, else look up by email, else create.
 * Paddle customers are unique per email, so a person who pays for two
 * workspaces ends up with the same ctm_ id on both orgs. That is expected; the
 * webhook no longer relies on paddle_customer_id alone to find the org.
 */
async function resolvePaddleCustomer(orgId: string, userId: string): Promise<string> {
  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId)
  const email = authUser.user?.email
  if (!email) throw new ApiError('BAD_REQUEST', 'User email not found')

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name, paddle_customer_id')
    .eq('id', orgId)
    .single()
  if (!org) throw new ApiError('NOT_FOUND', 'Organization not found')

  const stored = org.paddle_customer_id as string | null
  if (stored) return stored

  const existing = await findPaddleCustomerByEmail(email).catch((err: unknown) => {
    // Not fatal: creating the customer below either works or fails loudly.
    logError('PADDLE_API_FAILED', { orgId, stage: 'customer.find', kind: classifyPaddleFailure(err) }, err)
    return null
  })
  let paddleCustomerId: string
  if (existing) {
    paddleCustomerId = existing.id
  } else {
    try {
      const created = await createPaddleCustomer({ email, name: org.name as string })
      paddleCustomerId = created.id
    } catch (err) {
      throw paddleFailure(err, 'customer.create', orgId)
    }
  }

  const { error } = await supabaseAdmin
    .from('organizations')
    .update({ paddle_customer_id: paddleCustomerId })
    .eq('id', orgId)
  if (error) {
    // Not fatal: the checkout transaction carries organization_id in
    // custom_data, and the next checkout simply resolves the customer again.
    logError('UNCATEGORIZED', { orgId, area: 'billing.checkout', stage: 'store_customer_id', dbError: error.message })
  }
  return paddleCustomerId
}

async function createCheckout(
  orgId: string,
  paddleCustomerId: string,
  priceId: string,
): Promise<{ id: string; url: string }> {
  let tx: Awaited<ReturnType<typeof createPaddleCheckoutTransaction>>
  try {
    tx = await createPaddleCheckoutTransaction({ customerId: paddleCustomerId, priceId, organizationId: orgId })
  } catch (err) {
    throw paddleFailure(err, 'transaction.create', orgId)
  }
  if (!tx.checkout?.url) {
    // A 2xx transaction with no checkout URL means the Default Payment Link
    // is unset for this Paddle environment — a dashboard setting, so it reads
    // as a configuration problem rather than an outage.
    logError('PADDLE_API_FAILED', {
      orgId,
      stage: 'transaction.create',
      kind: 'request',
      reason: 'no_checkout_url',
      paddleTransactionId: tx.id,
    })
    throw new ApiError(
      'BILLING_NOT_CONFIGURED',
      'Checkout is unavailable because of a billing problem on our side. ' +
        'We have been notified. Please contact support@spanlens.io if it persists.',
    )
  }
  return { id: tx.id, url: tx.checkout.url }
}

// ── POST /api/v1/billing/checkout ───────────────────────────────
// Body: { plan: 'starter' | 'team' | 'enterprise', successUrl?: string }
// Returns: { url: 'https://...' } — browser redirects to Paddle-hosted checkout
//
// Org-level idempotency (quality audit 2026-09-28, C4.2): the org's single
// checkout slot is claimed in `billing_checkout_sessions` BEFORE Paddle is
// called. A repeat for the same plan within 30 minutes returns the open
// transaction instead of creating another one; a different plan is refused
// until the open one expires. See lib/billing-checkout-sessions.ts.
billingRouter.post('/checkout', requireRole('admin'), async (c) => {
  const orgId = c.get('orgId')
  const userId = c.get('userId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  await assertNoLiveSubscription(orgId)
  const { plan, priceId } = await parseCheckoutPlan(c)

  const reservation = await reserveCheckoutSession({ orgId, priceId, plan, userId: userId ?? null })
  if (reservation.kind === 'reuse') {
    return c.json({ success: true, data: { url: reservation.url, transactionId: reservation.transactionId } })
  }

  let tx: { id: string; url: string }
  try {
    const paddleCustomerId = await resolvePaddleCustomer(orgId, userId)
    tx = await createCheckout(orgId, paddleCustomerId, priceId)
  } catch (err) {
    // Release the slot so the customer can try again right away.
    await failCheckoutSession(reservation.sessionId, orgId)
    throw err
  }

  await openCheckoutSession(reservation.sessionId, orgId, tx)
  void recordAuditEvent(c, {
    action: 'billing.checkout_create',
    resourceType: 'subscriptions',
    resourceId: tx.id,
    // The price ID identifies the plan being purchased. We deliberately
    // do not log card / personal info — that's Paddle's domain.
    metadata: { paddle_transaction_id: tx.id, price_id: priceId },
  })
  return c.json({ success: true, data: { url: tx.url, transactionId: tx.id } })
})

// ── POST /api/v1/billing/cancel ─────────────────────────────────
// Cancels the active subscription at period end so the customer keeps access
// through the current billing period (matches Terms section 5).
billingRouter.post('/cancel', requireRole('admin'), async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('paddle_subscription_id, cancel_at_period_end')
    .eq('organization_id', orgId)
    .in('status', ['active', 'trialing', 'past_due'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!sub) throw new ApiError('NOT_FOUND', 'No active subscription found')
  if (sub.cancel_at_period_end) throw new ApiError('CONFLICT', 'Subscription is already scheduled for cancellation')

  try {
    await cancelPaddleSubscription(sub.paddle_subscription_id)
    void recordAuditEvent(c, {
      action: 'billing.cancel',
      resourceType: 'subscriptions',
      resourceId: sub.paddle_subscription_id,
    })
    return c.json({ success: true })
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw paddleFailure(err, 'subscription.cancel', orgId)
  }
})
