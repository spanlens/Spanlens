import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Overage billing 3-state flow — pending → charged | error.
 *
 * `computeAndReportOverages` (lib/paddle-usage.ts) coordinates the
 * idempotency guard with the Paddle one-time charge call. The contract,
 * documented in CLAUDE.md gotcha #7a and the migration file, is:
 *
 *   1. INSERT a `pending` row into subscription_overage_charges keyed on
 *      UNIQUE (subscription_id, period_end). This row blocks any
 *      subsequent re-run from charging the same period twice — the
 *      database-level UNIQUE is the safety net, not application logic.
 *   2. Call POST /subscriptions/{id}/charge (via chargeSubscription).
 *   3. On success → UPDATE row to `charged` + persist paddle_response.
 *      On failure → UPDATE row to `error` + persist error_message.
 *
 * The reason this matters: a crash between step 1 and step 2 leaves a
 * stuck `pending` row. The DESIGN choice is "safer to under-bill than
 * to double-bill" — an operator must manually flip the row to `retry`
 * to attempt again. These tests pin that contract so a future refactor
 * can't accidentally swap the order (insert AFTER paddle call → window
 * for double-billing if the second call's response is lost mid-flight)
 * or skip the row when Paddle errors (would re-fire on next cron tick
 * → operator floods).
 *
 * Existing paddle-usage.test.ts covers the building blocks
 * (isWithinChargingWindow, chargeSubscription); this file covers the
 * integrated flow + DB writes + idempotency guard.
 */

// ---- Mocks --------------------------------------------------------------

const SUB_ROW_ID = 'sub-uuid-1'
const PADDLE_SUB_ID = 'sub_01kpqrapmp3xmxpwjea7n30pwf'
const PADDLE_SUB_ID_TEAM = 'sub_01kteam0subscription00000000'
const ORG_ID = '015a5187-d896-40b4-bef8-7d2b2d18c81d'
const PRICE_STARTER_OVERAGE = 'pri_starter_overage_test'
const PRICE_TEAM_OVERAGE = 'pri_team_overage_test'

// Captured DB writes — what would have happened against real Supabase
interface InsertCall {
  table: string
  values: Record<string, unknown>
}
interface UpdateCall {
  table: string
  values: Record<string, unknown>
  match: Record<string, unknown>
}
const inserts: InsertCall[] = []
const updates: UpdateCall[] = []
// Inserts AND updates in arrival order, so we can prove "pending row
// inserted BEFORE paddle call, charged/error update AFTER" is the
// actual control-flow order, not just incidental coincidence.
// `exactOptionalPropertyTypes: true` in tsconfig — must spell undefined out
const writeOrder: Array<{ op: 'insert' | 'update'; table: string; status?: string | undefined }> = []

let nextSubscriptionsResult: {
  data: Array<{
    id: string
    organization_id: string
    paddle_subscription_id: string
    plan: 'starter' | 'team'
    status: string
    current_period_start: string | null
    current_period_end: string | null
  }> | null
  error: { message: string } | null
} = { data: [], error: null }

let nextInsertError: { code?: string; message: string } | null = null
const insertedRowIds = new Map<string, string>() // table → returned id

