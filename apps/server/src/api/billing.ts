import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { requireRole } from '../middleware/requireRole.js'
import { supabaseAdmin } from '../lib/db.js'
import {
  createPaddleCustomer,
  createPaddleCheckoutTransaction,
  findPaddleCustomerByEmail,
  cancelPaddleSubscription,
} from '../lib/paddle.js'
import { checkMonthlyQuota } from '../lib/quota.js'
import { recordAuditEvent } from '../lib/audit-log.js'
import { ApiError } from '../lib/errors.js'

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

// ── POST /api/v1/billing/checkout ───────────────────────────────
// Body: { plan: 'starter' | 'team' | 'enterprise', successUrl?: string }
// Returns: { url: 'https://...' } — browser redirects to Paddle-hosted checkout
billingRouter.post('/checkout', requireRole('admin'), async (c) => {
  const orgId = c.get('orgId')
  const userId = c.get('userId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  // Guard against double-billing. The Paddle webhook upserts subscriptions by
  // paddle_subscription_id, so a second checkout completed against a live
  // subscription persists a SECOND row and Paddle bills both. Reject up front
  // and steer the caller to the plan-change flow instead.
  const { data: existingSub } = await supabaseAdmin
    .from('subscriptions')
    .select('id')
    .eq('organization_id', orgId)
    .in('status', ['active', 'trialing', 'past_due', 'paused'])
    .limit(1)
    .maybeSingle()
  if (existingSub) {
    throw new ApiError(
      'CONFLICT',
      'This workspace already has an active subscription; use plan change instead',
    )
  }

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

  // Look up the user's email + org's paddle_customer_id
  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId)
  const email = authUser.user?.email
  if (!email) throw new ApiError('BAD_REQUEST', 'User email not found')

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name, paddle_customer_id')
    .eq('id', orgId)
    .single()
  if (!org) throw new ApiError('NOT_FOUND', 'Organization not found')

  // Resolve Paddle customer: use stored id, else look up by email, else create
  let paddleCustomerId = org.paddle_customer_id as string | null
  if (!paddleCustomerId) {
    const existing = await findPaddleCustomerByEmail(email).catch(() => null)
    if (existing) {
      paddleCustomerId = existing.id
    } else {
      try {
        const created = await createPaddleCustomer({
          email,
          name: org.name as string,
        })
        paddleCustomerId = created.id
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error'
        throw new ApiError('UPSTREAM_FAILED', `Paddle customer create failed: ${msg}`)
      }
    }
    await supabaseAdmin
      .from('organizations')
      .update({ paddle_customer_id: paddleCustomerId })
      .eq('id', orgId)
  }

  try {
    const tx = await createPaddleCheckoutTransaction({
      customerId: paddleCustomerId,
      priceId,
      organizationId: orgId,
    })
    if (!tx.checkout?.url) {
      throw new ApiError('UPSTREAM_FAILED', 'Paddle did not return a checkout URL')
    }
    void recordAuditEvent(c, {
      action: 'billing.checkout_create',
      resourceType: 'subscriptions',
      resourceId: tx.id,
      // The price ID identifies the plan being purchased. We deliberately
      // do not log card / personal info — that's Paddle's domain.
      metadata: { paddle_transaction_id: tx.id, price_id: priceId },
    })
    return c.json({ success: true, data: { url: tx.checkout.url, transactionId: tx.id } })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    throw new ApiError('UPSTREAM_FAILED', `Paddle checkout create failed: ${msg}`)
  }
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
    const msg = err instanceof Error ? err.message : 'unknown error'
    throw new ApiError('UPSTREAM_FAILED', `Paddle cancel failed: ${msg}`)
  }
})
