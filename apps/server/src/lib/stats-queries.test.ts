import { beforeEach, describe, expect, it, vi } from 'vitest'

// stats-queries builds the dashboard SQL against the Postgres `requests` table.
// Two invariants matter and were untested: (1) every read carries the
// org+retention scope (multitenancy), and (2) node-postgres returns `numeric`
// and `int8` as strings on purpose (lib/postgres.ts explains why), so the
// builders must coerce with Number(), or the API leaks string concatenation:
// "0.001"+1 = "0.0011" (gotcha #19).

let pgRows: Array<Record<string, unknown>>
let lastQuery: { query: string; params: Record<string, unknown> } | null

const queryMock = vi.fn(async (opts: { query: string; params: Record<string, unknown> }) => {
  lastQuery = opts
  return pgRows
})

vi.mock('./postgres.js', () => ({
  // Wrapped rather than passed directly: vi.mock factories are hoisted above
  // the `const`, so the reference must be resolved at call time.
  pgQuery: (opts: { query: string; params: Record<string, unknown> }) => queryMock(opts),
  pgQueryOne: vi.fn(),
  pgExecute: vi.fn(),
  pgStream: vi.fn(),
}))
vi.mock('./requests-query.js', () => ({
  requestsScope: vi.fn(async (orgId: string) => ({
    whereScope:
      'organization_id = {orgId} AND created_at >= now() - make_interval(days => {retentionDays})',
    scopeParams: { orgId, retentionDays: 14 },
    plan: 'free',
  })),
}))

import { getStatsOverview, getStatsModels, getUserAnalytics } from './stats-queries.js'

beforeEach(() => {
  pgRows = []
  lastQuery = null
  queryMock.mockClear()
})

describe('getStatsOverview', () => {
  it('coerces every string numeric returned by the driver to a JS number', async () => {
    // node-postgres hands back numeric/int8 as strings.
    pgRows = [{
      total_requests: '100',
      success_requests: '90',
      error_requests: '10',
      total_cost_usd: '1.5',
      total_tokens: '12345',
      prompt_tokens: '8000',
      completion_tokens: '4345',
      avg_latency_ms: '250.7',
    }]
    const r = await getStatsOverview('org-1')
    for (const v of Object.values(r)) expect(typeof v).toBe('number')
    expect(r.total_requests).toBe(100)
    expect(r.total_cost_usd).toBeCloseTo(1.5, 6)
    expect(r.avg_latency_ms).toBeCloseTo(250.7, 6)
  })

  it('scopes the query by org + retention and never uses ilike', async () => {
    pgRows = [{}]
    await getStatsOverview('org-1')
    expect(lastQuery!.query).toContain('organization_id = {orgId}')
    expect(lastQuery!.query).toContain('make_interval(days => {retentionDays})')
    expect(lastQuery!.params).toMatchObject({ orgId: 'org-1', retentionDays: 14 })
    expect(lastQuery!.query.toLowerCase()).not.toContain('ilike')
  })

  it('counts with FILTER rather than a second scan', async () => {
    // `countIf(status_code < 400)` became `count(*) FILTER (WHERE …)`. Both
    // splits happen in one pass; a rewrite into subqueries would double the
    // table scans on the dashboard's hottest read.
    pgRows = [{}]
    await getStatsOverview('org-1')
    expect(lastQuery!.query).toContain('count(*) FILTER (WHERE status_code <  400)')
    expect(lastQuery!.query).toContain('count(*) FILTER (WHERE status_code >= 400)')
  })

  it('defaults missing row fields to 0 (empty result set)', async () => {
    pgRows = []
    const r = await getStatsOverview('org-1')
    expect(r.total_requests).toBe(0)
    expect(r.total_cost_usd).toBe(0)
  })

  it('threads projectId into the params + filter when provided', async () => {
    pgRows = [{}]
    await getStatsOverview('org-1', { projectId: 'proj-9' })
    expect(lastQuery!.query).toContain('project_id = {projectId}')
    expect(lastQuery!.params['projectId']).toBe('proj-9')
  })
})

