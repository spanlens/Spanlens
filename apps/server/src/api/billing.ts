import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'
import {
  createPaddleCustomer,
  createPaddleCheckoutTransaction,
  findPaddleCustomerByEmail,
} from '../lib/paddle.js'
import { checkMonthlyQuota } from '../lib/quota.js'

/**
 * Dashboard billing endpoints — JWT authenticated.
 *
 *   GET  /api/v1/billing/subscription  → current subscription state
 *   POST /api/v1/billing/checkout      → create a Paddle checkout URL for a plan
 */

export const billingRouter = new Hono<JwtContext>()

billingRouter.use('*', authJwt)

// ── GET /api/v1/billing/subscription ────────────────────────────
billingRouter.get('/subscription', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

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

  if (error) return c.json({ error: 'Failed to fetch subscription' }, 500)

  return c.json({ success: true, data: data ?? null })
})

// ── GET /api/v1/billing/quota ───────────────────────────────────
billingRouter.get('/quota', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const quota = await checkMonthlyQuota(orgId)
  return c.json({ success: true, data: quota })
})

// ── POST /api/v1/billing/checkout ───────────────────────────────
// Body: { plan: 'starter' | 'team' | 'enterprise', successUrl?: string }
// Returns: { url: 'https://...' } — browser redirects to Paddle-hosted checkout
billingRouter.post('/checkout', async (c) => {
  const orgId = c.get('orgId')
  const userId = c.get('userId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let body: { plan?: unknown; successUrl?: unknown }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const plan = typeof body.plan === 'string' ? body.plan : ''
  const priceIdByPlan: Record<string, string | undefined> = {
    starter: process.env['PADDLE_PRICE_STARTER'],
    team: process.env['PADDLE_PRICE_TEAM'],
    enterprise: process.env['PADDLE_PRICE_ENTERPRISE'],
  }
  const priceId = priceIdByPlan[plan]
  if (!priceId) {
    return c.json({ error: `Unknown or unconfigured plan: ${plan}` }, 400)
  }

  // Look up the user's email + org's paddle_customer_id
  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId)
  const email = authUser.user?.email
  if (!email) return c.json({ error: 'User email not found' }, 400)

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name, paddle_customer_id')
    .eq('id', orgId)
    .single()
  if (!org) return c.json({ error: 'Organization not found' }, 404)

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
        return c.json({ error: `Paddle customer create failed: ${msg}` }, 502)
      }
    }
    await supabaseAdmin
      .from('organizations')
      .update({ paddle_customer_id: paddleCustomerId })
      .eq('id', orgId)
  }

  const successUrl = typeof body.successUrl === 'string' ? body.successUrl : undefined

  try {
    const tx = await createPaddleCheckoutTransaction({
      customerId: paddleCustomerId,
      priceId,
      organizationId: orgId,
      ...(successUrl ? { successUrl } : {}),
    })
    if (!tx.checkout?.url) {
      return c.json({ error: 'Paddle did not return a checkout URL' }, 502)
    }
    return c.json({ success: true, data: { url: tx.checkout.url, transactionId: tx.id } })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    return c.json({ error: `Paddle checkout create failed: ${msg}` }, 502)
  }
})
