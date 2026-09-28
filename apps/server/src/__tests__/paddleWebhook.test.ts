import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Paddle webhook handler — fixture-based unit tests (P1.5, reworked for the
 * 2026-09-28 billing audit: C3.1 / C4.1 / C4.2).
 *
 * Covers all 9 event types the Spanlens server subscribes to:
 *
 *   subscription.created / activated / updated / paused / resumed /
 *   canceled / past_due, transaction.completed, adjustment.created
 *
 * What moved into SQL: the ordering guard, the subscription upsert and the
 * org plan mirror now run inside `apply_paddle_subscription_event` (and the
 * refund inside `apply_paddle_refund`), one transaction each. What those
 * functions do to rows is asserted against a real Postgres by
 * supabase/tests/billing-rpc-smoke.sql. This file asserts the handler side:
 * which RPC is called with which arguments, how the org is resolved, and
 * that every failed write becomes a 5xx Paddle will retry.
 *
 * The Supabase mock follows supabase-js's real contract: a failed query does
 * NOT reject, it resolves to `{ data: null, error }`. A mock that rejected
 * would hide exactly the bug C3.1 was about (an ignored `{ error }`).
 *
 * Signatures are generated locally with Paddle's HMAC scheme, so the real
 * `verifyPaddleSignature` path runs end to end.
 */

// ---- Fixtures ------------------------------------------------------------

const ORG_ID = '015a5187-d896-40b4-bef8-7d2b2d18c81d'
const OTHER_ORG_ID = '7c1e2f0a-3b4d-4e5f-8a9b-0c1d2e3f4a5b'
const CUSTOMER_ID = 'ctm_01k7h72r4gy53pt56cb6e1pdqp'
const SUB_ID = 'sub_01kpqrapmp3xmxpwjea7n30pwf'
const TXN_ID = 'txn_01kqfake0transaction0test001'
const PRICE_STARTER = 'pri_live_starter_29'
const PRICE_TEAM = 'pri_live_team_149'
const PRICE_ARCHIVED = 'pri_live_archived_old'
const SECRET = 'pdl_ntfset_test_secret_1234567890'
const OCCURRED_AT = '2026-05-18T12:00:00.000Z'

function subPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: SUB_ID,
    customer_id: CUSTOMER_ID,
    status: 'active' as const,
    items: [{ price: { id: PRICE_STARTER } }],
    current_billing_period: {
      starts_at: '2026-05-18T00:00:00.000Z',
      ends_at: '2026-06-18T00:00:00.000Z',
    },
    scheduled_change: null,
    custom_data: { organization_id: ORG_ID },
    ...overrides,
  }
}

function txPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: TXN_ID,
    customer_id: CUSTOMER_ID,
    subscription_id: SUB_ID,
    status: 'completed',
    items: [{ price: { id: PRICE_STARTER } }],
    custom_data: { organization_id: ORG_ID },
    ...overrides,
  }
}

function adjPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'adj_01test0refund0001',
    subscription_id: SUB_ID,
    transaction_id: TXN_ID,
    customer_id: CUSTOMER_ID,
    action: 'refund' as const,
    status: 'approved' as const,
    ...overrides,
  }
}

function event<T>(event_type: string, data: T, event_id = 'evt_test_' + Math.random().toString(36).slice(2, 10)) {
  return { event_id, event_type, occurred_at: OCCURRED_AT, data }
}

// ---- HMAC signing helper (mirrors Paddle's signing scheme) --------------

async function sign(body: string, ts: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret) as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const buf = await crypto.subtle.sign('HMAC', key, encoder.encode(`${ts}:${body}`) as BufferSource)
  const bytes = new Uint8Array(buf)
  let hex = ''
  for (let i = 0; i < bytes.length; i++) hex += bytes[i]!.toString(16).padStart(2, '0')
  return hex
}

async function signedHeader(body: string): Promise<string> {
  const ts = Math.floor(Date.now() / 1000).toString()
  const h1 = await sign(body, ts, SECRET)
  return `ts=${ts};h1=${h1}`
}

// ---- Supabase admin mock --------------------------------------------------

type DbError = { message: string; code?: string } | null
interface DbResult { data: unknown; error: DbError }

interface RpcCall { fn: string; params: Record<string, unknown> }
interface UpdateCall { table: string; values: Record<string, unknown>; filters: Record<string, unknown> }

