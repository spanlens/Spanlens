import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FakeSupabase, type Row } from './helpers/fake-supabase.js'
import type { ChargeResult } from '../lib/paddle-charge.js'

/**
 * Overage billing ledger — provisional charge, post-period true-up, retries.
 *
 * `computeAndReportOverages` (lib/paddle-usage.ts) coordinates the ledger in
 * `subscription_overage_charges` with Paddle's one-time charge endpoint
 * (CLAUDE.md gotcha #7a):
 *
 *   1. INSERT a `pending` row keyed on UNIQUE (subscription_id, period_end,
 *      kind). The database constraint, not application logic, is what stops
 *      a second run from charging the same period twice.
 *   2. Call POST /subscriptions/{id}/charge.
 *   3. UPDATE the row to `charged` / `error` / `needs_reconciliation`, and
 *      check that the UPDATE worked.
 *
 * Quality audit 2026-09-28 (C4.3) found the in-window charge (48h before
 * period_end, daily cron) never billed the last 24-48 hours of a period, and
 * nothing did afterwards: 3-7% of each period's overage went unbilled. The
 * settlement pass now recounts closed periods and charges only the
 * difference. Ambiguous outcomes are parked, never auto-retried.
 *
 * Paddle is mocked at `chargeSubscription`; no real charge is ever issued.
 */

const SUB_ROW_ID = 'sub-uuid-1'
const PADDLE_SUB_ID = 'sub_01kpqrapmp3xmxpwjea7n30pwf'
const ORG_ID = '015a5187-d896-40b4-bef8-7d2b2d18c81d'
const PRICE_STARTER_OVERAGE = 'pri_starter_overage_test'
const PRICE_TEAM_OVERAGE = 'pri_team_overage_test'
const HOUR_MS = 3600_000
const DAY_MS = 24 * HOUR_MS

let fake: FakeSupabase

vi.mock('../lib/db.js', () => ({
  supabaseAdmin: { from: (t: string) => fake.from(t) },
  supabaseClient: { from: (t: string) => fake.from(t) },
}))

// countMonthlyRequests — either a FIFO queue (one value per call) or a
// function of the requested window for time-based scenarios.
const requestCountQueue: Array<number | Error> = []
let countImpl: ((since: Date, until: Date) => number) | null = null
const countCalls: Array<{ since: string; until: string }> = []
vi.mock('../lib/quota.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/quota.js')>('../lib/quota.js')
  return {
    ...actual,
    countMonthlyRequests: async (_org: string, since: Date, until: Date) => {
      countCalls.push({ since: since.toISOString(), until: until.toISOString() })
      if (countImpl) return countImpl(since, until)
      const v = requestCountQueue.shift() ?? 0
      if (v instanceof Error) throw v
      return v
    },
  }
})

const chargeResultQueue: ChargeResult[] = []
const chargeSpy = vi.fn()
/** Ledger rows as they were at the moment Paddle was called. */
const ledgerAtChargeTime: Row[][] = []
vi.mock('../lib/paddle-charge.js', () => ({
  chargeSubscription: async (
    subId: string,
    items: Array<{ priceId: string; quantity: number }>,
    effectiveFrom: 'immediately' | 'next_billing_period',
  ) => {
    chargeSpy(subId, items, effectiveFrom)
    ledgerAtChargeTime.push(fake.rows('subscription_overage_charges').map((r) => ({ ...r })))
    return chargeResultQueue.shift() ?? { ok: false, status: 400, error: 'chargeResultQueue exhausted' }
  },
}))

