import { afterEach, describe, expect, it, vi } from 'vitest'

// Stub ClickHouse + the requests-query plan lookup. selectGenerationsAsRequests
// goes through eventsScope() which calls getOrgPlan() — return 'team' so the
// retention clip is the longest non-Enterprise value.
const queryMock = vi.fn()
vi.mock('./clickhouse.js', () => ({
  getClickhouse: () => ({ query: queryMock }),
}))
vi.mock('./requests-query.js', async () => {
  const actual = await vi.importActual<typeof import('./requests-query.js')>('./requests-query.js')
  return {
    ...actual,
    getOrgPlan: async () => 'team',
  }
})

import { eventsScope, selectGenerationsAsRequests, countGenerations } from './events-query.js'

afterEach(() => queryMock.mockReset())

function jsonRes<T>(rows: T[]) {
  return { json: async () => rows as unknown }
}

describe('eventsScope', () => {
  it('returns the multitenant + retention WHERE fragment with team retention', async () => {
    const scope = await eventsScope('org-1')
    expect(scope.whereScope).toMatch(/organization_id = \{orgId:UUID\}/)
    expect(scope.whereScope).toMatch(/INTERVAL \{retentionDays:UInt32\} DAY/)
    expect(scope.scopeParams.retentionDays).toBe(365)
    expect(scope.scopeParams.orgId).toBe('org-1')
    expect(scope.plan).toBe('team')
  })

  it('skips the retention clip when ignoreRetention is set', async () => {
    const scope = await eventsScope('org-1', { ignoreRetention: true })
    expect(scope.whereScope).toBe('organization_id = {orgId:UUID}')
  })
})

describe('selectGenerationsAsRequests — read-side shim for /api/v1/requests', () => {
  it("filters by event_type = 'generation' in addition to the scope WHERE", async () => {
    queryMock.mockResolvedValueOnce(jsonRes([]))
    const scope = await eventsScope('org-1')
    await selectGenerationsAsRequests({ scope })

    const call = queryMock.mock.calls[0]?.[0] as { query: string; query_params: Record<string, unknown> }
    expect(call.query).toContain("event_type = 'generation'")
    expect(call.query).toContain('organization_id = {orgId:UUID}')
    expect(call.query_params['orgId']).toBe('org-1')
  })

  it('projects the events columns into the same shape selectRequests returns', async () => {
    queryMock.mockResolvedValueOnce(jsonRes([]))
    const scope = await eventsScope('org-1')
    await selectGenerationsAsRequests({ scope })

    const call = queryMock.mock.calls[0]?.[0] as { query: string }
    // Spot-check every alias the dashboard relies on.
    expect(call.query).toMatch(/event_id\).*AS id/s)
    expect(call.query).toMatch(/total_cost_usd\s+AS cost_usd/)
    expect(call.query).toMatch(/duration_ms\s+AS latency_ms/)
    expect(call.query).toMatch(/input\s+AS request_body/)
    expect(call.query).toMatch(/output\s+AS response_body/)
    expect(call.query).toMatch(/parent_event_id\s+AS span_id/)
  })

  it("substitutes neutral defaults for columns that don't exist on events yet", async () => {
    queryMock.mockResolvedValueOnce(jsonRes([]))
    const scope = await eventsScope('org-1')
    await selectGenerationsAsRequests({ scope })

    const call = queryMock.mock.calls[0]?.[0] as { query: string }
    // flags / response_flags / has_security_flags / truncated are
    // surfaced as empty / 0 so the dashboard's badges stay quiet.
    expect(call.query).toMatch(/'' +AS flags/)
    expect(call.query).toMatch(/'{}' +AS response_flags/)
    expect(call.query).toMatch(/0 +AS has_security_flags/)
    expect(call.query).toMatch(/0 +AS truncated/)
  })

  it('passes caller filters / orderBy / limit / offset through', async () => {
    queryMock.mockResolvedValueOnce(jsonRes([]))
    const scope = await eventsScope('org-1')
    await selectGenerationsAsRequests({
      scope,
      filters: 'status_code >= 400',
      orderBy: 'created_at DESC',
      limit: 50,
      offset: 100,
    })

    const call = queryMock.mock.calls[0]?.[0] as { query: string }
    expect(call.query).toContain('status_code >= 400')
    expect(call.query).toContain('ORDER BY created_at DESC')
    expect(call.query).toContain('LIMIT 50')
    expect(call.query).toContain('OFFSET 100')
  })

  it('returns the rows the query produced (no transformation)', async () => {
    const fakeRow = { id: 'evt-1', provider: 'openai', model: 'gpt-4o' }
    queryMock.mockResolvedValueOnce(jsonRes([fakeRow]))
    const scope = await eventsScope('org-1')
    const rows = await selectGenerationsAsRequests<typeof fakeRow>({ scope })
    expect(rows).toEqual([fakeRow])
  })
})

describe('countGenerations', () => {
  it("counts rows in events with event_type = 'generation'", async () => {
    queryMock.mockResolvedValueOnce(jsonRes([{ c: '42' }]))
    const scope = await eventsScope('org-1')
    const total = await countGenerations({ scope })
    expect(total).toBe(42)
    const call = queryMock.mock.calls[0]?.[0] as { query: string }
    expect(call.query).toContain("event_type = 'generation'")
  })
})