const rpcCalls: RpcCall[] = []
const updateCalls: UpdateCall[] = []
let rpcResults: Record<string, DbResult> = {}
let orgsByCustomer: DbResult = { data: [], error: null }
let subLookup: DbResult = { data: null, error: null }
let checkoutLookup: DbResult = { data: null, error: null }
let checkoutUpdateError: DbError = null

function thenable<T>(resolveWith: () => T) {
  return {
    then: (onFulfilled: (v: T) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve().then(resolveWith).then(onFulfilled, onRejected),
  }
}

vi.mock('../lib/db.js', () => {
  const from = (table: string) => {
    const filters: Record<string, unknown> = {}
    const read = {
      select: () => read,
      eq: (col: string, val: unknown) => {
        filters[col] = val
        return read
      },
      limit: () => thenable(() => (table === 'organizations' ? orgsByCustomer : { data: [], error: null })),
      maybeSingle: async (): Promise<DbResult> => {
        if (table === 'subscriptions') return subLookup
        if (table === 'billing_checkout_sessions') return checkoutLookup
        return { data: null, error: null }
      },
      update: (values: Record<string, unknown>) => {
        const updateFilters: Record<string, unknown> = {}
        const chain = {
          eq: (col: string, val: unknown) => {
            updateFilters[col] = val
            return chain
          },
          neq: (col: string, val: unknown) => {
            updateFilters[`not.${col}`] = val
            return chain
          },
          ...thenable(() => {
            updateCalls.push({ table, values, filters: updateFilters })
            return { data: null, error: table === 'billing_checkout_sessions' ? checkoutUpdateError : null }
          }),
        }
        return chain
      },
    }
    return read
  }
  const rpc = async (fn: string, params: Record<string, unknown>): Promise<DbResult> => {
    rpcCalls.push({ fn, params })
    return rpcResults[fn] ?? { data: { applied: true, org_plan: null }, error: null }
  }
  return {
    supabaseAdmin: { from, rpc },
    supabaseClient: { from, rpc },
  }
})

// ---- Paddle API mock (fetchPaddleSubscription is the only thing hit) ----

const paddleSubDetail = {
  status: 'active' as const,
  items: [{ price: { id: PRICE_STARTER } }],
  current_billing_period: {
    starts_at: '2026-05-18T00:00:00.000Z',
    ends_at: '2026-06-18T00:00:00.000Z',
  },
  scheduled_change: null,
}
let paddleApiResult: typeof paddleSubDetail | null = paddleSubDetail

vi.mock('../lib/paddle.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/paddle.js')>('../lib/paddle.js')
  return {
    ...actual,
    fetchPaddleSubscription: async () => paddleApiResult,
  }
})

// ---- Test setup / teardown ----------------------------------------------

let consoleError: ReturnType<typeof vi.spyOn>
let consoleWarn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  process.env['PADDLE_NOTIFICATION_SECRET'] = SECRET
  process.env['PADDLE_PRICE_STARTER'] = PRICE_STARTER
  process.env['PADDLE_PRICE_TEAM'] = PRICE_TEAM
  rpcCalls.length = 0
  updateCalls.length = 0
  rpcResults = {}
  orgsByCustomer = { data: [], error: null }
  subLookup = { data: null, error: null }
  checkoutLookup = { data: null, error: null }
  checkoutUpdateError = null
  paddleApiResult = paddleSubDetail
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  delete process.env['PADDLE_NOTIFICATION_SECRET']
  delete process.env['PADDLE_PRICE_STARTER']
  delete process.env['PADDLE_PRICE_TEAM']
  vi.restoreAllMocks()
})

async function postWebhook(payload: unknown, opts: { headers?: Record<string, string> } = {}) {
  // Re-import inside each call so the env-driven `planForPriceId` picks up the
  // env values set in beforeEach.
  const { paddleWebhookRouter } = await import('../api/paddleWebhook.js')
  const body = JSON.stringify(payload)
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(opts.headers ?? {}),
  }
  if (!headers['Paddle-Signature'] && !opts.headers?.['Paddle-Signature']) {
    headers['Paddle-Signature'] = await signedHeader(body)
  }
  const res = await paddleWebhookRouter.request('/paddle', { method: 'POST', headers, body })
  return { res, body: (await res.json()) as Record<string, unknown> }
}

function subscriptionRpc(): Record<string, unknown> {
  const call = rpcCalls.find((c) => c.fn === 'apply_paddle_subscription_event')
  expect(call, 'apply_paddle_subscription_event was not called').toBeTruthy()
  return call!.params
}

