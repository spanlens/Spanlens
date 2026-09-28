import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { FakeSupabase, type Row } from './helpers/fake-supabase.js'
import { installOnError } from './helpers/install-on-error.js'

/**
 * POST /api/v1/billing/checkout — org-level idempotency (quality audit
 * 2026-09-28, C4.2).
 *
 * The old guard only looked for a live `subscriptions` row, which the webhook
 * writes after payment. Before payment nothing stopped a second Paddle
 * transaction for the same org (two tabs, two admins, a stale tab completed
 * later), and each one could become its own subscription billed separately.
 * The guard's own `{ error }` was ignored too, so a failed read let checkout
 * through (fail open).
 *
 * These tests drive the real router against an in-memory PostgREST fake that
 * enforces the partial UNIQUE index from migration 20260929110100.
 */

const ORG_ID = '015a5187-d896-40b4-bef8-7d2b2d18c81d'
const USER_ID = 'b5b1c1d2-0000-4000-8000-000000000001'
const PRICE_STARTER = 'pri_starter_test'
const PRICE_TEAM = 'pri_team_test'

let fake: FakeSupabase

vi.mock('../lib/db.js', () => ({
  supabaseAdmin: {
    from: (t: string) => fake.from(t),
    rpc: (fn: string, p: Record<string, unknown>) => fake.rpc(fn, p),
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: 'owner@example.com' } }, error: null }),
      },
    },
  },
}))

vi.mock('../middleware/authJwt.js', () => ({
  authJwt: async (c: Context, next: () => Promise<void>) => {
    c.set('orgId', ORG_ID)
    c.set('userId', USER_ID)
    c.set('role', 'admin')
    await next()
  },
}))

vi.mock('../middleware/requireRole.js', () => ({
  requireRole: () => async (_c: unknown, next: () => Promise<void>) => { await next() },
}))

vi.mock('../lib/audit-log.js', () => ({ recordAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../lib/quota.js', () => ({ checkMonthlyQuota: vi.fn() }))

const createTx = vi.fn()
const cancelTx = vi.fn()
vi.mock('../lib/paddle.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/paddle.js')>('../lib/paddle.js')
  return {
    ...actual,
    createPaddleCheckoutTransaction: (...args: unknown[]) => createTx(...args),
    cancelPaddleTransaction: (...args: unknown[]) => cancelTx(...args),
    findPaddleCustomerByEmail: async () => ({ id: 'ctm_existing', email: 'owner@example.com', name: null, status: 'active' }),
    createPaddleCustomer: async () => ({ id: 'ctm_new', email: 'owner@example.com', name: null, status: 'active' }),
    cancelPaddleSubscription: vi.fn(),
  }
})

function sessions(): Row[] {
  return fake.rows('billing_checkout_sessions')
}

async function app() {
  const { billingRouter } = await import('../api/billing.js')
  const a = new Hono()
  installOnError(a)
  a.route('/billing', billingRouter)
  return a
}

async function checkout(plan: string) {
  const res = await (await app()).request('/billing/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ plan }),
  })
  return { res, body: (await res.json()) as Record<string, unknown> }
}

function message(body: Record<string, unknown>): string {
  return (body['error'] as { message: string }).message
}

let txCounter = 0

