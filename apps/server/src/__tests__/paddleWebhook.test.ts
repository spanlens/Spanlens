import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Paddle webhook handler — fixture-based unit tests (P1.5).
 *
 * Covers all 9 event types the Spanlens server subscribes to:
 *
 *   subscription.created
 *   subscription.activated
 *   subscription.updated
 *   subscription.paused
 *   subscription.resumed
 *   subscription.canceled
 *   subscription.past_due
 *   transaction.completed
 *   adjustment.created
 *
 * Plus the edge cases that previously bit production (CLAUDE.md gotchas #6/#7/#7a):
 *   - tampered signature → 401
 *   - missing custom_data → org resolved via paddle_customer_id fallback
 *   - missing/unknown price id → 200 with `skipped` payload (not 4xx — Paddle
 *     would otherwise retry forever and flood logs)
 *   - cancellation event with archived price id → upsert succeeds via DB
 *     fallback to the existing row's plan / price
 *   - adjustment.created with action='credit' or status='pending_approval'
 *     → does NOT downgrade plan
 *   - transaction.completed without subscription_id → ack and skip
 *
 * Real Supabase / Paddle API are mocked. Signatures are generated locally with
 * the same HMAC routine Paddle uses, so the actual `verifyPaddleSignature` path
 * is exercised end-to-end (no signature mocking).
 */

// ---- Fixtures ------------------------------------------------------------

const ORG_ID = '015a5187-d896-40b4-bef8-7d2b2d18c81d'
const CUSTOMER_ID = 'ctm_01k7h72r4gy53pt56cb6e1pdqp'
const SUB_ID = 'sub_01kpqrapmp3xmxpwjea7n30pwf'
const TXN_ID = 'txn_01kqfake0transaction0test001'
const PRICE_STARTER = 'pri_live_starter_29'
const PRICE_TEAM = 'pri_live_team_149'
const PRICE_ARCHIVED = 'pri_live_archived_old'
const SECRET = 'pdl_ntfset_test_secret_1234567890'

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
    customer_id: CUSTOMER_ID,
    action: 'refund' as const,
    status: 'approved' as const,
    ...overrides,
  }
}

