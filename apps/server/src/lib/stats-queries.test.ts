import { beforeEach, describe, expect, it, vi } from 'vitest'

// stats-queries builds the dashboard ClickHouse SQL. Two invariants matter and
// were untested: (1) every read carries the org+retention scope (multitenancy),
// and (2) JSONEachRow returns ALL numerics as strings (gotcha #19), so the
// builders must coerce with Number() or the API leaks "0.001"+1 = "0.0011".

let chRows: Array<Record<string, unknown>>
let lastQuery: { query: string; query_params: Record<string, unknown> } | null

const queryMock = vi.fn(async (opts: { query: string; query_params: Record<string, unknown> }) => {
  lastQuery = opts
  return { json: async () => chRows }
})

vi.mock('./clickhouse.js', () => ({
  unscopedClickhouse: () => ({ query: queryMock }),
}))
vi.mock('./requests-query.js', () => ({
  requestsScope: vi.fn(async (orgId: string) => ({
    whereScope: 'organization_id = {orgId:UUID} AND created_at >= now() - INTERVAL {retentionDays:UInt32} DAY',
    scopeParams: { orgId, retentionDays: 14 },
    plan: 'free',
  })),
}))
vi.mock('./stats-source.js', () => ({
  statsSource: vi.fn(async () => 'requests'),
}))

import { getStatsOverview, getStatsModels } from './stats-queries.js'

beforeEach(() => {
  chRows = []
  lastQuery = null
  queryMock.mockClear()
})

describe('getStatsOverview', () => {
  it('coerces every JSONEachRow string numeric to a JS number', async () => {
    // ClickHouse returns these as strings over the wire.
    chRows = [{
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
    chRows = [{}]
    await getStatsOverview('org-1')
    expect(lastQuery!.query).toContain('organization_id = {orgId:UUID}')
    expect(lastQuery!.query).toContain('INTERVAL {retentionDays:UInt32} DAY')
    expect(lastQuery!.query_params).toMatchObject({ orgId: 'org-1', retentionDays: 14 })
    expect(lastQuery!.query.toLowerCase()).not.toContain('ilike')
  })

  it('defaults missing row fields to 0 (empty result set)', async () => {
    chRows = []
    const r = await getStatsOverview('org-1')
    expect(r.total_requests).toBe(0)
    expect(r.total_cost_usd).toBe(0)
  })

  it('threads projectId into the params + filter when provided', async () => {
    chRows = [{}]
    await getStatsOverview('org-1', { projectId: 'proj-9' })
    expect(lastQuery!.query).toContain('project_id = {projectId:UUID}')
    expect(lastQuery!.query_params['projectId']).toBe('proj-9')
  })
})

describe('getStatsModels', () => {
  it('coerces each row and preserves provider/model strings', async () => {
    chRows = [
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

  it('scopes by org and strips the Z from the from timestamp', async () => {
    chRows = []
    await getStatsModels('org-1', { from: '2026-06-01T00:00:00.000Z' })
    expect(lastQuery!.query).toContain('organization_id = {orgId:UUID}')
    expect(lastQuery!.query_params['fromTs']).toBe('2026-06-01 00:00:00.000')
    expect(lastQuery!.query_params).toMatchObject({ orgId: 'org-1', retentionDays: 14 })
  })

  it('returns [] for an empty result set', async () => {
    chRows = []
    expect(await getStatsModels('org-1', { from: '2026-06-01T00:00:00.000Z' })).toEqual([])
  })
})
