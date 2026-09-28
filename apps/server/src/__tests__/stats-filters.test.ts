import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Hono } from 'hono'
import { installOnError } from './helpers/install-on-error.js'

/**
 * GET /api/v1/stats/{overview,timeseries,timeseries-breakdown,models}.
 *
 * The /requests page puts a KPI strip and a traffic chart above a filtered
 * table. Those two read overview + timeseries + breakdown, so the routes have
 * to accept the table's filters and hand them to the query layer unchanged.
 * Before this, they accepted only a time window and the strip described the
 * whole workspace while the table below it was narrowed to one customer.
 *
 * Auth and SQL are mocked at the module boundary: auth is covered by the
 * dual-auth suites, and the SQL shapes by stats-queries.test.ts plus
 * supabase/tests/requests-sql-smoke.sql.
 */

const getStatsOverview = vi.hoisted(() => vi.fn())
const getStatsTimeseries = vi.hoisted(() => vi.fn())
const getTimeseriesBreakdown = vi.hoisted(() => vi.fn())
const getStatsModels = vi.hoisted(() => vi.fn())
const getLatencyPercentiles = vi.hoisted(() => vi.fn())

vi.mock('../lib/stats-queries.js', () => ({
  getStatsOverview,
  getStatsTimeseries,
  getTimeseriesBreakdown,
  getStatsModels,
  getLatencyPercentiles,
}))

vi.mock('../middleware/authJwtOrApiKey.js', () => ({
  authJwtOrApiKey: async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('orgId', 'org-1')
    await next()
  },
}))

const { statsRouter } = await import('../api/stats.js')

function makeApp(): Hono {
  const app = new Hono()
  installOnError(app)
  app.route('/api/v1/stats', statsRouter)
  return app
}

const KEY_ID = '11111111-1111-4111-8111-111111111111'
const PROMPT_ID = '22222222-2222-4222-8222-222222222222'
const EMPTY_OVERVIEW = {
  total_requests: 0,
  success_requests: 0,
  error_requests: 0,
  total_cost_usd: 0,
  total_tokens: 0,
  prompt_tokens: 0,
  completion_tokens: 0,
  avg_latency_ms: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  getStatsOverview.mockResolvedValue(EMPTY_OVERVIEW)
  getStatsTimeseries.mockResolvedValue([])
  getTimeseriesBreakdown.mockResolvedValue([])
  getStatsModels.mockResolvedValue([])
})

const FULL_QUERY = new URLSearchParams({
  from: '2026-09-01T00:00:00.000Z',
  provider: 'anthropic',
  model: 'claude',
  providerKeyId: KEY_ID,
  promptVersionId: PROMPT_ID,
  userId: 'customer-a',
  sessionId: 'sess-9',
  status: '5xx',
  truncated: 'true',
}).toString()

const EXPECTED_FILTERS = {
  provider: 'anthropic',
  model: 'claude',
  providerKeyId: KEY_ID,
  promptVersionId: PROMPT_ID,
  userId: 'customer-a',
  sessionId: 'sess-9',
  status: '5xx',
  truncated: true,
}

describe('table filters reach the query layer', () => {
  test('overview', async () => {
    const res = await makeApp().request(`/api/v1/stats/overview?${FULL_QUERY}`)
    expect(res.status).toBe(200)
    expect(getStatsOverview).toHaveBeenCalledTimes(1)
    expect(getStatsOverview.mock.calls[0]![1]).toMatchObject({ filters: EXPECTED_FILTERS })
  })

  test('overview with compare narrows the previous period the same way', async () => {
    const res = await makeApp().request(`/api/v1/stats/overview?${FULL_QUERY}&compare=true`)
    expect(res.status).toBe(200)
    expect(getStatsOverview).toHaveBeenCalledTimes(2)
    for (const call of getStatsOverview.mock.calls) {
      expect(call[1]).toMatchObject({ filters: EXPECTED_FILTERS })
    }
  })

  test('timeseries', async () => {
    const res = await makeApp().request(`/api/v1/stats/timeseries?${FULL_QUERY}`)
    expect(res.status).toBe(200)
    expect(getStatsTimeseries.mock.calls[0]![1]).toMatchObject({ filters: EXPECTED_FILTERS })
  })

  test('timeseries-breakdown', async () => {
    const res = await makeApp().request(`/api/v1/stats/timeseries-breakdown?${FULL_QUERY}`)
    expect(res.status).toBe(200)
    expect(getTimeseriesBreakdown.mock.calls[0]![1]).toMatchObject({ filters: EXPECTED_FILTERS })
  })

  test('the friendly status synonyms the list API accepts are accepted here too', async () => {
    await makeApp().request('/api/v1/stats/overview?status=error')
    expect(getStatsOverview.mock.calls[0]![1].filters.status).toBe('error')
  })

  test('an unknown status is ignored, as the list API ignores it', async () => {
    const res = await makeApp().request('/api/v1/stats/overview?status=teapot&truncated=maybe')
    expect(res.status).toBe(200)
    const filters = getStatsOverview.mock.calls[0]![1].filters
    expect(filters.status).toBeUndefined()
    expect(filters.truncated).toBeUndefined()
  })
})

describe('malformed parameters are a 400, not a raw 500', () => {
  test.each([
    ['overview', 'providerKeyId=abc'],
    ['overview', 'promptVersionId=abc'],
    ['timeseries', 'providerKeyId=abc'],
    ['timeseries', 'from=garbage'],
    ['timeseries-breakdown', 'to=garbage'],
  ])('%s ?%s', async (route, qs) => {
    const res = await makeApp().request(`/api/v1/stats/${route}?${qs}`)
    expect(res.status).toBe(400)
    expect(getStatsOverview).not.toHaveBeenCalled()
    expect(getStatsTimeseries).not.toHaveBeenCalled()
    expect(getTimeseriesBreakdown).not.toHaveBeenCalled()
  })
})

describe('GET /models', () => {
  test('reports an unpriced model as null rather than $0', async () => {
    getStatsModels.mockResolvedValue([
      { provider: 'openai', model: 'gpt-4o', requests: 5, total_cost_usd: 0.1234567, avg_latency_ms: 300.4, error_rate: 0 },
      { provider: 'xai', model: 'grok-mystery', requests: 9, total_cost_usd: null, avg_latency_ms: 200, error_rate: 0 },
    ])
    const res = await makeApp().request('/api/v1/stats/models?hours=24')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Array<{ model: string; totalCostUsd: number | null }> }
    expect(body.data.map((m) => [m.model, m.totalCostUsd])).toEqual([
      ['gpt-4o', 0.123457],
      ['grok-mystery', null],
    ])
  })
})