function errorMessage(body: Record<string, unknown>): string {
  return (body['error'] as { message: string }).message
}

function loggedCodes(): string[] {
  return consoleError.mock.calls.map((args) => String(args[0]))
}

/** Structured BILLING_ANOMALY payloads logged at the given level. */
function anomalies(level: 'ERROR' | 'WARN'): Array<Record<string, unknown>> {
  const spy = level === 'ERROR' ? consoleError : consoleWarn
  return spy.mock.calls
    .map((args) => String(args[0]))
    .filter((line) => line.startsWith(`${level}[BILLING_ANOMALY]`))
    .map((line) => JSON.parse(line.slice(line.indexOf('{'))) as Record<string, unknown>)
}

function eventResult(overrides: Record<string, unknown> = {}): DbResult {
  return {
    data: {
      applied: true,
      created: false,
      org_plan: 'starter',
      plan_source: SUB_ID,
      other_live_subscriptions: [],
      ignored_live_subscriptions: [],
      ...overrides,
    },
    error: null,
  }
}

// =========================================================================
// Subscription lifecycle events (7) — happy path
// =========================================================================

describe('paddleWebhook — subscription.* lifecycle events', () => {
  it('subscription.created → applies the event through one RPC with every field', async () => {
    const { res, body } = await postWebhook(event('subscription.created', subPayload(), 'evt_created_1'))
    expect(res.status).toBe(200)
    expect(body['success']).toBe(true)

    expect(subscriptionRpc()).toEqual({
      p_organization_id: ORG_ID,
      p_paddle_subscription_id: SUB_ID,
      p_paddle_customer_id: CUSTOMER_ID,
      p_paddle_price_id: PRICE_STARTER,
      p_plan: 'starter',
      p_status: 'active',
      p_current_period_start: '2026-05-18T00:00:00.000Z',
      p_current_period_end: '2026-06-18T00:00:00.000Z',
      p_cancel_at_period_end: false,
      p_metadata: {
        last_event_id: 'evt_created_1',
        last_event_type: 'subscription.created',
        occurred_at: OCCURRED_AT,
      },
    })
    // The org plan mirror lives inside the RPC transaction now; the handler
    // must not issue a second, separately-failing organizations UPDATE.
    expect(updateCalls.find((u) => u.table === 'organizations')).toBeUndefined()
  })

  it('subscription.activated → same RPC path', async () => {
    const { res } = await postWebhook(event('subscription.activated', subPayload()))
    expect(res.status).toBe(200)
    expect(subscriptionRpc()['p_status']).toBe('active')
  })

  it('subscription.updated (upgrade to team) → passes the new plan', async () => {
    const { res } = await postWebhook(
      event('subscription.updated', subPayload({ items: [{ price: { id: PRICE_TEAM } }] })),
    )
    expect(res.status).toBe(200)
    expect(subscriptionRpc()['p_plan']).toBe('team')
  })

  it('subscription.paused → passes paused status', async () => {
    const { res } = await postWebhook(event('subscription.paused', subPayload({ status: 'paused' })))
    expect(res.status).toBe(200)
    expect(subscriptionRpc()['p_status']).toBe('paused')
  })

  it('subscription.resumed → passes active status', async () => {
    const { res } = await postWebhook(event('subscription.resumed', subPayload({ status: 'active' })))
    expect(res.status).toBe(200)
    expect(subscriptionRpc()['p_status']).toBe('active')
  })

  it('subscription.canceled → passes canceled status (plan recompute happens in SQL)', async () => {
    const { res } = await postWebhook(event('subscription.canceled', subPayload({ status: 'canceled' })))
    expect(res.status).toBe(200)
    expect(subscriptionRpc()['p_status']).toBe('canceled')
    expect(updateCalls.find((u) => u.table === 'organizations')).toBeUndefined()
  })

  it('subscription.past_due → passes past_due status', async () => {
    const { res } = await postWebhook(event('subscription.past_due', subPayload({ status: 'past_due' })))
    expect(res.status).toBe(200)
    expect(subscriptionRpc()['p_status']).toBe('past_due')
  })

  it('an event the RPC reports as out of order → 200 with applied=false (no retry wanted)', async () => {
    rpcResults['apply_paddle_subscription_event'] = { data: { applied: false, org_plan: null }, error: null }
    const { res, body } = await postWebhook(event('subscription.updated', subPayload()))
    expect(res.status).toBe(200)
    expect(body['success']).toBe(true)
    expect(body['applied']).toBe(false)
  })
})

