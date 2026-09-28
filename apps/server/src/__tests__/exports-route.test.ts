import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/exports/requests, through the router.
//
// Pins XVERIFY-2026-09-28 C10.2: the export has to filter exactly like the
// list it is launched from (user / session / prompt version / truncated /
// status synonyms), reject malformed input with a 400 before any query runs,
// and carry the columns needed to check a filtered export afterwards. It also
// pins the early-failure path: a query that fails before the first row is a
// 500, not a 200 whose body ends in an error.
// ─────────────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  selectRequests: vi.fn(),
  streamRequests: vi.fn(),
}))

vi.mock('../lib/db.js', () => ({ supabaseAdmin: {}, supabaseClient: {} }))
vi.mock('../lib/anomaly.js', () => ({ detectAnomalies: vi.fn(async () => []) }))
vi.mock('../lib/requests-query.js', () => ({
  requestsScope: vi.fn(async (orgId: string) => ({
    whereScope: 'organization_id = {orgId}',
    scopeParams: { orgId, retentionDays: 14 },
    plan: 'free',
  })),
  selectRequests: mocks.selectRequests,
  streamRequests: mocks.streamRequests,
}))
vi.mock('../middleware/authJwt.js', () => ({
  authJwt: async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', 'u1')
    c.set('orgId', 'org_1')
    c.set('role', 'viewer')
    return next()
  },
}))

import { exportsRouter } from '../api/exports.js'
import { serializeErrorEnvelope } from '../lib/errors.js'

const app = new Hono()
app.route('/api/v1/exports', exportsRouter)
app.onError((err, c) => {
  const { status, body } = serializeErrorEnvelope(err, null)
  return c.json(body, status as ContentfulStatusCode)
})

const PROMPT_VERSION = '33333333-3333-4333-8333-333333333333'

const LEGACY_HEADER =
  'id,project_id,provider,model,prompt_tokens,completion_tokens,total_tokens,' +
  'cost_usd,latency_ms,status_code,error_message,trace_id,created_at'

/**
 * Stands in for the cursor generator; `released` flips like pgStream's
 * finally. With `roundTrip`, every row after the first waits a macrotask, the
 * way a real cursor waits on the database.
 */
function fakeCursor<T>(rows: T[], failAfter?: number, roundTrip = false) {
  const state = { released: false, pulled: 0 }
  async function* gen(): AsyncGenerator<T, void, undefined> {
    try {
      for (const row of rows) {
        if (roundTrip && state.pulled > 0) await new Promise<void>((r) => setImmediate(r))
        if (failAfter !== undefined && state.pulled >= failAfter) {
          throw new Error('canceling statement due to statement timeout')
        }
        state.pulled++
        yield row
      }
      if (failAfter !== undefined && state.pulled >= failAfter) {
        throw new Error('canceling statement due to statement timeout')
      }
    } finally {
      state.released = true
    }
  }
  return { gen, state }
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'req_1',
    project_id: 'p1',
    provider: 'openai',
    model: 'gpt-4o-mini',
    prompt_tokens: '10',
    completion_tokens: '5',
    total_tokens: '15',
    cost_usd: '0.0001',
    latency_ms: '120',
    status_code: '200',
    error_message: null,
    trace_id: null,
    created_at: '2026-09-01T00:00:00.000Z',
    user_id: 'customer-a',
    session_id: 'sess-1',
    prompt_version_id: PROMPT_VERSION,
    ...overrides,
  }
}

interface StreamCall {
  select: string
  filters: string | undefined
  params: Record<string, unknown>
  limit: number
}

function lastStreamCall(): StreamCall {
  return mocks.streamRequests.mock.calls.at(-1)?.[0] as StreamCall
}

beforeEach(() => {
  mocks.selectRequests.mockReset()
  mocks.streamRequests.mockReset()
  mocks.selectRequests.mockResolvedValue([])
  mocks.streamRequests.mockImplementation(() => fakeCursor([row()]).gen())
})