describe('getStatsModels', () => {
  it('coerces each row and preserves provider/model strings', async () => {
    pgRows = [
      { provider: 'openai', model: 'gpt-4o', requests: '50', total_cost_usd: '0.9', avg_latency_ms: '300', error_rate: '0.02' },
      { provider: 'anthropic', model: 'claude', requests: '20', total_cost_usd: '0.4', avg_latency_ms: '410', error_rate: '0' },
    ]
    const rows = await getStatsModels('org-1', { from: '2026-06-01T00:00:00.000Z' })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ provider: 'openai', model: 'gpt-4o', requests: 50, total_cost_usd: 0.9, avg_latency_ms: 300, error_rate: 0.02 })
    for (const r of rows) {
      expect(typeof r.requests).toBe('number')
      expect(typeof r.total_cost_usd).toBe('number')
      expect(typeof r.error_rate).toBe('number')
    }
  })

  it('scopes by org and binds the from timestamp with its UTC marker intact', async () => {
    // The `Z` has to survive into the bound parameter. Strip it and Postgres
    // reads the bound in the session timezone rather than UTC, which shifts
    // the whole window without erroring. The value crosses untouched and is
    // cast at the placeholder instead.
    pgRows = []
    await getStatsModels('org-1', { from: '2026-06-01T00:00:00.000Z' })
    expect(lastQuery!.query).toContain('organization_id = {orgId}')
    expect(lastQuery!.query).toContain('created_at >= {fromTs}::timestamptz')
    expect(lastQuery!.params['fromTs']).toBe('2026-06-01T00:00:00.000Z')
    expect(lastQuery!.params).toMatchObject({ orgId: 'org-1', retentionDays: 14 })
  })

  it('returns [] for an empty result set', async () => {
    pgRows = []
    expect(await getStatsModels('org-1', { from: '2026-06-01T00:00:00.000Z' })).toEqual([])
  })
})

describe('getUserAnalytics', () => {
  const baseOptions = {
    sortBy: 'cost' as const,
    sortDir: 'desc' as const,
    limit: 20,
    offset: 0,
  }

  it('matches a search term literally, never as an ILIKE pattern', async () => {
    // `positionCaseInsensitive(user_id, {search})` became
    // `position(lower({search}) in lower(user_id))`. ILIKE would have been the
    // obvious translation and the wrong one: it reads `%` and `_` in the
    // caller's string as wildcards, so a user id containing an underscore
    // would start matching its neighbours.
    pgRows = []
    await getUserAnalytics('org-1', { ...baseOptions, search: 'user_42' })
    expect(lastQuery!.query).toContain('position(lower({search}) in lower(user_id)) > 0')
    expect(lastQuery!.query.toLowerCase()).not.toContain('ilike')
    expect(lastQuery!.params['search']).toBe('user_42')
  })

  it('counts distinct models with count(DISTINCT …) and scopes by org', async () => {
    pgRows = [{
      user_id: 'u1',
      total_requests: '7',
      total_tokens: '900',
      total_cost_usd: '0.0012',
      avg_latency_ms: '310.5',
      first_seen: '2026-06-01T00:00:00.000Z',
      last_seen: '2026-06-02T00:00:00.000Z',
      error_requests: '1',
      distinct_models: '3',
      total_count: '1',
    }]
    const rows = await getUserAnalytics('org-1', baseOptions)
    expect(lastQuery!.query).toContain('count(DISTINCT model)')
    expect(lastQuery!.query).toContain('organization_id = {orgId}')
    expect(lastQuery!.params).toMatchObject({ orgId: 'org-1', retentionDays: 14 })
    expect(rows[0]).toMatchObject({
      user_id: 'u1',
      total_requests: 7,
      total_cost_usd: 0.0012,
      distinct_models: 3,
      error_requests: 1,
    })
    expect(typeof rows[0]!.total_cost_usd).toBe('number')
  })
})