beforeEach(() => {
  process.env['PADDLE_PRICE_STARTER'] = PRICE_STARTER
  process.env['PADDLE_PRICE_TEAM'] = PRICE_TEAM
  txCounter = 0
  cancelTx.mockReset().mockResolvedValue(undefined)
  createTx.mockReset().mockImplementation(async () => {
    txCounter += 1
    return { id: `txn_${txCounter}`, status: 'ready', checkout: { url: `https://pay.example/?_ptxn=txn_${txCounter}` } }
  })
  fake = new FakeSupabase()
    .configure('billing_checkout_sessions', {
      defaults: () => ({ status: 'creating', paddle_transaction_id: null, checkout_url: null }),
      unique: [
        { columns: ['organization_id'], where: (r) => r['status'] === 'creating' || r['status'] === 'open' },
        { columns: ['paddle_transaction_id'] },
      ],
    })
    .seed('organizations', [{ id: ORG_ID, name: 'Acme', paddle_customer_id: null }])
    .seed('subscriptions', [])
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('checkout — one open Paddle checkout per org', () => {
  it('first checkout creates one Paddle transaction and records an open session', async () => {
    const { res, body } = await checkout('starter')
    expect(res.status).toBe(200)
    expect((body['data'] as { url: string }).url).toBe('https://pay.example/?_ptxn=txn_1')
    expect(createTx).toHaveBeenCalledTimes(1)
    expect(sessions()).toHaveLength(1)
    expect(sessions()[0]).toMatchObject({
      organization_id: ORG_ID,
      price_id: PRICE_STARTER,
      plan: 'starter',
      status: 'open',
      paddle_transaction_id: 'txn_1',
      checkout_url: 'https://pay.example/?_ptxn=txn_1',
      created_by: USER_ID,
    })
  })

  it('a second checkout for the same plan reuses the open transaction (no second Paddle call)', async () => {
    await checkout('starter')
    const { res, body } = await checkout('starter')
    expect(res.status).toBe(200)
    expect(body['data']).toEqual({ url: 'https://pay.example/?_ptxn=txn_1', transactionId: 'txn_1' })
    expect(createTx).toHaveBeenCalledTimes(1)
  })

  it('a checkout for a different plan while one is open → 409, no second transaction', async () => {
    await checkout('starter')
    const { res, body } = await checkout('team')
    expect(res.status).toBe(409)
    expect(message(body)).toContain('different plan')
    expect(createTx).toHaveBeenCalledTimes(1)
  })

  it('two concurrent requests create exactly one Paddle transaction', async () => {
    const results = await Promise.all([checkout('starter'), checkout('starter')])
    expect(createTx).toHaveBeenCalledTimes(1)
    const statuses = results.map((r) => r.res.status).sort()
    // The loser either sees the winner's claim or trips the partial UNIQUE
    // index; both are a 409, never a second transaction.
    expect(statuses).toEqual([200, 409])
  })

  it('an open session older than 30 minutes expires and a new checkout is allowed', async () => {
    fake.seed('billing_checkout_sessions', [{
      organization_id: ORG_ID,
      price_id: PRICE_TEAM,
      plan: 'team',
      status: 'open',
      paddle_transaction_id: 'txn_old',
      checkout_url: 'https://pay.example/?_ptxn=txn_old',
      created_at: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
    }])
    const { res } = await checkout('starter')
    expect(res.status).toBe(200)
    expect(createTx).toHaveBeenCalledTimes(1)
    const byTxn = new Map(sessions().map((s) => [s['paddle_transaction_id'], s['status']]))
    expect(byTxn.get('txn_old')).toBe('expired')
    expect(byTxn.get('txn_1')).toBe('open')
  })

  it('expiring a session cancels its Paddle transaction so the old link cannot be paid later', async () => {
    // Review of the C4.2 fix: marking the row expired left the Paddle
    // transaction payable. Tab A opens a checkout, tab B starts a new one 31
    // minutes later and pays, then tab A pays too: two subscriptions.
    fake.seed('billing_checkout_sessions', [{
      organization_id: ORG_ID,
      price_id: PRICE_TEAM,
      plan: 'team',
      status: 'open',
      paddle_transaction_id: 'txn_old',
      checkout_url: 'https://pay.example/?_ptxn=txn_old',
      created_at: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
    }])
    const { res } = await checkout('starter')
    expect(res.status).toBe(200)
    expect(cancelTx).toHaveBeenCalledTimes(1)
    expect(cancelTx).toHaveBeenCalledWith('txn_old')
    // The old transaction is canceled before the new one is created.
    expect(cancelTx.mock.invocationCallOrder[0]!).toBeLessThan(createTx.mock.invocationCallOrder[0]!)
  })

  it('a Paddle cancel failure is logged and does not block the new checkout', async () => {
    fake.seed('billing_checkout_sessions', [{
      organization_id: ORG_ID,
      price_id: PRICE_TEAM,
      plan: 'team',
      status: 'open',
      paddle_transaction_id: 'txn_old',
      checkout_url: 'https://pay.example/?_ptxn=txn_old',
      created_at: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
    }])
    cancelTx.mockRejectedValueOnce(new TypeError('fetch failed'))
    const { res } = await checkout('starter')
    expect(res.status).toBe(200)
    expect(createTx).toHaveBeenCalledTimes(1)
    const logged = vi.mocked(console.error).mock.calls.map((a) => String(a[0]))
    expect(logged.some((l) => l.startsWith('ERROR[PADDLE_API_FAILED]') && l.includes('transaction.cancel'))).toBe(true)
  })

  it('a stale session that never got a Paddle transaction expires without a Paddle call', async () => {
    fake.seed('billing_checkout_sessions', [{
      organization_id: ORG_ID,
      price_id: PRICE_STARTER,
      plan: 'starter',
      status: 'creating',
      paddle_transaction_id: null,
      created_at: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    }])
    const { res } = await checkout('starter')
    expect(res.status).toBe(200)
    expect(cancelTx).not.toHaveBeenCalled()
    expect(sessions().filter((s) => s['status'] === 'expired')).toHaveLength(1)
  })

  it('sessions of other orgs and finished sessions are never canceled', async () => {
    fake.seed('billing_checkout_sessions', [
      {
        organization_id: '9d1f0e5c-0000-4000-8000-000000000999',
        price_id: PRICE_TEAM,
        plan: 'team',
        status: 'open',
        paddle_transaction_id: 'txn_other_org',
        created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
      {
        organization_id: ORG_ID,
        price_id: PRICE_TEAM,
        plan: 'team',
        status: 'completed',
        paddle_transaction_id: 'txn_paid_long_ago',
        created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
    ])
    const { res } = await checkout('starter')
    expect(res.status).toBe(200)
    expect(cancelTx).not.toHaveBeenCalled()
  })

  it('a checkout that was just paid blocks a new one until the subscription lands', async () => {
    fake.seed('billing_checkout_sessions', [{
      organization_id: ORG_ID,
      price_id: PRICE_STARTER,
      plan: 'starter',
      status: 'completed',
      paddle_transaction_id: 'txn_paid',
      created_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    }])
    const { res, body } = await checkout('team')
    expect(res.status).toBe(409)
    expect(message(body)).toContain('just completed')
    expect(createTx).not.toHaveBeenCalled()
  })

  it('a failed Paddle call releases the slot so the next attempt can run', async () => {
    createTx.mockRejectedValueOnce(new TypeError('fetch failed'))
    const first = await checkout('starter')
    expect(first.res.status).toBe(502)
    expect(sessions()[0]!['status']).toBe('failed')

    const second = await checkout('starter')
    expect(second.res.status).toBe(200)
    expect(createTx).toHaveBeenCalledTimes(2)
  })
})

describe('checkout — fail closed on read errors', () => {
  it('live-subscription guard read error → 500 and no Paddle call (was fail-open)', async () => {
    fake.failNext('subscriptions', 'select', { message: 'connection refused' })
    const { res } = await checkout('starter')
    expect(res.status).toBe(500)
    expect(createTx).not.toHaveBeenCalled()
  })

  it('session table read error → 500 and no Paddle call', async () => {
    fake.failNext('billing_checkout_sessions', 'select', { message: 'relation does not exist' })
    const { res } = await checkout('starter')
    expect(res.status).toBe(500)
    expect(createTx).not.toHaveBeenCalled()
  })

  it('an org with a live subscription is still refused with 409', async () => {
    fake.seed('subscriptions', [{ organization_id: ORG_ID, status: 'active' }])
    const { res } = await checkout('starter')
    expect(res.status).toBe(409)
    expect(createTx).not.toHaveBeenCalled()
  })
})