// =========================================================================
// C3.1 — a failed write must become a 5xx so Paddle retries
// =========================================================================

describe('paddleWebhook — write failures surface as 5xx (C3.1)', () => {
  it('RPC error on an active event → 500 + structured log (was 200 before)', async () => {
    rpcResults['apply_paddle_subscription_event'] = {
      data: null,
      error: { message: 'connection refused', code: '08006' },
    }
    const { res, body } = await postWebhook(event('subscription.activated', subPayload()))
    expect(res.status).toBe(500)
    expect(errorMessage(body)).toContain('subscription event could not be applied')
    expect(errorMessage(body)).toContain('connection refused')
    expect(loggedCodes().some((l) => l.startsWith('ERROR[PADDLE_WEBHOOK_FAILED]'))).toBe(true)
  })

  it('RPC error on a canceled event → 500 (terminal event must not be lost)', async () => {
    rpcResults['apply_paddle_subscription_event'] = { data: null, error: { message: 'deadlock detected' } }
    const { res } = await postWebhook(event('subscription.canceled', subPayload({ status: 'canceled' })))
    expect(res.status).toBe(500)
  })

  it('RPC error on transaction.completed → 500', async () => {
    rpcResults['apply_paddle_subscription_event'] = { data: null, error: { message: 'timeout' } }
    const { res } = await postWebhook(event('transaction.completed', txPayload()))
    expect(res.status).toBe(500)
  })

  it('approved refund whose plan write fails → 500 (was 200 + "downgraded" log)', async () => {
    subLookup = { data: { organization_id: ORG_ID }, error: null }
    rpcResults['apply_paddle_refund'] = { data: null, error: { message: 'connection reset' } }
    const { res, body } = await postWebhook(event('adjustment.created', adjPayload()))
    expect(res.status).toBe(500)
    expect(errorMessage(body)).toContain('refund could not be applied')
    expect(loggedCodes().some((l) => l.startsWith('ERROR[PADDLE_WEBHOOK_FAILED]'))).toBe(true)
  })

  it('a retry of the same event calls the RPC again with identical arguments', async () => {
    // The SQL guard re-applies an event whose occurred_at equals the stored
    // one, which is what makes a Paddle retry after a 5xx useful. The
    // handler must not add its own "already seen" short-circuit on top.
    const payload = event('subscription.activated', subPayload(), 'evt_retry_1')
    rpcResults['apply_paddle_subscription_event'] = { data: null, error: { message: 'transient' } }
    const first = await postWebhook(payload)
    expect(first.res.status).toBe(500)

    rpcResults['apply_paddle_subscription_event'] = { data: { applied: true, org_plan: 'starter' }, error: null }
    const second = await postWebhook(payload)
    expect(second.res.status).toBe(200)

    const calls = rpcCalls.filter((c) => c.fn === 'apply_paddle_subscription_event')
    expect(calls).toHaveLength(2)
    expect(calls[0]!.params).toEqual(calls[1]!.params)
  })
})

// =========================================================================
// C4.1 — org resolution order
// =========================================================================