vi.mock('../lib/db.js', () => {
  const builder = (table: string) => {
    let returnsType: 'array' | 'object' = 'array'
    const ctx: { values?: Record<string, unknown>; match: Record<string, unknown> } = { match: {} }
    const chain = {
      select: (_cols?: string) => chain,
      in: () => chain,
      eq: (col: string, val: unknown) => {
        ctx.match[col] = val
        return chain
      },
      returns: <T>() => chain as unknown as Promise<{ data: T; error: unknown }>,
      single: async () => {
        if (table === 'subscription_overage_charges' && ctx.values) {
          const id = insertedRowIds.get(table) ?? 'overage-row-' + (inserts.length)
          return { data: { id }, error: null }
        }
        return { data: null, error: null }
      },
      insert: (values: Record<string, unknown>) => {
        ctx.values = values
        if (nextInsertError) {
          const err = nextInsertError
          nextInsertError = null
          // Mimic supabase-js: insert(...).select(...).single() resolves
          // to { data: null, error }
          return {
            select: () => ({
              single: async () => ({ data: null, error: err }),
            }),
          }
        }
        inserts.push({ table, values: { ...values } })
        writeOrder.push({ op: 'insert', table, status: values['status'] as string | undefined })
        return {
          select: () => ({
            single: async () => {
              const id = insertedRowIds.get(table) ?? 'overage-row-' + (inserts.length - 1)
              return { data: { id }, error: null }
            },
          }),
        }
      },
      update: (values: Record<string, unknown>) => {
        return {
          eq: async (col: string, val: unknown) => {
            updates.push({ table, values: { ...values }, match: { [col]: val } })
            writeOrder.push({ op: 'update', table, status: values['status'] as string | undefined })
            return { error: null }
          },
        }
      },
      then: undefined as undefined, // satisfy thenable-shape detection
    }
    // Make `await supabaseAdmin.from('subscriptions').select(...).in(...).returns<T[]>()`
    // resolve directly with `{ data, error }` for the subscriptions list query.
    if (table === 'subscriptions') {
      ;(chain as unknown as { returns: <T>() => Promise<{ data: T; error: unknown }> }).returns =
        async <T>(): Promise<{ data: T; error: unknown }> =>
          ({
            data: nextSubscriptionsResult.data as unknown as T,
            error: nextSubscriptionsResult.error,
          })
    }
    void returnsType
    return chain
  }
  return {
    supabaseAdmin: { from: (t: string) => builder(t) },
    supabaseClient: { from: (t: string) => builder(t) },
  }
})

// countMonthlyRequests mock — `requestCountQueue` is consumed FIFO per call.
// Tests with a single subscription push 1 item; multi-sub tests push N.
const requestCountQueue: Array<number | Error> = []
function enqueueRequestCount(v: number | Error) {
  requestCountQueue.push(v)
}
vi.mock('../lib/quota.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/quota.js')>('../lib/quota.js')
  return {
    ...actual,
    countMonthlyRequests: async () => {
      const v = requestCountQueue.shift() ?? 0
      if (v instanceof Error) throw v
      return v
    },
  }
})

// chargeSubscription mock — same FIFO queue pattern.
const chargeResultQueue: Array<import('../lib/paddle-charge.js').ChargeResult> = []
function enqueueChargeResult(r: import('../lib/paddle-charge.js').ChargeResult) {
  chargeResultQueue.push(r)
}
const chargeSpy = vi.fn()
vi.mock('../lib/paddle-charge.js', () => {
  return {
    chargeSubscription: async (
      subId: string,
      items: Array<{ priceId: string; quantity: number }>,
      effectiveFrom: 'immediately' | 'next_billing_period',
    ) => {
      chargeSpy(subId, items, effectiveFrom)
      return (
        chargeResultQueue.shift() ?? {
          ok: false,
          status: 0,
          error: 'chargeResultQueue exhausted — test forgot to enqueue',
        }
      )
    },
  }
})

// ---- Helpers ------------------------------------------------------------

