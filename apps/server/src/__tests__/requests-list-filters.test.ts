import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/requests filter assembly.
//
// The list and the export now share lib/request-filters.ts. This pins the
// list's side of that contract (the WHERE it builds, its lenient handling of
// unknown enum values, its 400s) so moving the parsing out of requests.ts did
// not change what the dashboard, the MCP server and BI tools get back.
// ─────────────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  selectRequests: vi.fn(),
  countRequests: vi.fn(),
}))

vi.mock('../lib/db.js', () => ({ supabaseAdmin: {}, supabaseClient: {} }))
vi.mock('../lib/logger.js', () => ({ logRequestAsync: vi.fn() }))
vi.mock('../proxy/utils.js', () => ({
  getDecryptedProviderKeyById: vi.fn(),
  getDecryptedProviderKey: vi.fn(),
}))
vi.mock('../lib/requests-query.js', () => ({
  requestsScope: vi.fn(async (orgId: string) => ({
    whereScope: 'organization_id = {orgId}',
    scopeParams: { orgId, retentionDays: 14 },
    plan: 'free',
  })),
  selectRequests: mocks.selectRequests,
  countRequests: mocks.countRequests,
  fetchProviderKeyNames: vi.fn(async () => new Map()),
}))
vi.mock('../middleware/authJwtOrApiKey.js', () => ({
  authJwtOrApiKey: async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('orgId', 'org_1')
    c.set('role', 'viewer')
    return next()
  },
}))

import { requestsRouter } from '../api/requests.js'
import { serializeErrorEnvelope } from '../lib/errors.js'

const app = new Hono()
app.route('/api/v1/requests', requestsRouter)
app.onError((err, c) => {
  const { status, body } = serializeErrorEnvelope(err, null)
  return c.json(body, status as ContentfulStatusCode)
})

const PROJECT = '11111111-1111-4111-8111-111111111111'
const KEY = '22222222-2222-4222-8222-222222222222'
const PROMPT_VERSION = '33333333-3333-4333-8333-333333333333'

interface SelectCall {
  filters: string | undefined
  params: Record<string, unknown>
  orderBy: string
  limit: number
  offset: number
}

function lastSelect(): SelectCall {
  return mocks.selectRequests.mock.calls.at(-1)?.[0] as SelectCall
}

beforeEach(() => {
  mocks.selectRequests.mockReset().mockResolvedValue([])
  mocks.countRequests.mockReset().mockResolvedValue(0)
})

describe('GET /api/v1/requests filters', () => {
  test('every filter lands in the WHERE, and count uses the same one', async () => {
    const res = await app.request(
      `/api/v1/requests?projectId=${PROJECT}&provider=openai&model=mini&providerKeyId=${KEY}` +
        `&promptVersionId=${PROMPT_VERSION}&userId=customer-a&sessionId=sess-1` +
        '&from=2026-05-01T00:00:00.000Z&to=2026-05-31T00:00:00.000Z&status=ok&truncated=false',
    )
    expect(res.status).toBe(200)
    const call = lastSelect()
    expect(call.filters).toBe(
      'project_id = {projectId} AND provider = {provider} AND ' +
        'position(lower({model}) in lower(model)) > 0 AND provider_key_id = {providerKeyId} AND ' +
        'prompt_version_id = {promptVersionId} AND user_id = {userId} AND session_id = {sessionId} AND ' +
        'created_at >= {from}::timestamptz AND created_at <= {to}::timestamptz AND ' +
        'status_code < 400 AND truncated = false',
    )
    expect(call.params).toEqual({
      projectId: PROJECT,
      provider: 'openai',
      model: 'mini',
      providerKeyId: KEY,
      promptVersionId: PROMPT_VERSION,
      userId: 'customer-a',
      sessionId: 'sess-1',
      from: '2026-05-01T00:00:00.000Z',
      to: '2026-05-31T00:00:00.000Z',
    })
    const count = mocks.countRequests.mock.calls.at(-1)?.[0] as SelectCall
    expect(count.filters).toBe(call.filters)
    expect(count.params).toEqual(call.params)
  })

  test('status=error is the >= 400 synonym', async () => {
    await app.request('/api/v1/requests?status=error')
    expect(lastSelect().filters).toBe('status_code >= 400')
  })

  test('unknown status / truncated values stay ignored on the list (lenient contract)', async () => {
    const res = await app.request('/api/v1/requests?status=bogus&truncated=maybe')
    expect(res.status).toBe(200)
    expect(lastSelect().filters).toBeUndefined()
  })

  test('sorting and paging are untouched by the shared parser', async () => {
    await app.request('/api/v1/requests?sortBy=cost_usd&sortDir=asc&page=3&limit=20')
    const call = lastSelect()
    expect(call.orderBy).toBe('cost_usd ASC NULLS LAST')
    expect(call.limit).toBe(20)
    expect(call.offset).toBe(40)
  })

  test.each(['projectId=abc', 'providerKeyId=abc', 'promptVersionId=abc', 'from=garbage', 'to=garbage'])(
    '%s is a 400',
    async (query) => {
      const res = await app.request(`/api/v1/requests?${query}`)
      expect(res.status).toBe(400)
      expect(mocks.selectRequests).not.toHaveBeenCalled()
    },
  )
})