describe('paddleWebhook — org resolution (C4.1)', () => {
  it('custom_data wins over every lookup', async () => {
    subLookup = { data: { organization_id: OTHER_ORG_ID }, error: null }
    const { res } = await postWebhook(event('subscription.updated', subPayload()))
    expect(res.status).toBe(200)
    expect(subscriptionRpc()['p_organization_id']).toBe(ORG_ID)
  })

  it('no custom_data → resolves through the stored subscription even when the customer is shared', async () => {
    subLookup = { data: { organization_id: ORG_ID }, error: null }
    orgsByCustomer = { data: [{ id: ORG_ID }, { id: OTHER_ORG_ID }], error: null }
    const { res } = await postWebhook(event('subscription.updated', subPayload({ custom_data: null })))
    expect(res.status).toBe(200)
    expect(subscriptionRpc()['p_organization_id']).toBe(ORG_ID)
  })

  it('a custom_data organization_id that is not a UUID is ignored, not trusted', async () => {
    subLookup = { data: { organization_id: ORG_ID }, error: null }
    const { res } = await postWebhook(
      event('subscription.updated', subPayload({ custom_data: { organization_id: 'not-a-uuid' } })),
    )
    expect(res.status).toBe(200)
    expect(subscriptionRpc()['p_organization_id']).toBe(ORG_ID)
  })

  it('new subscription without custom_data → resolves through the checkout transaction', async () => {
    checkoutLookup = { data: { organization_id: ORG_ID }, error: null }
    orgsByCustomer = { data: [{ id: ORG_ID }, { id: OTHER_ORG_ID }], error: null }
    const { res } = await postWebhook(
      event('subscription.created', subPayload({ custom_data: null, transaction_id: TXN_ID })),
    )
    expect(res.status).toBe(200)
    expect(subscriptionRpc()['p_organization_id']).toBe(ORG_ID)
  })

  it('customer fallback resolves when exactly one org owns the customer', async () => {
    orgsByCustomer = { data: [{ id: ORG_ID }], error: null }
    const { res } = await postWebhook(event('subscription.created', subPayload({ custom_data: null })))
    expect(res.status).toBe(200)
    expect(subscriptionRpc()['p_organization_id']).toBe(ORG_ID)
  })

  it('customer shared by two orgs and nothing else to go on → 400, nothing written', async () => {
    orgsByCustomer = { data: [{ id: ORG_ID }, { id: OTHER_ORG_ID }], error: null }
    const { res, body } = await postWebhook(event('subscription.created', subPayload({ custom_data: null })))
    expect(res.status).toBe(400)
    expect(errorMessage(body)).toBe('organization not found')
    expect(rpcCalls).toHaveLength(0)
  })

  it('returns 400 when org cannot be resolved from any source', async () => {
    const { res, body } = await postWebhook(event('subscription.created', subPayload({ custom_data: null })))
    expect(res.status).toBe(400)
    expect(errorMessage(body)).toBe('organization not found')
  })

  it('a lookup that errors → 500, never a guess (and never a 400 Paddle gives up on)', async () => {
    subLookup = { data: null, error: { message: 'connection refused' } }
    const { res } = await postWebhook(event('subscription.updated', subPayload({ custom_data: null })))
    expect(res.status).toBe(500)
    expect(rpcCalls).toHaveLength(0)
  })

  it('refund resolves through its subscription, not the (shared) customer', async () => {
    subLookup = { data: { organization_id: ORG_ID }, error: null }
    orgsByCustomer = { data: [{ id: ORG_ID }, { id: OTHER_ORG_ID }], error: null }
    const { res } = await postWebhook(event('adjustment.created', adjPayload()))
    expect(res.status).toBe(200)
    const call = rpcCalls.find((c) => c.fn === 'apply_paddle_refund')
    expect(call?.params).toEqual({ p_organization_id: ORG_ID, p_paddle_subscription_id: SUB_ID })
  })

  it('refund without a known subscription resolves through the checkout transaction', async () => {
    checkoutLookup = { data: { organization_id: ORG_ID }, error: null }
    orgsByCustomer = { data: [{ id: ORG_ID }, { id: OTHER_ORG_ID }], error: null }
    const { res } = await postWebhook(event('adjustment.created', adjPayload({ subscription_id: null })))
    expect(res.status).toBe(200)
    const call = rpcCalls.find((c) => c.fn === 'apply_paddle_refund')
    expect(call?.params).toEqual({ p_organization_id: ORG_ID, p_paddle_subscription_id: null })
  })
})

// =========================================================================
// Subscription lifecycle — edge cases that previously broke prod
// =========================================================================