describe('export filters match the list endpoint', () => {
  test('userId, sessionId, promptVersionId, truncated and status all narrow the export', async () => {
    const res = await app.request(
      '/api/v1/exports/requests?format=csv&userId=customer-a&sessionId=sess-1' +
        `&promptVersionId=${PROMPT_VERSION}&truncated=true&status=error`,
    )
    expect(res.status).toBe(200)
    await res.text()

    const call = lastStreamCall()
    expect(call.filters).toBe(
      'prompt_version_id = {promptVersionId} AND user_id = {userId} AND ' +
        'session_id = {sessionId} AND status_code >= 400 AND truncated = true',
    )
    expect(call.params).toEqual({
      promptVersionId: PROMPT_VERSION,
      userId: 'customer-a',
      sessionId: 'sess-1',
    })
  })

  test('status=success exports only successful rows (list synonym)', async () => {
    const res = await app.request('/api/v1/exports/requests?format=jsonl&status=success')
    expect(res.status).toBe(200)
    await res.text()
    expect(lastStreamCall().filters).toBe('status_code < 400')
  })

  test('format=json applies the same filters', async () => {
    const res = await app.request('/api/v1/exports/requests?format=json&userId=customer-a&status=5xx')
    expect(res.status).toBe(200)
    const call = mocks.selectRequests.mock.calls.at(-1)?.[0] as StreamCall
    expect(call.filters).toBe('user_id = {userId} AND status_code >= 500')
    expect(call.params).toEqual({ userId: 'customer-a' })
  })
})

describe('malformed input is a 400 before any query runs', () => {
  test.each([
    ['csv', 'projectId=abc'],
    ['jsonl', 'providerKeyId=abc'],
    ['csv', 'promptVersionId=not-a-uuid'],
    ['csv', 'from=garbage'],
    ['jsonl', 'to=garbage'],
    ['json', 'projectId=abc'],
    ['csv', 'status=errors'],
    ['csv', 'truncated=yes'],
  ])('format=%s with %s', async (format, query) => {
    const res = await app.request(`/api/v1/exports/requests?format=${format}&${query}`)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.message).toContain(query.split('=')[0])
    expect(mocks.streamRequests).not.toHaveBeenCalled()
    expect(mocks.selectRequests).not.toHaveBeenCalled()
  })
})

describe('export columns', () => {
  test('CSV keeps the old columns in order and appends user_id, session_id, prompt_version_id', async () => {
    const res = await app.request('/api/v1/exports/requests?format=csv')
    const text = await res.text()
    const [header, first] = text.split('\n')
    expect(header).toBe(`${LEGACY_HEADER},user_id,session_id,prompt_version_id`)
    expect(first).toBe(
      `req_1,p1,openai,gpt-4o-mini,10,5,15,0.0001,120,200,,,2026-09-01T00:00:00.000Z,customer-a,sess-1,${PROMPT_VERSION}`,
    )
    expect(lastStreamCall().select).toBe(header!.split(',').join(', '))
  })

  test('JSONL rows carry the new fields', async () => {
    const res = await app.request('/api/v1/exports/requests?format=jsonl')
    const parsed = JSON.parse((await res.text()).trim()) as Record<string, unknown>
    expect(parsed).toMatchObject({
      user_id: 'customer-a',
      session_id: 'sess-1',
      prompt_version_id: PROMPT_VERSION,
      cost_usd: 0.0001,
    })
  })
})

describe('streamed export failure handling', () => {
  test('a query that fails before the first row is a 500 error, not a 200 file', async () => {
    const cursor = fakeCursor([row()], 0)
    mocks.streamRequests.mockImplementation(() => cursor.gen())
    const res = await app.request('/api/v1/exports/requests?format=csv')
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('INTERNAL_ERROR')
    expect(cursor.state.released).toBe(true)
  })

  test('a failure after rows started errors the body instead of ending it cleanly', async () => {
    mocks.streamRequests.mockImplementation(() => fakeCursor([row(), row({ id: 'req_2' })], 1).gen())
    const res = await app.request('/api/v1/exports/requests?format=csv')
    expect(res.status).toBe(200)
    await expect(res.text()).rejects.toThrow(/statement timeout/)
  })

  test('an empty result still streams the header', async () => {
    mocks.streamRequests.mockImplementation(() => fakeCursor([]).gen())
    const res = await app.request('/api/v1/exports/requests?format=csv')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(`${LEGACY_HEADER},user_id,session_id,prompt_version_id\n`)
  })

  test('cancelling the body right away still releases the cursor the route opened', async () => {
    // The route reads the first row before answering, so by the time the
    // Response exists the cursor holds a connection. Dropping the body must
    // hand it back.
    const rows = Array.from({ length: 5_000 }, (_, i) => row({ id: `req_${i}` }))
    const cursor = fakeCursor(rows, undefined, true)
    mocks.streamRequests.mockImplementation(() => cursor.gen())
    const res = await app.request('/api/v1/exports/requests?format=jsonl')
    expect(cursor.state.released).toBe(false)
    await res.body?.cancel()
    expect(cursor.state.released).toBe(true)
    expect(cursor.state.pulled).toBeLessThan(5_000)
  })
})
