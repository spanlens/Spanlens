import { beforeEach, describe, expect, test, vi } from 'vitest'

// P3.1: checkMonthlyQuota runs on every /proxy/* request and must not hit
// Supabase plus a `requests` count each time. These tests pin the caching:
// org settings and the month count are fetched once per org per TTL window.
const fromMock = vi.fn()
vi.mock('../lib/db.js', () => ({
  supabaseAdmin: { from: (...args: unknown[]) => fromMock(...args) },
}))

const pgQueryMock = vi.fn()
vi.mock('../lib/postgres.js', () => ({
  // Wrapped rather than passed by reference: vi.mock factories are hoisted
  // above the const, so the spy must be resolved lazily at call time.
  pgQuery: (opts: unknown) => pgQueryMock(opts),
}))

import { checkMonthlyQuota, resetQuotaCaches } from '../lib/quota.js'

function setOrgPlan(plan: string, allowOverage = true, capMultiplier = 5) {
  fromMock.mockReturnValue({
    select: () => ({
      eq: () => ({
        single: async () => ({ data: { plan, allow_overage: allowOverage, overage_cap_multiplier: capMultiplier } }),
      }),
    }),
  })
}

function setCount(n: number) {
  // `pgQuery` resolves rows directly, and `count(*)` (int8) arrives as a
  // string — the fixture keeps that shape so the coercion stays pinned.
  pgQueryMock.mockResolvedValue([{ n: String(n) }])
}

beforeEach(() => {
  resetQuotaCaches()
  fromMock.mockReset()
  pgQueryMock.mockReset()
})

describe('checkMonthlyQuota caching (P3.1)', () => {
  test('warm cache: a second call within TTL hits neither Supabase nor the requests table', async () => {
    setOrgPlan('free')
    setCount(10)

    const first = await checkMonthlyQuota('org_1')
    const second = await checkMonthlyQuota('org_1')

    expect(first.usedThisMonth).toBe(10)
    expect(second.usedThisMonth).toBe(10)
    expect(fromMock).toHaveBeenCalledTimes(1) // org settings cached
    expect(pgQueryMock).toHaveBeenCalledTimes(1) // month count cached
  })

  test('concurrent cold calls coalesce into one of each query', async () => {
    setOrgPlan('starter')
    setCount(50)

    await Promise.all([
      checkMonthlyQuota('org_2'),
      checkMonthlyQuota('org_2'),
      checkMonthlyQuota('org_2'),
    ])

    expect(fromMock).toHaveBeenCalledTimes(1)
    expect(pgQueryMock).toHaveBeenCalledTimes(1)
  })

  test('enterprise (unlimited) skips the count query entirely', async () => {
    setOrgPlan('enterprise')

    const res = await checkMonthlyQuota('org_3')

    expect(res.allowed).toBe(true)
    expect(res.limit).toBeNull()
    expect(pgQueryMock).not.toHaveBeenCalled()
  })

  test('resetQuotaCaches forces a refetch', async () => {
    setOrgPlan('free')
    setCount(10)

    await checkMonthlyQuota('org_4')
    resetQuotaCaches()
    await checkMonthlyQuota('org_4')

    expect(fromMock).toHaveBeenCalledTimes(2)
    expect(pgQueryMock).toHaveBeenCalledTimes(2)
  })

  test('separate orgs do not share cache entries', async () => {
    setOrgPlan('free')
    setCount(10)

    await checkMonthlyQuota('org_a')
    await checkMonthlyQuota('org_b')

    expect(fromMock).toHaveBeenCalledTimes(2)
    expect(pgQueryMock).toHaveBeenCalledTimes(2)
  })
})