describe('paddleWebhook — subscription.* edge cases', () => {
  it('non-cancel event with missing price id → 200 skipped (not 4xx — avoids Paddle retry storm)', async () => {
    const { res, body } = await postWebhook(event('subscription.created', subPayload({ items: [] })))
    expect(res.status).toBe(200)
    expect(body['skipped']).toBe('missing price id')
    expect(rpcCalls).toHaveLength(0)
  })

  it('non-cancel event with unknown price id → 200 skipped, surfaces price_id for ops', async () => {
    const { res, body } = await postWebhook(
      event('subscription.created', subPayload({ items: [{ price: { id: 'pri_live_unconfigured_99' } }] })),
    )
    expect(res.status).toBe(200)
    expect(body['skipped']).toBe('unknown price id')
    expect(body['price_id']).toBe('pri_live_unconfigured_99')
    expect(body['event_id']).toBeTruthy()
    expect(rpcCalls).toHaveLength(0)
  })

  it('cancellation event with archived price id → uses the stored row plan / price', async () => {
    subLookup = { data: { organization_id: ORG_ID, plan: 'team', paddle_price_id: PRICE_TEAM }, error: null }
    const { res } = await postWebhook(
      event('subscription.canceled', subPayload({ status: 'canceled', items: [{ price: { id: PRICE_ARCHIVED } }] })),
    )
    expect(res.status).toBe(200)
    const params = subscriptionRpc()
    expect(params['p_plan']).toBe('team')
    expect(params['p_paddle_price_id']).toBe(PRICE_TEAM)
    expect(params['p_status']).toBe('canceled')
  })

  it('cancellation event with archived price + no DB row → defaults to starter (last-resort guess)', async () => {
    const { res } = await postWebhook(
      event('subscription.canceled', subPayload({ status: 'canceled', items: [{ price: { id: PRICE_ARCHIVED } }] })),
    )
    expect(res.status).toBe(200)
    const params = subscriptionRpc()
    expect(params['p_plan']).toBe('starter')
    expect(params['p_paddle_price_id']).toBe(PRICE_ARCHIVED)
  })

  it('cancellation fallback lookup that errors → 500 instead of guessing a plan', async () => {
    subLookup = { data: null, error: { message: 'connection refused' } }
    const { res } = await postWebhook(
      event('subscription.canceled', subPayload({ status: 'canceled', items: [{ price: { id: PRICE_ARCHIVED } }] })),
    )
    expect(res.status).toBe(500)
    expect(rpcCalls).toHaveLength(0)
  })

  it('subscription with scheduled cancel → cancel_at_period_end=true', async () => {
    const { res } = await postWebhook(
      event('subscription.updated', subPayload({ scheduled_change: { action: 'cancel' } })),
    )
    expect(res.status).toBe(200)
    expect(subscriptionRpc()['p_cancel_at_period_end']).toBe(true)
  })
})

// =========================================================================
// transaction.completed fallback (event 8)
// =========================================================================

describe('paddleWebhook — transaction.completed', () => {
  it('enriches via Paddle API fetch and applies a synthetic subscription event', async () => {
    const { res, body } = await postWebhook(event('transaction.completed', txPayload()))
    expect(res.status).toBe(200)
    expect(body['success']).toBe(true)

    const params = subscriptionRpc()
    expect(params['p_paddle_subscription_id']).toBe(SUB_ID)
    expect(params['p_paddle_price_id']).toBe(PRICE_STARTER)
    expect(params['p_plan']).toBe('starter')
    // current_billing_period came from the Paddle API mock, not the tx payload
    expect(params['p_current_period_end']).toBe('2026-06-18T00:00:00.000Z')
  })

  it('marks the originating checkout session completed (C4.2 checkout idempotency)', async () => {
    const { res } = await postWebhook(event('transaction.completed', txPayload()))
    expect(res.status).toBe(200)
    const update = updateCalls.find((u) => u.table === 'billing_checkout_sessions')
    expect(update?.values['status']).toBe('completed')
    expect(update?.filters['paddle_transaction_id']).toBe(TXN_ID)
  })

  it('a failed checkout-session update is logged but does not fail the event', async () => {
    checkoutUpdateError = { message: 'relation does not exist' }
    const { res } = await postWebhook(event('transaction.completed', txPayload()))
    expect(res.status).toBe(200)
    expect(loggedCodes().some((l) => l.startsWith('ERROR[PADDLE_WEBHOOK_FAILED]'))).toBe(true)
  })

  it('without custom_data → resolves through its subscription id', async () => {
    subLookup = { data: { organization_id: ORG_ID }, error: null }
    const { res } = await postWebhook(event('transaction.completed', txPayload({ custom_data: null })))
    expect(res.status).toBe(200)
    expect(subscriptionRpc()['p_organization_id']).toBe(ORG_ID)
  })

  it('falls back to active + tx.items when Paddle API enrichment returns null', async () => {
    paddleApiResult = null
    const { res } = await postWebhook(event('transaction.completed', txPayload()))
    expect(res.status).toBe(200)
    const params = subscriptionRpc()
    expect(params['p_status']).toBe('active')
    expect(params['p_plan']).toBe('starter')
    expect(params['p_current_period_end']).toBeNull()
  })

  it('one-time (non-subscription) transactions are acknowledged and skipped', async () => {
    const { res, body } = await postWebhook(event('transaction.completed', txPayload({ subscription_id: null })))
    expect(res.status).toBe(200)
    expect(body['skipped']).toBe('non-subscription transaction')
    expect(rpcCalls).toHaveLength(0)
  })

  it('missing price id in transaction → 400 (Paddle WILL retry; surface the bug)', async () => {
    const { res, body } = await postWebhook(event('transaction.completed', txPayload({ items: [] })))
    expect(res.status).toBe(400)
    expect(errorMessage(body)).toBe('missing price id')
  })

  it('unknown price id in transaction → 200 skipped (avoid retry storm)', async () => {
    const { res, body } = await postWebhook(
      event('transaction.completed', txPayload({ items: [{ price: { id: 'pri_live_unconfigured_99' } }] })),
    )
    expect(res.status).toBe(200)
    expect(body['skipped']).toBe('unknown price id')
    expect(body['price_id']).toBe('pri_live_unconfigured_99')
  })
})

