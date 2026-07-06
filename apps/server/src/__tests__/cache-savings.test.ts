import { describe, it, expect, vi, beforeEach } from 'vitest'

// getCacheSavings queries ClickHouse directly. Mock unscopedClickhouse() so
// tests run without a real container; helpers below shape the response the
// way @clickhouse/client returns it (a ResultSet whose .json() resolves to
// an array of plain rows). Same pattern as anomaly-detect.test.ts.
const mockChQuery = vi.hoisted(() => vi.fn())
vi.mock('../lib/clickhouse.js', () => ({
  unscopedClickhouse: () => ({ query: mockChQuery }),
  toClickhouseTimestamp: (date: Date = new Date()) =>
    date.toISOString().replace('T', ' ').replace('Z', ''),
}))

// requestsScope reads the org plan from Supabase — stub it so the test stays
// DB-free while still asserting the WHERE scope is threaded through.
vi.mock('../lib/requests-query.js', () => ({
  requestsScope: vi.fn(async (orgId: string) => ({
    whereScope:
      'organization_id = {orgId:UUID} AND created_at >= now() - INTERVAL {retentionDays:UInt32} DAY',
    scopeParams: { orgId, retentionDays: 14 },
    plan: 'free',
  })),
}))

import {
  computeCacheSavings,
  currentMonthStartUtc,
  getCacheSavings,
  type CacheSavingsRow,
} from '../lib/cache-savings.js'

function chReturn(rows: object[]) {
  return Promise.resolve({ json: () => Promise.resolve(rows) })
}

function row(overrides: Partial<CacheSavingsRow> = {}): CacheSavingsRow {
  return {
    model: 'gpt-4o-mini',
    cache_read_tokens_sum: '0',
    cache_hit_requests: '0',
    ...overrides,
  }
}

beforeEach(() => { mockChQuery.mockReset() })

describe('computeCacheSavings — pricing math', () => {
  it('prices cache reads at (input − cacheRead) per 1M tokens', () => {
    // FALLBACK_PRICES: gpt-4o-mini → prompt 0.15, cacheRead 0.075.
    // 1M cached tokens → saving = (0.15 − 0.075) = $0.075.
    const totals = computeCacheSavings([
      row({ model: 'gpt-4o-mini', cache_read_tokens_sum: '1000000', cache_hit_requests: '10' }),
    ])
    expect(totals.savingsUsd).toBeCloseTo(0.075, 10)
    expect(totals.cacheReadTokens).toBe(1_000_000)
    expect(totals.cacheHitRequests).toBe(10)
  })

  it('sums savings across models with different discount rates', () => {
    // claude-haiku-4.5 → prompt 1, cacheRead 0.1 → $0.90 saved per 1M cached.
    const totals = computeCacheSavings([
      row({ model: 'gpt-4o-mini',      cache_read_tokens_sum: '2000000', cache_hit_requests: '20' }),
      row({ model: 'claude-haiku-4.5', cache_read_tokens_sum: '500000',  cache_hit_requests: '5' }),
    ])
    // 2 × 0.075 + 0.5 × 0.9 = 0.15 + 0.45 = 0.60
    expect(totals.savingsUsd).toBeCloseTo(0.6, 10)
    expect(totals.cacheReadTokens).toBe(2_500_000)
    expect(totals.cacheHitRequests).toBe(25)
  })

  it('resolves dated model variants via the boundary-aware prefix lookup', () => {
    // gpt-4o-mini-2024-07-18 must resolve to the gpt-4o-mini price row.
    const totals = computeCacheSavings([
      row({ model: 'gpt-4o-mini-2024-07-18', cache_read_tokens_sum: '1000000', cache_hit_requests: '3' }),
    ])
    expect(totals.savingsUsd).toBeCloseTo(0.075, 10)
  })

  it('claims zero savings for unknown models but still counts their tokens', () => {
    const totals = computeCacheSavings([
      row({ model: 'future-model-9000', cache_read_tokens_sum: '9000000', cache_hit_requests: '90' }),
    ])
    expect(totals.savingsUsd).toBe(0)
    expect(totals.cacheReadTokens).toBe(9_000_000)
    expect(totals.cacheHitRequests).toBe(90)
  })

  it('claims zero savings when a model has no discounted cacheRead price', () => {
    // gpt-5.5-pro has no cacheRead in FALLBACK_PRICES → billed at full input
    // rate → discount is zero.
    const totals = computeCacheSavings([
      row({ model: 'gpt-5.5-pro', cache_read_tokens_sum: '1000000', cache_hit_requests: '4' }),
    ])
    expect(totals.savingsUsd).toBe(0)
    expect(totals.cacheReadTokens).toBe(1_000_000)
  })

  it('ignores zero-token and malformed rows', () => {
    const totals = computeCacheSavings([
      row({ model: 'gpt-4o-mini', cache_read_tokens_sum: '0',            cache_hit_requests: '2' }),
      row({ model: 'gpt-4o-mini', cache_read_tokens_sum: 'not-a-number', cache_hit_requests: '2' }),
    ])
    expect(totals).toEqual({ savingsUsd: 0, cacheReadTokens: 0, cacheHitRequests: 0 })
  })

  it('returns all-zero totals for an empty result set', () => {
    expect(computeCacheSavings([])).toEqual({
      savingsUsd: 0,
      cacheReadTokens: 0,
      cacheHitRequests: 0,
    })
  })
})