function activeSub(overrides: Row = {}): Row {
  return {
    id: SUB_ROW_ID,
    organization_id: ORG_ID,
    paddle_subscription_id: PADDLE_SUB_ID,
    plan: 'starter',
    status: 'active',
    current_period_start: '2026-05-01T00:00:00.000Z',
    current_period_end: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function ledger(): Row[] {
  return fake.rows('subscription_overage_charges')
}

function setup(subs: Row[]): void {
  fake = new FakeSupabase()
    .configure('subscription_overage_charges', {
      defaults: () => ({ kind: 'provisional', charged_quantity: 0, status: 'pending', included_requests: null }),
      unique: [{ columns: ['subscription_id', 'period_end', 'kind'] }],
      relations: { subscriptions: { localKey: 'subscription_id', foreignTable: 'subscriptions', foreignKey: 'id' } },
    })
    .seed('subscriptions', subs)
}

// Inside the 48h window before period_end (2026-06-01)
const NOW_IN_WINDOW = new Date('2026-05-30T12:00:00.000Z')
const NOW_OUT_OF_WINDOW = new Date('2026-05-10T00:00:00.000Z')
// After period_end but before the settlement delay has passed
const NOW_JUST_AFTER_END = new Date('2026-06-01T01:00:00.000Z')
// After period_end + settlement delay
const NOW_SETTLE = new Date('2026-06-01T06:00:00.000Z')

beforeEach(() => {
  process.env['PADDLE_PRICE_STARTER_OVERAGE'] = PRICE_STARTER_OVERAGE
  process.env['PADDLE_PRICE_TEAM_OVERAGE'] = PRICE_TEAM_OVERAGE
  process.env['PADDLE_API_KEY'] = 'pdl_test_key'
  requestCountQueue.length = 0
  countImpl = null
  countCalls.length = 0
  chargeResultQueue.length = 0
  ledgerAtChargeTime.length = 0
  chargeSpy.mockClear()
  setup([])
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  delete process.env['PADDLE_PRICE_STARTER_OVERAGE']
  delete process.env['PADDLE_PRICE_TEAM_OVERAGE']
  delete process.env['PADDLE_API_KEY']
  vi.restoreAllMocks()
})

async function run(now: Date = NOW_IN_WINDOW) {
  const { computeAndReportOverages } = await import('../lib/paddle-usage.js')
  return computeAndReportOverages(now)
}

function provisional(reports: Awaited<ReturnType<typeof run>>) {
  return reports.filter((r) => r.phase === 'provisional')
}

// =========================================================================
// Provisional (in-window) charge
// =========================================================================

describe('provisional charge — pending → charged', () => {
  it('inserts a pending provisional row, calls Paddle, then records charged + charged_quantity', async () => {
    setup([activeSub()])
    requestCountQueue.push(125_000) // 25,000 over Starter's 100k → 25 units
    chargeResultQueue.push({ ok: true, response: { data: { id: 'txn_charged_ok' } } })

    const [report] = provisional(await run())
    expect(report).toMatchObject({ status: 'charged', overage_requests: 25_000, overage_quantity: 25, included: 100_000 })

    expect(ledger()).toHaveLength(1)
    expect(ledger()[0]).toMatchObject({
      subscription_id: SUB_ROW_ID,
      kind: 'provisional',
      period_start: '2026-05-01T00:00:00.000Z',
      period_end: '2026-06-01T00:00:00.000Z',
      included_requests: 100_000,
      overage_requests: 25_000,
      overage_quantity: 25,
      price_id: PRICE_STARTER_OVERAGE,
      status: 'charged',
      charged_quantity: 25,
      paddle_response: { data: { id: 'txn_charged_ok' } },
      completed_at: expect.any(String),
    })
  })

  it('Paddle is called with effective_from=immediately', async () => {
    setup([activeSub()])
    requestCountQueue.push(105_000)
    chargeResultQueue.push({ ok: true, response: {} })
    await run()
    expect(chargeSpy).toHaveBeenCalledWith(PADDLE_SUB_ID, [{ priceId: PRICE_STARTER_OVERAGE, quantity: 5 }], 'immediately')
  })

  it('control-flow ORDER: the pending row exists before Paddle is called', async () => {
    setup([activeSub()])
    requestCountQueue.push(110_000)
    chargeResultQueue.push({ ok: true, response: {} })
    await run()
    expect(ledgerAtChargeTime[0]).toEqual([expect.objectContaining({ status: 'pending', kind: 'provisional' })])
  })

  it('Team plan with 1.5M requests → 500K overage → 500 quantity', async () => {
    setup([activeSub({ plan: 'team' })])
    requestCountQueue.push(1_500_000)
    chargeResultQueue.push({ ok: true, response: {} })
    const [report] = provisional(await run())
    expect(report).toMatchObject({ status: 'charged', overage_requests: 500_000, overage_quantity: 500 })
    expect(chargeSpy.mock.calls[0]![1]).toEqual([{ priceId: PRICE_TEAM_OVERAGE, quantity: 500 }])
  })
})

describe('provisional charge — failures', () => {
  it('definite Paddle rejection (4xx) → error row with the response kept for audit', async () => {
    setup([activeSub()])
    requestCountQueue.push(105_000)
    chargeResultQueue.push({
      ok: false,
      status: 400,
      error: 'subscription_update_not_allowed_for_status — Subscription is canceled',
      response: { error: { code: 'subscription_update_not_allowed_for_status' } },
    })
    const [report] = provisional(await run())
    expect(report!.status).toBe('error')
    expect(ledger()[0]).toMatchObject({
      status: 'error',
      charged_quantity: 0,
      error_message: expect.stringContaining('subscription_update_not_allowed_for_status'),
      paddle_response: { error: { code: 'subscription_update_not_allowed_for_status' } },
    })
  })

  it('network error (unknown outcome) → needs_reconciliation, not error', async () => {
    setup([activeSub()])
    requestCountQueue.push(105_000)
    chargeResultQueue.push({ ok: false, status: 0, error: 'ECONNRESET' })
    const [report] = provisional(await run())
    expect(report).toMatchObject({ status: 'needs_reconciliation', error: 'ECONNRESET' })
    expect(ledger()[0]).toMatchObject({ status: 'needs_reconciliation', error_message: 'ECONNRESET' })
  })

  it('Paddle 5xx → needs_reconciliation (the charge may have gone through)', async () => {
    setup([activeSub()])
    requestCountQueue.push(105_000)
    chargeResultQueue.push({ ok: false, status: 502, error: 'HTTP 502' })
    const [report] = provisional(await run())
    expect(report!.status).toBe('needs_reconciliation')
  })

  it('ledger update failing after a successful charge → needs_reconciliation, row left pending (was reported "charged")', async () => {
    setup([activeSub()])
    requestCountQueue.push(105_000)
    chargeResultQueue.push({ ok: true, response: { data: { id: 'txn_ok' } } })
    fake.failNext('subscription_overage_charges', 'update', { message: 'connection reset' })
    const [report] = provisional(await run())
    expect(report!.status).toBe('needs_reconciliation')
    expect(report!.error).toContain('ledger update failed: connection reset')
    expect(ledger()[0]!['status']).toBe('pending')
  })

  it('PADDLE_API_KEY missing → error row, Paddle never called', async () => {
    delete process.env['PADDLE_API_KEY']
    setup([activeSub()])
    requestCountQueue.push(105_000)
    const [report] = provisional(await run())
    expect(report!.status).toBe('error')
    expect(chargeSpy).not.toHaveBeenCalled()
    expect(ledger()[0]).toMatchObject({ status: 'error', error_message: 'PADDLE_API_KEY is not configured' })
  })
})

describe('provisional charge — idempotency guard', () => {
  it('a second in-window run → skipped_already_charged, no Paddle call', async () => {
    setup([activeSub()])
    requestCountQueue.push(105_000, 110_000)
    chargeResultQueue.push({ ok: true, response: {} })
    await run()
    const [second] = provisional(await run(new Date('2026-05-31T12:00:00.000Z')))
    expect(second!.status).toBe('skipped_already_charged')
    expect(chargeSpy).toHaveBeenCalledTimes(1)
  })

  it('non-unique insert failure → error, Paddle not called (fail closed)', async () => {
    setup([activeSub()])
    requestCountQueue.push(105_000)
    fake.failNext('subscription_overage_charges', 'insert', { message: 'serialization failure', code: '40001' })
    const [report] = provisional(await run())
    expect(report!.status).toBe('error')
    expect(report!.error).toContain('serialization failure')
    expect(chargeSpy).not.toHaveBeenCalled()
  })
})

describe('provisional charge — skip paths', () => {
  it('outside the window → skipped_not_in_window, nothing written', async () => {
    setup([activeSub()])
    requestCountQueue.push(200_000)
    const [report] = provisional(await run(NOW_OUT_OF_WINDOW))
    expect(report!.status).toBe('skipped_not_in_window')
    expect(ledger()).toHaveLength(0)
    expect(chargeSpy).not.toHaveBeenCalled()
  })

  it('missing period boundaries → skipped_not_in_window', async () => {
    setup([activeSub({ current_period_end: null })])
    const [report] = provisional(await run())
    expect(report!.status).toBe('skipped_not_in_window')
    expect(ledger()).toHaveLength(0)
  })

  it('usage within quota → skipped_no_overage, and a no_charge row records the period for settlement', async () => {
    setup([activeSub()])
    requestCountQueue.push(99_999)
    const [report] = provisional(await run())
    expect(report!.status).toBe('skipped_no_overage')
    expect(chargeSpy).not.toHaveBeenCalled()
    expect(ledger()).toEqual([
      expect.objectContaining({ kind: 'provisional', status: 'no_charge', overage_quantity: 0, charged_quantity: 0, included_requests: 100_000 }),
    ])
  })

  it('overage price not configured → skipped_no_price, nothing written', async () => {
    delete process.env['PADDLE_PRICE_STARTER_OVERAGE']
    setup([activeSub()])
    requestCountQueue.push(150_000)
    const [report] = provisional(await run())
    expect(report).toMatchObject({ status: 'skipped_no_price', overage_requests: 50_000 })
    expect(ledger()).toHaveLength(0)
  })

  it('count failure → error, nothing written', async () => {
    setup([activeSub()])
    requestCountQueue.push(new Error('query failed: ECONNREFUSED'))
    const [report] = provisional(await run())
    expect(report!.status).toBe('error')
    expect(report!.error).toContain('ECONNREFUSED')
    expect(ledger()).toHaveLength(0)
  })

  it('processes each subscription independently', async () => {
    setup([
      activeSub({ id: 'sub-charged', paddle_subscription_id: 'sub_paddle_a' }),
      activeSub({ id: 'sub-no-overage', paddle_subscription_id: 'sub_paddle_b' }),
      activeSub({ id: 'sub-error', paddle_subscription_id: 'sub_paddle_c' }),
    ])
    requestCountQueue.push(150_000, 50_000, 200_000)
    chargeResultQueue.push({ ok: true, response: {} }, { ok: false, status: 400, error: 'card_declined' })
    const reports = provisional(await run())
    expect(reports.map((r) => r.status)).toEqual(['charged', 'skipped_no_overage', 'error'])
    expect(chargeSpy).toHaveBeenCalledTimes(2)
  })
})

// =========================================================================
// Settlement (true-up) after the period closes
// =========================================================================

function provisionalRow(overrides: Row = {}): Row {
  return {
    subscription_id: SUB_ROW_ID,
    kind: 'provisional',
    period_start: '2026-05-01T00:00:00.000Z',
    period_end: '2026-06-01T00:00:00.000Z',
    included_requests: 100_000,
    overage_requests: 25_000,
    overage_quantity: 25,
    charged_quantity: 25,
    price_id: PRICE_STARTER_OVERAGE,
    status: 'charged',
    ...overrides,
  }
}

function rolledOverSub(): Row {
  // After period_end the webhook has moved the subscription to its next period.
  return activeSub({ current_period_start: '2026-06-01T00:00:00.000Z', current_period_end: '2026-07-01T00:00:00.000Z' })
}

describe('settlement — charge only what the in-window run could not see', () => {
  it('recounts the closed period and charges the difference as a true_up row', async () => {
    setup([rolledOverSub()])
    fake.seed('subscription_overage_charges', [provisionalRow()])
    requestCountQueue.push(140_000) // final: 40,000 over → 40 units, 25 already charged
    chargeResultQueue.push({ ok: true, response: { data: { id: 'txn_true_up' } } })

    const reports = await run(NOW_SETTLE)
    const settlement = reports.filter((r) => r.phase === 'settlement')
    expect(settlement).toEqual([expect.objectContaining({ status: 'charged', used: 140_000, overage_quantity: 15 })])
    expect(countCalls).toContainEqual({ since: '2026-05-01T00:00:00.000Z', until: '2026-06-01T00:00:00.000Z' })
    expect(chargeSpy).toHaveBeenCalledWith(PADDLE_SUB_ID, [{ priceId: PRICE_STARTER_OVERAGE, quantity: 15 }], 'immediately')
    const trueUp = ledger().find((r) => r['kind'] === 'true_up')
    expect(trueUp).toMatchObject({ status: 'charged', overage_quantity: 15, charged_quantity: 15 })
  })

  it('a period that had no overage in the window but went over in its last hours is charged in full', async () => {
    setup([rolledOverSub()])
    fake.seed('subscription_overage_charges', [provisionalRow({ status: 'no_charge', overage_requests: 0, overage_quantity: 0, charged_quantity: 0 })])
    requestCountQueue.push(103_500)
    chargeResultQueue.push({ ok: true, response: {} })
    await run(NOW_SETTLE)
    expect(chargeSpy).toHaveBeenCalledWith(PADDLE_SUB_ID, [{ priceId: PRICE_STARTER_OVERAGE, quantity: 4 }], 'immediately')
  })

  it('nothing more owed → no_charge true_up row, no Paddle call; a second run does nothing', async () => {
    setup([rolledOverSub()])
    fake.seed('subscription_overage_charges', [provisionalRow()])
    requestCountQueue.push(125_000)
    const first = (await run(NOW_SETTLE)).filter((r) => r.phase === 'settlement')
    expect(first).toEqual([expect.objectContaining({ status: 'no_charge' })])
    expect(ledger().find((r) => r['kind'] === 'true_up')).toMatchObject({ status: 'no_charge', charged_quantity: 0 })

    const second = (await run(new Date(NOW_SETTLE.getTime() + DAY_MS))).filter((r) => r.phase === 'settlement')
    expect(second).toEqual([])
    expect(chargeSpy).not.toHaveBeenCalled()
  })

  it('never trues up a period whose provisional charge is unresolved', async () => {
    for (const status of ['pending', 'needs_reconciliation', 'error', 'retry']) {
      setup([rolledOverSub()])
      fake.seed('subscription_overage_charges', [provisionalRow({ status, charged_quantity: 0 })])
      const settlement = (await run(NOW_SETTLE)).filter((r) => r.phase === 'settlement')
      if (status !== 'retry') {
        expect(settlement).toEqual([expect.objectContaining({ status: 'skipped_unsettled' })])
      }
      expect(ledger().some((r) => r['kind'] === 'true_up')).toBe(false)
    }
  })

  it('a row marked charged by hand without charged_quantity is not trusted (would bill it again)', async () => {
    // Review of the C4.3 fix: the true-up bills final - sum(charged_quantity).
    // An operator who resolves a needs_reconciliation row by flipping only the
    // status (what the original migration comment described) leaves
    // charged_quantity at 0, and the settlement would charge the whole period
    // again, including the 25 units Paddle already collected.
    setup([rolledOverSub()])
    fake.seed('subscription_overage_charges', [provisionalRow({ status: 'charged', overage_quantity: 25, charged_quantity: 0 })])
    requestCountQueue.push(140_000)
    chargeResultQueue.push({ ok: true, response: {} })
    const settlement = (await run(NOW_SETTLE)).filter((r) => r.phase === 'settlement')
    expect(settlement).toEqual([
      expect.objectContaining({ status: 'skipped_unsettled', error: expect.stringContaining('charged_quantity') }),
    ])
    expect(chargeSpy).not.toHaveBeenCalled()
    expect(ledger().some((r) => r['kind'] === 'true_up')).toBe(false)
  })

  it('a charged row that owed nothing (quantity 0) still settles normally', async () => {
    setup([rolledOverSub()])
    fake.seed('subscription_overage_charges', [provisionalRow({ status: 'charged', overage_requests: 0, overage_quantity: 0, charged_quantity: 0 })])
    requestCountQueue.push(103_500)
    chargeResultQueue.push({ ok: true, response: {} })
    await run(NOW_SETTLE)
    expect(chargeSpy).toHaveBeenCalledWith(PADDLE_SUB_ID, [{ priceId: PRICE_STARTER_OVERAGE, quantity: 4 }], 'immediately')
  })

  it('waits for the settlement delay after period_end (late log rows still land)', async () => {
    setup([rolledOverSub()])
    fake.seed('subscription_overage_charges', [provisionalRow()])
    const reports = await run(NOW_JUST_AFTER_END)
    expect(reports.filter((r) => r.phase === 'settlement')).toEqual([])
  })

  it('does not reach back beyond the lookback window', async () => {
    setup([rolledOverSub()])
    fake.seed('subscription_overage_charges', [provisionalRow()])
    const reports = await run(new Date('2026-06-20T00:00:00.000Z'))
    expect(reports.filter((r) => r.phase === 'settlement')).toEqual([])
  })

  it('a legacy provisional row without included_requests uses the plan quota', async () => {
    setup([rolledOverSub()])
    fake.seed('subscription_overage_charges', [provisionalRow({ included_requests: null })])
    requestCountQueue.push(130_000)
    chargeResultQueue.push({ ok: true, response: {} })
    await run(NOW_SETTLE)
    expect(chargeSpy).toHaveBeenCalledWith(PADDLE_SUB_ID, [{ priceId: PRICE_STARTER_OVERAGE, quantity: 5 }], 'immediately')
  })

  it('a settlement read error fails the run instead of passing silently', async () => {
    setup([rolledOverSub()])
    // Both ledger reads (retry pass, then settlement pass) fail.
    fake.failNext('subscription_overage_charges', 'select', { message: 'timeout' }, 2)
    await expect(run(NOW_SETTLE)).rejects.toThrow(/settlement.*timeout/)
  })
})

describe('settlement — the audit scenario, end to end', () => {
  it('10k requests/day on Starter, daily 03:30 runs: the whole 200k overage is billed (was 187 of 200 units)', async () => {
    const periodStart = Date.parse('2026-09-01T12:00:00.000Z')
    const periodEnd = Date.parse('2026-10-01T12:00:00.000Z')
    setup([activeSub({
      current_period_start: new Date(periodStart).toISOString(),
      current_period_end: new Date(periodEnd).toISOString(),
    })])
    let clock = 0
    countImpl = (since, until) =>
      Math.floor(((Math.min(until.getTime(), clock) - since.getTime()) / DAY_MS) * 10_000)
    chargeResultQueue.push({ ok: true, response: {} }, { ok: true, response: {} })

    for (const day of ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']) {
      clock = Date.parse(`${day}T03:30:00.000Z`)
      if (day === '2026-10-02') {
        // The renewal webhook rolled the subscription over.
        const sub = fake.rows('subscriptions')[0]!
        sub['current_period_start'] = new Date(periodEnd).toISOString()
        sub['current_period_end'] = '2026-11-01T12:00:00.000Z'
      }
      await run(new Date(clock))
    }

    const charged = chargeSpy.mock.calls.map((c) => (c[1] as Array<{ quantity: number }>)[0]!.quantity)
    expect(charged).toEqual([187, 13])
    expect(charged.reduce((a, b) => a + b, 0)).toBe(200)
    const total = ledger().reduce((sum, r) => sum + Number(r['charged_quantity']), 0)
    expect(total).toBe(200)
  })
})

// =========================================================================
// Operator-flagged retries
// =========================================================================

describe('retry — an operator flips a row to retry', () => {
  it('re-attempts the remaining quantity and records the charge', async () => {
    setup([rolledOverSub()])
    fake.seed('subscription_overage_charges', [provisionalRow({ status: 'retry', overage_quantity: 25, charged_quantity: 0 })])
    chargeResultQueue.push({ ok: true, response: {} })
    const reports = await run(new Date('2026-06-01T00:30:00.000Z'))
    expect(reports.filter((r) => r.phase === 'retry')).toEqual([expect.objectContaining({ status: 'charged', overage_quantity: 25 })])
    expect(ledger()[0]).toMatchObject({ status: 'charged', charged_quantity: 25 })
  })

  it('nothing left to charge → marked charged without calling Paddle', async () => {
    setup([rolledOverSub()])
    fake.seed('subscription_overage_charges', [provisionalRow({ status: 'retry', overage_quantity: 25, charged_quantity: 25 })])
    await run(new Date('2026-06-01T00:30:00.000Z'))
    expect(chargeSpy).not.toHaveBeenCalled()
    expect(ledger()[0]!['status']).toBe('charged')
  })

  it('two runs racing on the same retry row charge once', async () => {
    setup([rolledOverSub()])
    fake.seed('subscription_overage_charges', [provisionalRow({ status: 'retry', overage_quantity: 25, charged_quantity: 0 })])
    chargeResultQueue.push({ ok: true, response: {} }, { ok: true, response: {} })
    const when = new Date('2026-06-01T00:30:00.000Z')
    await Promise.all([run(when), run(when)])
    expect(chargeSpy).toHaveBeenCalledTimes(1)
  })
})