// =========================================================================
// adjustment.created (event 9) — refund handling
// =========================================================================

describe('paddleWebhook — adjustment.created', () => {
  beforeEach(() => {
    subLookup = { data: { organization_id: ORG_ID }, error: null }
  })

  it('approved refund → recomputes the org plan without the refunded subscription', async () => {
    rpcResults['apply_paddle_refund'] = { data: { org_plan: 'free' }, error: null }
    const { res, body } = await postWebhook(event('adjustment.created', adjPayload()))
    expect(res.status).toBe(200)
    expect(body['success']).toBe(true)
    expect(rpcCalls).toEqual([
      { fn: 'apply_paddle_refund', params: { p_organization_id: ORG_ID, p_paddle_subscription_id: SUB_ID } },
    ])
  })

  it('pending refund (not yet approved) → no plan change', async () => {
    const { res } = await postWebhook(event('adjustment.created', adjPayload({ status: 'pending_approval' })))
    expect(res.status).toBe(200)
    expect(rpcCalls).toHaveLength(0)
  })

  it('credit (non-refund adjustment) → no plan change', async () => {
    const { res } = await postWebhook(event('adjustment.created', adjPayload({ action: 'credit' })))
    expect(res.status).toBe(200)
    expect(rpcCalls).toHaveLength(0)
  })

  it('approved refund with org not found → 400 (so ops can investigate)', async () => {
    subLookup = { data: null, error: null }
    const { res, body } = await postWebhook(event('adjustment.created', adjPayload()))
    expect(res.status).toBe(400)
    expect(errorMessage(body)).toBe('organization not found')
  })
})

// =========================================================================
// Plan anomalies — surfaced, never silent (review of the C4.2 fix)
// =========================================================================
//
// The recompute keeps an org on another live subscription's plan instead of
// forcing 'free'. That is right for a real sibling and wrong for a stale row
// (lost cancel webhook, sandbox leftover), and a second subscription created
// for an org that already pays means the customer is billed twice. The SQL
// reports all three; the handler must turn them into log lines ops can find.