describe('currentMonthStartUtc', () => {
  it('returns the UTC first-of-month boundary', () => {
    const start = currentMonthStartUtc(new Date('2026-07-06T15:30:00Z'))
    expect(start.toISOString()).toBe('2026-07-01T00:00:00.000Z')
  })

  it('handles the first millisecond of a month', () => {
    const start = currentMonthStartUtc(new Date('2026-12-01T00:00:00.000Z'))
    expect(start.toISOString()).toBe('2026-12-01T00:00:00.000Z')
  })
})

describe('getCacheSavings — ClickHouse plumbing', () => {
  it('aggregates rows returned by ClickHouse and reports the month start', async () => {
    mockChQuery.mockReturnValue(chReturn([
      row({ model: 'gpt-4o-mini', cache_read_tokens_sum: '1000000', cache_hit_requests: '10' }),
    ]))
    const summary = await getCacheSavings('org-1')
    expect(summary.savingsUsd).toBeCloseTo(0.075, 10)
    expect(summary.cacheReadTokens).toBe(1_000_000)
    expect(summary.cacheHitRequests).toBe(10)
    expect(summary.monthStart).toBe(currentMonthStartUtc().toISOString())
  })

  it('threads the tenant scope + month boundary into the query', async () => {
    mockChQuery.mockReturnValue(chReturn([]))
    await getCacheSavings('org-9')
    expect(mockChQuery).toHaveBeenCalledTimes(1)
    const call = mockChQuery.mock.calls[0]![0] as {
      query: string
      query_params: Record<string, unknown>
    }
    expect(call.query).toContain('organization_id = {orgId:UUID}')
    expect(call.query).toContain('cache_read_tokens > 0')
    expect(call.query_params['orgId']).toBe('org-9')
    expect(call.query_params['monthStart']).toBeDefined()
  })

  // Regression: aliasing the aggregate as the raw column name made ClickHouse
  // bind the WHERE predicate to the aggregate and reject the query with
  // ILLEGAL_AGGREGATION (code 184), 500ing the whole feature. The aggregate
  // must use a distinct alias while the WHERE keeps filtering the raw column.
  it('does not alias the sum with the raw column name (ILLEGAL_AGGREGATION guard)', async () => {
    mockChQuery.mockReturnValue(chReturn([]))
    await getCacheSavings('org-9')
    const call = mockChQuery.mock.calls[0]![0] as { query: string }
    expect(call.query).toContain('sum(cache_read_tokens) AS cache_read_tokens_sum')
    expect(call.query).not.toMatch(/sum\(cache_read_tokens\)\s+AS\s+cache_read_tokens\b(?!_)/)
  })

  it('propagates ClickHouse failures to the caller', async () => {
    mockChQuery.mockReturnValue(Promise.reject(new Error('connection refused')))
    await expect(getCacheSavings('org-1')).rejects.toThrow('connection refused')
  })
})
