import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Hono } from 'hono'
import { installOnError } from './helpers/install-on-error.js'

// Customer-configurable rate limit enforcement (Phase 2). Mock the cached
// config lookup and the Upstash limiter so each branch is deterministic.
const getCustomerLimitsMock = vi.hoisted(() => vi.fn())
const checkRateLimitMock = vi.hoisted(() => vi.fn())

vi.mock('../lib/customer-limits.js', () => ({
  getCustomerLimits: (...args: unknown[]) => getCustomerLimitsMock(...args),
}))
vi.mock('../lib/rate-limit.js', () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimitMock(...args),
}))

import { customerRateLimit } from '../middleware/customerRateLimit.js'

const EMPTY = { keyLimit: null, projectLimit: null, endUserLimits: new Map(), empty: true }
const limit = (scope: string, maxRequests: number, windowSeconds = 60) => ({ scope, maxRequests, windowSeconds })

function makeApp(opts: { apiKeyId?: string | null; projectId?: string | null } = {}) {
  const app = new Hono<{
    Variables: { apiKeyId: string | null; projectId: string | null; organizationId: string | null }
  }>()
  app.use('*', async (c, next) => {
    c.set('apiKeyId', opts.apiKeyId === undefined ? 'key_1' : opts.apiKeyId)
    c.set('projectId', opts.projectId === undefined ? 'proj_1' : opts.projectId)
    c.set('organizationId', 'org_1')
    return next()
  })
  app.use('*', customerRateLimit as unknown as Parameters<typeof app.use>[1])
  app.get('/probe', (c) => c.json({ ok: true }))
  installOnError(app)
  return app
}

const probe = (app: ReturnType<typeof makeApp>, headers: Record<string, string> = {}) =>
  app.request('/probe', { headers })

beforeEach(() => {
  getCustomerLimitsMock.mockReset()
  checkRateLimitMock.mockReset()
})

describe('customerRateLimit', () => {
  test('no configured limits → pass-through, no Redis call', async () => {
    getCustomerLimitsMock.mockResolvedValue(EMPTY)
    const res = await probe(makeApp())
    expect(res.status).toBe(200)
    expect(checkRateLimitMock).not.toHaveBeenCalled()
  })

  test('api_key limit under cap → pass with the right Redis key + window', async () => {
    getCustomerLimitsMock.mockResolvedValue({
      keyLimit: limit('api_key', 100, 3600), projectLimit: null, endUserLimits: new Map(), empty: false,
    })
    checkRateLimitMock.mockResolvedValue(true)

    const res = await probe(makeApp())
    expect(res.status).toBe(200)
    expect(checkRateLimitMock).toHaveBeenCalledWith('custlimit:key:key_1', 100, 3600)
  })

  test('api_key limit over cap → 429 customer_limit, no upgrade_url', async () => {
    getCustomerLimitsMock.mockResolvedValue({
      keyLimit: limit('api_key', 5, 60), projectLimit: null, endUserLimits: new Map(), empty: false,
    })
    checkRateLimitMock.mockResolvedValue(false)

    const res = await probe(makeApp())
    expect(res.status).toBe(429)
    const body = await res.json() as { error: { code: string; details: Record<string, unknown> } }
    expect(body.error.code).toBe('RATE_LIMIT')
    expect(body.error.details['source']).toBe('customer_limit')
    expect(body.error.details['scope']).toBe('api_key')
    expect(body.error.details['limit']).toBe(5)
    expect(body.error.details['window_seconds']).toBe(60)
    expect(body.error.details['upgrade_url']).toBeUndefined()
    expect(res.headers.get('Retry-After')).toBe('60')
    expect(res.headers.get('X-Spanlens-RateLimit-Scope')).toBe('api_key')
  })

  test('end-user limits bucket per x-spanlens-user', async () => {
    getCustomerLimitsMock.mockResolvedValue({
      keyLimit: null, projectLimit: null,
      endUserLimits: new Map([['u1', limit('end_user', 10)], ['u2', limit('end_user', 10)]]),
      empty: false,
    })
    checkRateLimitMock.mockResolvedValue(true)

    await probe(makeApp(), { 'x-spanlens-user': 'u1' })
    await probe(makeApp(), { 'x-spanlens-user': 'u2' })

    expect(checkRateLimitMock).toHaveBeenNthCalledWith(1, 'custlimit:eu:key_1:u1', 10, 60)
    expect(checkRateLimitMock).toHaveBeenNthCalledWith(2, 'custlimit:eu:key_1:u2', 10, 60)
  })

  test('end-user over cap → 429 with end_user_id in details', async () => {
    getCustomerLimitsMock.mockResolvedValue({
      keyLimit: null, projectLimit: null,
      endUserLimits: new Map([['alice', limit('end_user', 2)]]), empty: false,
    })
    checkRateLimitMock.mockResolvedValue(false)

    const res = await probe(makeApp(), { 'x-spanlens-user': 'alice' })
    expect(res.status).toBe(429)
    const body = await res.json() as { error: { details: Record<string, unknown> } }
    expect(body.error.details['scope']).toBe('end_user')
    expect(body.error.details['end_user_id']).toBe('alice')
  })

  test('a request with no x-spanlens-user skips end-user limits', async () => {
    getCustomerLimitsMock.mockResolvedValue({
      keyLimit: null, projectLimit: null,
      endUserLimits: new Map([['u1', limit('end_user', 1)]]), empty: false,
    })
    checkRateLimitMock.mockResolvedValue(false)

    const res = await probe(makeApp()) // no header
    expect(res.status).toBe(200) // nothing applicable to check
    expect(checkRateLimitMock).not.toHaveBeenCalled()
  })

  test('project limit over cap → 429 scope project', async () => {
    getCustomerLimitsMock.mockResolvedValue({
      keyLimit: null, projectLimit: limit('project', 50, 86400), endUserLimits: new Map(), empty: false,
    })
    checkRateLimitMock.mockResolvedValue(false)

    const res = await probe(makeApp())
    expect(res.status).toBe(429)
    expect(checkRateLimitMock).toHaveBeenCalledWith('custlimit:proj:proj_1', 50, 86400)
    const body = await res.json() as { error: { details: Record<string, unknown> } }
    expect(body.error.details['scope']).toBe('project')
  })

  test('most-specific first: end-user deny wins, key not checked', async () => {
    getCustomerLimitsMock.mockResolvedValue({
      keyLimit: limit('api_key', 1000), projectLimit: null,
      endUserLimits: new Map([['u1', limit('end_user', 1)]]), empty: false,
    })
    checkRateLimitMock.mockResolvedValueOnce(false) // end-user check denies

    const res = await probe(makeApp(), { 'x-spanlens-user': 'u1' })
    expect(res.status).toBe(429)
    const body = await res.json() as { error: { details: Record<string, unknown> } }
    expect(body.error.details['scope']).toBe('end_user')
    expect(checkRateLimitMock).toHaveBeenCalledTimes(1) // key limit never reached
  })

  test('fails open: Redis allows (true) even with a limit configured', async () => {
    getCustomerLimitsMock.mockResolvedValue({
      keyLimit: limit('api_key', 1), projectLimit: null, endUserLimits: new Map(), empty: false,
    })
    checkRateLimitMock.mockResolvedValue(true) // checkRateLimit fails open on Redis outage

    const res = await probe(makeApp())
    expect(res.status).toBe(200)
  })
})