describe('paddleWebhook — plan anomalies are logged', () => {
  it('a NEW subscription for an org that already pays for one → ERROR duplicate_live_subscription, still 200', async () => {
    rpcResults['apply_paddle_subscription_event'] = eventResult({
      created: true,
      org_plan: 'team',
      plan_source: 'sub_other_live',
      other_live_subscriptions: ['sub_other_live'],
    })
    const { res } = await postWebhook(event('subscription.created', subPayload(), 'evt_dup_1'))
    expect(res.status).toBe(200)
    expect(anomalies('ERROR')).toEqual([
      expect.objectContaining({
        reason: 'duplicate_live_subscription',
        orgId: ORG_ID,
        paddleSubscriptionId: SUB_ID,
        otherLiveSubscriptions: ['sub_other_live'],
        eventId: 'evt_dup_1',
      }),
    ])
  })

  it('an update of an existing subscription that has a live sibling is not a duplicate alert', async () => {
    rpcResults['apply_paddle_subscription_event'] = eventResult({
      created: false,
      other_live_subscriptions: ['sub_other_live'],
    })
    const { res } = await postWebhook(event('subscription.updated', subPayload()))
    expect(res.status).toBe(200)
    expect(anomalies('ERROR')).toEqual([])
  })

  it('a cancel that leaves the org on a sibling plan → WARN plan_kept_by_sibling', async () => {
    rpcResults['apply_paddle_subscription_event'] = eventResult({
      org_plan: 'team',
      plan_source: 'sub_other_live',
      other_live_subscriptions: ['sub_other_live'],
    })
    const { res } = await postWebhook(event('subscription.canceled', subPayload({ status: 'canceled' })))
    expect(res.status).toBe(200)
    expect(anomalies('WARN')).toEqual([
      expect.objectContaining({
        reason: 'plan_kept_by_sibling',
        trigger: 'subscription_event',
        orgId: ORG_ID,
        paddleSubscriptionId: SUB_ID,
        orgPlan: 'team',
        planSource: 'sub_other_live',
      }),
    ])
  })

  it('a cancel that lands on free logs nothing', async () => {
    rpcResults['apply_paddle_subscription_event'] = eventResult({ org_plan: 'free', plan_source: null })
    await postWebhook(event('subscription.canceled', subPayload({ status: 'canceled' })))
    expect(anomalies('WARN')).toEqual([])
    expect(anomalies('ERROR')).toEqual([])
  })

  it('live rows the recompute ignored as stale → WARN stale_live_subscription_ignored', async () => {
    rpcResults['apply_paddle_subscription_event'] = eventResult({
      org_plan: 'free',
      plan_source: null,
      ignored_live_subscriptions: ['sub_lost_cancel', 'sub_sandbox'],
    })
    await postWebhook(event('subscription.canceled', subPayload({ status: 'canceled' })))
    expect(anomalies('WARN')).toEqual([
      expect.objectContaining({
        reason: 'stale_live_subscription_ignored',
        orgId: ORG_ID,
        ignoredLiveSubscriptions: ['sub_lost_cancel', 'sub_sandbox'],
      }),
    ])
  })

  it('an approved refund that leaves the org on a sibling plan → WARN plan_kept_by_sibling', async () => {
    subLookup = { data: { organization_id: ORG_ID }, error: null }
    rpcResults['apply_paddle_refund'] = {
      data: { org_plan: 'team', plan_source: 'sub_other_live', ignored_live_subscriptions: [] },
      error: null,
    }
    const { res } = await postWebhook(event('adjustment.created', adjPayload()))
    expect(res.status).toBe(200)
    expect(anomalies('WARN')).toEqual([
      expect.objectContaining({ reason: 'plan_kept_by_sibling', trigger: 'refund', orgPlan: 'team' }),
    ])
  })

  it('an ordinary first subscription logs no anomaly', async () => {
    rpcResults['apply_paddle_subscription_event'] = eventResult({ created: true })
    await postWebhook(event('subscription.created', subPayload()))
    expect(anomalies('ERROR')).toEqual([])
    expect(anomalies('WARN')).toEqual([])
  })
})

// =========================================================================
// Signature verification + generic edge cases
// =========================================================================

describe('paddleWebhook — signature & misc edge cases', () => {
  it('rejects a tampered body with 401', async () => {
    const original = JSON.stringify(event('subscription.created', subPayload()))
    const header = await signedHeader(original)
    const tampered = original.replace(SUB_ID, 'sub_attacker_injected')
    const { paddleWebhookRouter } = await import('../api/paddleWebhook.js')
    const res = await paddleWebhookRouter.request('/paddle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Paddle-Signature': header },
      body: tampered,
    })
    expect(res.status).toBe(401)
    expect(rpcCalls).toHaveLength(0)
  })

  it('rejects missing Paddle-Signature header with 401', async () => {
    const { paddleWebhookRouter } = await import('../api/paddleWebhook.js')
    const res = await paddleWebhookRouter.request('/paddle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event('subscription.created', subPayload())),
    })
    expect(res.status).toBe(401)
  })

  it('rejects malformed JSON body (after passing signature) with 400', async () => {
    const garbage = 'not-valid-json{'
    const { paddleWebhookRouter } = await import('../api/paddleWebhook.js')
    const res = await paddleWebhookRouter.request('/paddle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Paddle-Signature': await signedHeader(garbage) },
      body: garbage,
    })
    expect(res.status).toBe(400)
  })

  it('acknowledges unknown event types without processing (forward-compat)', async () => {
    const { res, body } = await postWebhook(event('customer.created', { id: CUSTOMER_ID }))
    expect(res.status).toBe(200)
    expect(body['skipped']).toBe('customer.created')
    expect(rpcCalls).toHaveLength(0)
  })
})