function activeStarterSub(overrides: Partial<{
  id: string
  paddle_subscription_id: string
  organization_id: string
  current_period_start: string | null
  current_period_end: string | null
  status: string
  plan: 'starter' | 'team'
}> = {}): {
  id: string
  organization_id: string
  paddle_subscription_id: string
  plan: 'starter' | 'team'
  status: string
  current_period_start: string | null
  current_period_end: string | null
} {
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

// Time inside the 48h charging window before period_end (2026-06-01)
const NOW_IN_WINDOW = new Date('2026-05-30T12:00:00.000Z')
// Time outside the window (>48h before)
const NOW_OUT_OF_WINDOW = new Date('2026-05-10T00:00:00.000Z')
// Time after period_end
const NOW_AFTER_END = new Date('2026-06-02T00:00:00.000Z')

beforeEach(() => {
  process.env['PADDLE_PRICE_STARTER_OVERAGE'] = PRICE_STARTER_OVERAGE
  process.env['PADDLE_PRICE_TEAM_OVERAGE'] = PRICE_TEAM_OVERAGE
  inserts.length = 0
  updates.length = 0
  writeOrder.length = 0
  insertedRowIds.clear()
  nextSubscriptionsResult = { data: [], error: null }
  nextInsertError = null
  requestCountQueue.length = 0
  chargeResultQueue.length = 0
  chargeSpy.mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  delete process.env['PADDLE_PRICE_STARTER_OVERAGE']
  delete process.env['PADDLE_PRICE_TEAM_OVERAGE']
  vi.restoreAllMocks()
})

async function run(now: Date = NOW_IN_WINDOW) {
  // Re-import so the mocks are picked up cleanly
  const { computeAndReportOverages } = await import('../lib/paddle-usage.js')
  return computeAndReportOverages(now)
}

// =========================================================================
// pending → charged (happy path)
// =========================================================================

describe('overage 3-state flow — pending → charged', () => {
  it('inserts pending, calls Paddle, then updates to charged + persists response', async () => {
    nextSubscriptionsResult = { data: [activeStarterSub()], error: null }
    enqueueRequestCount(125_000) // 25,000 over Starter's 100k → ceil(25/1) = 25 units
    enqueueChargeResult({
      ok: true,
      response: { data: { id: 'txn_charged_ok', status: 'completed' } },
    })

    const [report] = await run()

    expect(report!.status).toBe('charged')
    expect(report!.overage_requests).toBe(25_000)
    expect(report!.overage_quantity).toBe(25) // ceil(25000 / 1000)

    // Pending insert happened, with the exact identity needed for the
    // UNIQUE (subscription_id, period_end) idempotency guard.
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toEqual({
      table: 'subscription_overage_charges',
      values: {
        subscription_id: SUB_ROW_ID,
        period_start: '2026-05-01T00:00:00.000Z',
        period_end: '2026-06-01T00:00:00.000Z',
        overage_requests: 25_000,
        overage_quantity: 25,
        price_id: PRICE_STARTER_OVERAGE,
        status: 'pending',
      },
    })

    // Charged update wrote response + completed_at, NOT error_message
    expect(updates).toHaveLength(1)
    expect(updates[0]!.values['status']).toBe('charged')
    expect(updates[0]!.values['paddle_response']).toEqual({
      data: { id: 'txn_charged_ok', status: 'completed' },
    })
    expect(updates[0]!.values['completed_at']).toBeTruthy()
    expect(updates[0]!.values['error_message']).toBeUndefined()
  })

  it('Paddle is called with effective_from=immediately (no cancellation race window)', async () => {
    nextSubscriptionsResult = { data: [activeStarterSub()], error: null }
    enqueueRequestCount(105_000)
    enqueueChargeResult({ ok: true, response: {} })

    await run()

    expect(chargeSpy).toHaveBeenCalledTimes(1)
    const [subId, items, effectiveFrom] = chargeSpy.mock.calls[0]!
    expect(subId).toBe(PADDLE_SUB_ID)
    expect(items).toEqual([{ priceId: PRICE_STARTER_OVERAGE, quantity: 5 }])
    expect(effectiveFrom).toBe('immediately')
  })

  it('control-flow ORDER: pending insert is committed before chargeSubscription is called', async () => {
    // The safety property — flipping this order would create a window for
    // double-billing if Paddle responds but the row update gets lost.
    nextSubscriptionsResult = { data: [activeStarterSub()], error: null }
    enqueueRequestCount(110_000)
    enqueueChargeResult({ ok: true, response: {} })

    await run()

    expect(writeOrder).toHaveLength(2)
    expect(writeOrder[0]).toEqual({
      op: 'insert',
      table: 'subscription_overage_charges',
      status: 'pending',
    })
    expect(writeOrder[1]).toEqual({
      op: 'update',
      table: 'subscription_overage_charges',
      status: 'charged',
    })
    expect(chargeSpy).toHaveBeenCalledTimes(1)
  })

  it('Team plan with 1.5M requests → 500K overage → 500 quantity', async () => {
    nextSubscriptionsResult = {
      data: [
        activeStarterSub({
          plan: 'team',
          paddle_subscription_id: PADDLE_SUB_ID_TEAM,
        }),
      ],
      error: null,
    }
    enqueueRequestCount(1_500_000)
    enqueueChargeResult({ ok: true, response: {} })

    const [report] = await run()

    expect(report!.status).toBe('charged')
    expect(report!.overage_requests).toBe(500_000)
    expect(report!.overage_quantity).toBe(500)
    expect(chargeSpy.mock.calls[0]![1]).toEqual([
      { priceId: PRICE_TEAM_OVERAGE, quantity: 500 },
    ])
  })
})

// =========================================================================
// pending → error
// =========================================================================

describe('overage 3-state flow — pending → error', () => {
  it('Paddle charge fails → pending row updated to error + paddle_response retained for audit', async () => {
    nextSubscriptionsResult = { data: [activeStarterSub()], error: null }
    enqueueRequestCount(105_000)
    enqueueChargeResult({
      ok: false,
      status: 400,
      error: 'subscription_update_not_allowed_for_status — Subscription is canceled',
      response: { error: { code: 'subscription_update_not_allowed_for_status' } },
    })

    const [report] = await run()

    expect(report!.status).toBe('error')
    expect(report!.error).toContain('subscription_update_not_allowed_for_status')

    // The pending row was still inserted (idempotency guard) — error
    // status here means the row exists, no retry until operator intervenes.
    expect(inserts).toHaveLength(1)
    expect(inserts[0]!.values['status']).toBe('pending')

    // Error update carries error_message + paddle_response (so ops can debug)
    expect(updates).toHaveLength(1)
    expect(updates[0]!.values['status']).toBe('error')
    expect(updates[0]!.values['error_message']).toContain('subscription_update_not_allowed_for_status')
    expect(updates[0]!.values['paddle_response']).toEqual({
      error: { code: 'subscription_update_not_allowed_for_status' },
    })
    expect(updates[0]!.values['completed_at']).toBeTruthy()
  })

  it('Paddle network error → error status, error_message has the underlying detail', async () => {
    nextSubscriptionsResult = { data: [activeStarterSub()], error: null }
    enqueueRequestCount(105_000)
    enqueueChargeResult({ ok: false, status: 0, error: 'ECONNRESET' })

    const [report] = await run()

    expect(report!.status).toBe('error')
    expect(report!.error).toBe('ECONNRESET')
    expect(updates[0]!.values['status']).toBe('error')
    expect(updates[0]!.values['error_message']).toBe('ECONNRESET')
  })
})

// =========================================================================
// Idempotency guard — UNIQUE (subscription_id, period_end)
// =========================================================================

describe('overage 3-state flow — idempotency guard', () => {
  it('unique_violation on insert (re-run after success) → skipped_already_charged, NO Paddle call', async () => {
    nextSubscriptionsResult = { data: [activeStarterSub()], error: null }
    enqueueRequestCount(105_000)
    // Simulate Postgres UNIQUE violation on the second cron run
    nextInsertError = { code: '23505', message: 'duplicate key value violates unique constraint' }

    const [report] = await run()

    expect(report!.status).toBe('skipped_already_charged')
    // No Paddle call, no UPDATE — purely a no-op
    expect(chargeSpy).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
  })

  it('non-unique insert failure → error status (not skipped — operator should investigate)', async () => {
    nextSubscriptionsResult = { data: [activeStarterSub()], error: null }
    enqueueRequestCount(105_000)
    nextInsertError = { code: '40001', message: 'serialization failure' }

    const [report] = await run()

    expect(report!.status).toBe('error')
    expect(report!.error).toContain('idempotency insert failed')
    expect(report!.error).toContain('serialization failure')
    // Paddle was NOT called — fail-closed when we can't even take the lock
    expect(chargeSpy).not.toHaveBeenCalled()
  })
})

// =========================================================================
// Skip paths — no insert, no Paddle call
// =========================================================================

describe('overage 3-state flow — skip paths (no row written, no Paddle call)', () => {
  it('outside the charging window (>48h before period_end) → skipped_not_in_window', async () => {
    nextSubscriptionsResult = { data: [activeStarterSub()], error: null }
    enqueueRequestCount(200_000) // would be huge overage if we charged

    const [report] = await run(NOW_OUT_OF_WINDOW)

    expect(report!.status).toBe('skipped_not_in_window')
    expect(inserts).toHaveLength(0)
    expect(chargeSpy).not.toHaveBeenCalled()
  })

  it('after period_end → skipped_not_in_window (no retroactive charges)', async () => {
    nextSubscriptionsResult = { data: [activeStarterSub()], error: null }
    enqueueRequestCount(200_000)

    const [report] = await run(NOW_AFTER_END)

    expect(report!.status).toBe('skipped_not_in_window')
    expect(inserts).toHaveLength(0)
    expect(chargeSpy).not.toHaveBeenCalled()
  })

  it('missing current_period_start or current_period_end → skipped_not_in_window', async () => {
    nextSubscriptionsResult = {
      data: [activeStarterSub({ current_period_end: null })],
      error: null,
    }
    // No enqueue — the missing-period branch returns before countMonthlyRequests is called

    const [report] = await run()

    expect(report!.status).toBe('skipped_not_in_window')
    expect(inserts).toHaveLength(0)
    expect(chargeSpy).not.toHaveBeenCalled()
  })

  it('usage at or below included quota → skipped_no_overage', async () => {
    nextSubscriptionsResult = { data: [activeStarterSub()], error: null }
    enqueueRequestCount(99_999) // under Starter's 100k

    const [report] = await run()

    expect(report!.status).toBe('skipped_no_overage')
    expect(report!.overage_requests).toBe(0)
    expect(inserts).toHaveLength(0)
    expect(chargeSpy).not.toHaveBeenCalled()
  })

  it('overage exists but PADDLE_PRICE_*_OVERAGE env unset → skipped_no_price (no charge made)', async () => {
    delete process.env['PADDLE_PRICE_STARTER_OVERAGE']
    nextSubscriptionsResult = { data: [activeStarterSub()], error: null }
    enqueueRequestCount(150_000)

    const [report] = await run()

    expect(report!.status).toBe('skipped_no_price')
    expect(report!.overage_requests).toBe(50_000)
    expect(inserts).toHaveLength(0)
    expect(chargeSpy).not.toHaveBeenCalled()
  })

  it('countMonthlyRequests throws → error status, NO insert (no chance of leaking partial state)', async () => {
    nextSubscriptionsResult = { data: [activeStarterSub()], error: null }
    enqueueRequestCount(new Error('ClickHouse query failed: ECONNREFUSED'))

    const [report] = await run()

    expect(report!.status).toBe('error')
    expect(report!.error).toContain('count failed')
    expect(report!.error).toContain('ECONNREFUSED')
    expect(inserts).toHaveLength(0)
    expect(chargeSpy).not.toHaveBeenCalled()
  })
})

// =========================================================================
// Multiple subscriptions in one run — independent processing
// =========================================================================

describe('overage 3-state flow — multi-subscription cron tick', () => {
  it('processes each subscription independently — one charges, one skips, one errors', async () => {
    // Three subs sharing the same period_end so the cron loop visits all three.
    nextSubscriptionsResult = {
      data: [
        activeStarterSub({ id: 'sub-charged', paddle_subscription_id: 'sub_paddle_a' }),
        activeStarterSub({ id: 'sub-no-overage', paddle_subscription_id: 'sub_paddle_b' }),
        activeStarterSub({ id: 'sub-error', paddle_subscription_id: 'sub_paddle_c' }),
      ],
      error: null,
    }
    // countMonthlyRequests is called once per sub (3 times total)
    enqueueRequestCount(150_000) // 50k overage → charged
    enqueueRequestCount(50_000)  // 0 overage  → skipped, no chargeSubscription call
    enqueueRequestCount(200_000) // 100k overage → error path

    // chargeSubscription is called for the 1st and 3rd sub only (the 2nd
    // is skipped before reaching Paddle)
    enqueueChargeResult({ ok: true, response: { data: { id: 'txn_a' } } })
    enqueueChargeResult({ ok: false, status: 400, error: 'card_declined' })

    const reports = await run()

    expect(reports).toHaveLength(3)
    expect(reports[0]!.status).toBe('charged')
    expect(reports[1]!.status).toBe('skipped_no_overage')
    expect(reports[2]!.status).toBe('error')

    // Only the two that had overage got pending rows
    expect(inserts).toHaveLength(2)
    expect(inserts.every((i) => i.values['status'] === 'pending')).toBe(true)

    // Both pending rows resolved (one charged, one error)
    expect(updates).toHaveLength(2)
    const statuses = updates.map((u) => u.values['status']).sort()
    expect(statuses).toEqual(['charged', 'error'])

    // chargeSubscription called exactly twice (the skipped sub never reached it)
    expect(chargeSpy).toHaveBeenCalledTimes(2)
  })
})