function event<T>(event_type: string, data: T, event_id = 'evt_test_' + Math.random().toString(36).slice(2, 10)) {
  return {
    event_id,
    event_type,
    occurred_at: '2026-05-18T12:00:00.000Z',
    data,
  }
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
  const buf = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${ts}:${body}`) as BufferSource,
  )
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
//
// Captures every operation so tests can assert what would have been written.
// Default `select` returns null (org/sub not found); tests opt into found rows
// via `setOrgLookup` / `setSubLookup`.

interface CapturedWrite {
  table: string
  op: 'upsert' | 'update'
  values: Record<string, unknown>
  match?: Record<string, unknown>
  conflict?: string
}

const captured: CapturedWrite[] = []
let orgLookupResult: { id: string } | null = null
let subLookupResult: { plan: string; paddle_price_id: string } | null = null
let nextWriteError: string | null = null

function setOrgLookup(result: { id: string } | null) {
  orgLookupResult = result
}
function setSubLookup(result: { plan: string; paddle_price_id: string } | null) {
  subLookupResult = result
}
function failNextWriteWith(message: string) {
  nextWriteError = message
}

vi.mock('../lib/db.js', () => {
  const builder = (table: string) => {
    const ctx: { match: Record<string, unknown> } = { match: {} }
    const chain = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        ctx.match[col] = val
        return chain
      },
      maybeSingle: async () => {
        if (table === 'organizations') return { data: orgLookupResult, error: null }
        if (table === 'subscriptions') return { data: subLookupResult, error: null }
        return { data: null, error: null }
      },
      single: async () => {
        if (table === 'organizations') return { data: orgLookupResult, error: null }
        return { data: null, error: null }
      },
      upsert: async (values: Record<string, unknown>, opts?: { onConflict?: string }) => {
        const err = nextWriteError
        nextWriteError = null
        const entry: CapturedWrite = { table, op: 'upsert', values }
        if (opts?.onConflict) entry.conflict = opts.onConflict
        captured.push(entry)
        return { error: err ? { message: err } : null }
      },
      update: (values: Record<string, unknown>) => {
        return {
          eq: async (col: string, val: unknown) => {
            captured.push({ table, op: 'update', values, match: { [col]: val } })
            return { error: null }
          },
        }
      },
    }
    return chain
  }
  return {
    supabaseAdmin: { from: (t: string) => builder(t) },
    supabaseClient: { from: (t: string) => builder(t) },
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

beforeEach(() => {
  process.env['PADDLE_NOTIFICATION_SECRET'] = SECRET
  process.env['PADDLE_PRICE_STARTER'] = PRICE_STARTER
  process.env['PADDLE_PRICE_TEAM'] = PRICE_TEAM
  captured.length = 0
  orgLookupResult = null
  subLookupResult = null
  nextWriteError = null
  paddleApiResult = paddleSubDetail
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
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
  const res = await paddleWebhookRouter.request('/paddle', {
    method: 'POST',
    headers,
    body,
  })
  return { res, body: (await res.json()) as Record<string, unknown> }
}

// =========================================================================
// Subscription lifecycle events (7) — happy path
// =========================================================================

describe('paddleWebhook — subscription.* lifecycle events', () => {
  beforeEach(() => {
    // Default: org resolved via custom_data, so lookup not needed
    setOrgLookup({ id: ORG_ID })
  })

  it('subscription.created → upserts subscriptions row + mirrors plan onto organizations', async () => {
    const { res, body } = await postWebhook(event('subscription.created', subPayload()))
    expect(res.status).toBe(200)
    expect(body['success']).toBe(true)

    const subUpsert = captured.find((c) => c.table === 'subscriptions' && c.op === 'upsert')
    expect(subUpsert).toBeTruthy()
    expect(subUpsert!.values['paddle_subscription_id']).toBe(SUB_ID)
    expect(subUpsert!.values['paddle_customer_id']).toBe(CUSTOMER_ID)
    expect(subUpsert!.values['paddle_price_id']).toBe(PRICE_STARTER)
    expect(subUpsert!.values['plan']).toBe('starter')
    expect(subUpsert!.values['status']).toBe('active')
    expect(subUpsert!.values['current_period_start']).toBe('2026-05-18T00:00:00.000Z')
    expect(subUpsert!.values['current_period_end']).toBe('2026-06-18T00:00:00.000Z')
    expect(subUpsert!.conflict).toBe('paddle_subscription_id')

    const orgUpdate = captured.find((c) => c.table === 'organizations' && c.op === 'update')
    expect(orgUpdate).toBeTruthy()
    expect(orgUpdate!.values['plan']).toBe('starter')
    expect(orgUpdate!.values['paddle_customer_id']).toBe(CUSTOMER_ID)
  })

  it('subscription.activated → same upsert path', async () => {
    const { res } = await postWebhook(event('subscription.activated', subPayload()))
    expect(res.status).toBe(200)
    expect(captured.find((c) => c.table === 'subscriptions')).toBeTruthy()
  })

  it('subscription.updated (e.g. upgrade to team) → upserts new plan onto org', async () => {
    const payload = subPayload({ items: [{ price: { id: PRICE_TEAM } }] })
    const { res } = await postWebhook(event('subscription.updated', payload))
    expect(res.status).toBe(200)
    const subUpsert = captured.find((c) => c.table === 'subscriptions' && c.op === 'upsert')
    expect(subUpsert!.values['plan']).toBe('team')
    const orgUpdate = captured.find((c) => c.table === 'organizations' && c.op === 'update')
    expect(orgUpdate!.values['plan']).toBe('team')
  })

  it('subscription.paused → upserts paused status WITHOUT updating org.plan', async () => {
    const { res } = await postWebhook(
      event('subscription.paused', subPayload({ status: 'paused' })),
    )
    expect(res.status).toBe(200)
    const subUpsert = captured.find((c) => c.table === 'subscriptions' && c.op === 'upsert')
    expect(subUpsert!.values['status']).toBe('paused')
    // org.plan is mirrored only on active/trialing/canceled — pause leaves
    // the org on its current plan until renewal resumes or cancel fires.
    expect(captured.find((c) => c.table === 'organizations' && c.op === 'update')).toBeUndefined()
  })

  it('subscription.resumed → org back on paid plan', async () => {
    const { res } = await postWebhook(
      event('subscription.resumed', subPayload({ status: 'active' })),
    )
    expect(res.status).toBe(200)
    const orgUpdate = captured.find((c) => c.table === 'organizations' && c.op === 'update')
    expect(orgUpdate!.values['plan']).toBe('starter')
  })

  it('subscription.canceled with current price → upserts canceled + org → free', async () => {
    const { res } = await postWebhook(
      event('subscription.canceled', subPayload({ status: 'canceled' })),
    )
    expect(res.status).toBe(200)
    const subUpsert = captured.find((c) => c.table === 'subscriptions' && c.op === 'upsert')
    expect(subUpsert!.values['status']).toBe('canceled')
    const orgUpdate = captured.find((c) => c.table === 'organizations' && c.op === 'update')
    expect(orgUpdate!.values['plan']).toBe('free')
  })

  it('subscription.past_due → upserts past_due status WITHOUT downgrading org plan', async () => {
    const { res } = await postWebhook(
      event('subscription.past_due', subPayload({ status: 'past_due' })),
    )
    expect(res.status).toBe(200)
    const subUpsert = captured.find((c) => c.table === 'subscriptions' && c.op === 'upsert')
    expect(subUpsert!.values['status']).toBe('past_due')
    expect(captured.find((c) => c.table === 'organizations' && c.op === 'update')).toBeUndefined()
  })
})

// =========================================================================
// Subscription lifecycle — edge cases that previously broke prod
// =========================================================================

describe('paddleWebhook — subscription.* edge cases', () => {
  it('falls back to paddle_customer_id lookup when custom_data is missing', async () => {
    // Paddle subscription events often arrive with empty custom_data because
    // it does not inherit from the originating transaction. We must resolve
    // the org from the customer mapping written at checkout time.
    setOrgLookup({ id: ORG_ID })
    const { res } = await postWebhook(
      event('subscription.created', subPayload({ custom_data: null })),
    )
    expect(res.status).toBe(200)
    const subUpsert = captured.find((c) => c.table === 'subscriptions' && c.op === 'upsert')
    expect(subUpsert!.values['organization_id']).toBe(ORG_ID)
  })

  it('returns 400 when org cannot be resolved from either source', async () => {
    setOrgLookup(null)
    const { res, body } = await postWebhook(
      event('subscription.created', subPayload({ custom_data: null })),
    )
    expect(res.status).toBe(400)
    expect((body['error'] as { message: string }).message).toBe('organization not found')
  })

  it('non-cancel event with missing price id → 200 skipped (not 4xx — avoids Paddle retry storm)', async () => {
    setOrgLookup({ id: ORG_ID })
    const { res, body } = await postWebhook(
      event('subscription.created', subPayload({ items: [] })),
    )
    expect(res.status).toBe(200)
    expect(body['skipped']).toBe('missing price id')
    expect(captured).toHaveLength(0)
  })

  it('non-cancel event with unknown price id → 200 skipped, surfaces price_id for ops', async () => {
    setOrgLookup({ id: ORG_ID })
    const { res, body } = await postWebhook(
      event(
        'subscription.created',
        subPayload({ items: [{ price: { id: 'pri_live_unconfigured_99' } }] }),
      ),
    )
    expect(res.status).toBe(200)
    expect(body['skipped']).toBe('unknown price id')
    expect(body['price_id']).toBe('pri_live_unconfigured_99')
    expect(body['event_id']).toBeTruthy()
    expect(captured).toHaveLength(0)
  })

  it('cancellation event with archived price id → upserts using DB row fallback', async () => {
    setOrgLookup({ id: ORG_ID })
    setSubLookup({ plan: 'team', paddle_price_id: PRICE_TEAM })
    const { res } = await postWebhook(
      event(
        'subscription.canceled',
        subPayload({
          status: 'canceled',
          items: [{ price: { id: PRICE_ARCHIVED } }],
        }),
      ),
    )
    expect(res.status).toBe(200)
    const subUpsert = captured.find((c) => c.table === 'subscriptions' && c.op === 'upsert')
    expect(subUpsert!.values['plan']).toBe('team')
    expect(subUpsert!.values['paddle_price_id']).toBe(PRICE_TEAM)
    expect(subUpsert!.values['status']).toBe('canceled')
  })

  it('cancellation event with archived price + no DB row → defaults to starter (last-resort guess)', async () => {
    setOrgLookup({ id: ORG_ID })
    setSubLookup(null)
    const { res } = await postWebhook(
      event(
        'subscription.canceled',
        subPayload({
          status: 'canceled',
          items: [{ price: { id: PRICE_ARCHIVED } }],
        }),
      ),
    )
    expect(res.status).toBe(200)
    const subUpsert = captured.find((c) => c.table === 'subscriptions' && c.op === 'upsert')
    expect(subUpsert!.values['plan']).toBe('starter')
    expect(subUpsert!.values['paddle_price_id']).toBe(PRICE_ARCHIVED)
  })

  it('subscription with scheduled cancel → upserts cancel_at_period_end=true', async () => {
    setOrgLookup({ id: ORG_ID })
    const { res } = await postWebhook(
      event(
        'subscription.updated',
        subPayload({ scheduled_change: { action: 'cancel' } }),
      ),
    )
    expect(res.status).toBe(200)
    const subUpsert = captured.find((c) => c.table === 'subscriptions' && c.op === 'upsert')
    expect(subUpsert!.values['cancel_at_period_end']).toBe(true)
  })

  it('returns 500 when the upsert itself fails (caller can retry)', async () => {
    setOrgLookup({ id: ORG_ID })
    failNextWriteWith('connection refused')
    const { res, body } = await postWebhook(event('subscription.created', subPayload()))
    expect(res.status).toBe(500)
    expect(body['error']).toContain('subscription upsert failed')
    expect(body['error']).toContain('connection refused')
  })
})

// =========================================================================
// transaction.completed fallback (event 8)
// =========================================================================

describe('paddleWebhook — transaction.completed', () => {
  beforeEach(() => {
    setOrgLookup({ id: ORG_ID })
  })

  it('enriches via Paddle API fetch and upserts a synthetic subscription row', async () => {
    const { res, body } = await postWebhook(event('transaction.completed', txPayload()))
    expect(res.status).toBe(200)
    expect(body['success']).toBe(true)

    const subUpsert = captured.find((c) => c.table === 'subscriptions' && c.op === 'upsert')
    expect(subUpsert!.values['paddle_subscription_id']).toBe(SUB_ID)
    expect(subUpsert!.values['paddle_price_id']).toBe(PRICE_STARTER)
    expect(subUpsert!.values['plan']).toBe('starter')
    // current_billing_period came from the Paddle API mock, not the tx payload
    expect(subUpsert!.values['current_period_end']).toBe('2026-06-18T00:00:00.000Z')
  })

  it('falls back to active + tx.items when Paddle API enrichment returns null', async () => {
    paddleApiResult = null
    const { res } = await postWebhook(event('transaction.completed', txPayload()))
    expect(res.status).toBe(200)
    const subUpsert = captured.find((c) => c.table === 'subscriptions' && c.op === 'upsert')
    expect(subUpsert!.values['status']).toBe('active')
    expect(subUpsert!.values['plan']).toBe('starter')
    expect(subUpsert!.values['current_period_end']).toBeNull()
  })

  it('one-time (non-subscription) transactions are acknowledged and skipped', async () => {
    const { res, body } = await postWebhook(
      event('transaction.completed', txPayload({ subscription_id: null })),
    )
    expect(res.status).toBe(200)
    expect(body['skipped']).toBe('non-subscription transaction')
    expect(captured).toHaveLength(0)
  })

  it('missing price id in transaction → 400 (Paddle WILL retry; surface the bug)', async () => {
    const { res, body } = await postWebhook(
      event('transaction.completed', txPayload({ items: [] })),
    )
    expect(res.status).toBe(400)
    expect((body['error'] as { message: string }).message).toBe('missing price id')
  })

  it('unknown price id in transaction → 200 skipped (avoid retry storm)', async () => {
    const { res, body } = await postWebhook(
      event(
        'transaction.completed',
        txPayload({ items: [{ price: { id: 'pri_live_unconfigured_99' } }] }),
      ),
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
    setOrgLookup({ id: ORG_ID })
  })

  it('approved refund → downgrades org plan to free', async () => {
    const { res, body } = await postWebhook(event('adjustment.created', adjPayload()))
    expect(res.status).toBe(200)
    expect(body['success']).toBe(true)
    const orgUpdate = captured.find((c) => c.table === 'organizations' && c.op === 'update')
    expect(orgUpdate!.values['plan']).toBe('free')
    expect(orgUpdate!.match!['id']).toBe(ORG_ID)
  })

  it('pending refund (not yet approved) → does NOT downgrade plan', async () => {
    const { res } = await postWebhook(
      event('adjustment.created', adjPayload({ status: 'pending_approval' })),
    )
    expect(res.status).toBe(200)
    expect(captured.find((c) => c.table === 'organizations')).toBeUndefined()
  })

  it('credit (non-refund adjustment) → does NOT downgrade plan', async () => {
    const { res } = await postWebhook(
      event('adjustment.created', adjPayload({ action: 'credit' })),
    )
    expect(res.status).toBe(200)
    expect(captured.find((c) => c.table === 'organizations')).toBeUndefined()
  })

  it('approved refund with org not found → 400 (so ops can investigate)', async () => {
    setOrgLookup(null)
    const { res, body } = await postWebhook(event('adjustment.created', adjPayload()))
    expect(res.status).toBe(400)
    expect((body['error'] as { message: string }).message).toBe('organization not found')
  })
})

// =========================================================================
// Signature verification + generic edge cases
// =========================================================================

describe('paddleWebhook — signature & misc edge cases', () => {
  it('rejects a tampered body with 401', async () => {
    const original = JSON.stringify(event('subscription.created', subPayload()))
    const header = await signedHeader(original)
    // Tamper AFTER signing
    const tampered = original.replace(SUB_ID, 'sub_attacker_injected')
    const { paddleWebhookRouter } = await import('../api/paddleWebhook.js')
    const res = await paddleWebhookRouter.request('/paddle', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Paddle-Signature': header },
      body: tampered,
    })
    expect(res.status).toBe(401)
    expect(captured).toHaveLength(0)
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
      headers: {
        'content-type': 'application/json',
        'Paddle-Signature': await signedHeader(garbage),
      },
      body: garbage,
    })
    expect(res.status).toBe(400)
  })

  it('acknowledges unknown event types without processing (forward-compat)', async () => {
    const { res, body } = await postWebhook(event('customer.created', { id: CUSTOMER_ID }))
    expect(res.status).toBe(200)
    expect(body['skipped']).toBe('customer.created')
    expect(captured).toHaveLength(0)
  })
})
