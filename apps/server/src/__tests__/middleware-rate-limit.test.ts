import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Hono } from 'hono'

// ─────────────────────────────────────────────────────────────────────────────
// Tests for the two rate-limit middlewares (proxyRateLimit + apiRateLimit).
// They sit on different paths, share helpers, and use different keys:
//   proxy → keyed by organizationId, plan-aware limit
//   api   → keyed by SHA-256(Bearer token), unified limit
// A regression here either DoS-protects too aggressively (legit users blocked)
// or too loosely (abuse goes through). Mock supabase + the limiter to make
// each branch deterministic.
// ─────────────────────────────────────────────────────────────────────────────

const checkRateLimitMock = vi.fn()
const fromMock = vi.fn()

vi.mock('../lib/rate-limit.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/rate-limit.js')>('../lib/rate-limit.js')
  return {
    ...actual,
    checkRateLimit: (...args: unknown[]) => checkRateLimitMock(...args),
  }
})

vi.mock('../lib/db.js', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}))

let proxyRateLimit: typeof import('../middleware/rateLimit.js').proxyRateLimit
let apiRateLimit: typeof import('../middleware/rateLimit.js').apiRateLimit

beforeEach(async () => {
  vi.resetModules()
  checkRateLimitMock.mockReset()
  fromMock.mockReset()
  ;({ proxyRateLimit, apiRateLimit } = await import('../middleware/rateLimit.js'))
})

function planLookup(plan: string | null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: plan ? { plan } : null,
      error: plan ? null : { message: 'not found' },
    }),
  }
}

// ── proxyRateLimit ────────────────────────────────────────────────────────────

function makeProxyApp(orgId: string | null) {
  const app = new Hono<{ Variables: { organizationId: string | null } }>()
  app.use('*', async (c, next) => {
    c.set('organizationId', orgId)
    return next()
  })
  app.use('*', proxyRateLimit as unknown as Parameters<typeof app.use>[1])
  app.get('/probe', (c) => c.json({ ok: true }))
  return app
}

describe('proxyRateLimit', () => {
  test('no organizationId → passes through (upstream authApiKey is responsible)', async () => {
    const res = await makeProxyApp(null).request('/probe')
    expect(res.status).toBe(200)
    expect(fromMock).not.toHaveBeenCalled()
  })

  test('free plan within limit → pass with X-RateLimit headers', async () => {
    fromMock.mockReturnValue(planLookup('free'))
    checkRateLimitMock.mockResolvedValue(true)

    const res = await makeProxyApp('org_1').request('/probe')
    expect(res.status).toBe(200)
    expect(res.headers.get('X-RateLimit-Limit')).toBe('60')
    expect(res.headers.get('X-RateLimit-Window')).toBe('60s')
    expect(checkRateLimitMock).toHaveBeenCalledWith('proxy:org_1', 60)
  })

  test('free plan over limit → 429 with structured error + Retry-After', async () => {
    fromMock.mockReturnValue(planLookup('free'))
    checkRateLimitMock.mockResolvedValue(false)

    const res = await makeProxyApp('org_1').request('/probe')
    expect(res.status).toBe(429)
    const body = await res.json() as Record<string, unknown>
    expect(body['limit']).toBe(60)
    expect(body['window']).toBe('60s')
    expect(body['upgrade_url']).toBe('https://www.spanlens.io/pricing')
    expect(res.headers.get('Retry-After')).toBe('60')
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0')
  })

  test('unknown plan falls back to free (60 req/min)', async () => {
    // The DB lookup returns null → middleware treats org as 'free'
    fromMock.mockReturnValue(planLookup(null))
    checkRateLimitMock.mockResolvedValue(true)

    const res = await makeProxyApp('org_1').request('/probe')
    expect(res.status).toBe(200)
    expect(res.headers.get('X-RateLimit-Limit')).toBe('60')
  })

  test('enterprise plan (limit=null) → unlimited, no headers set, no checkRateLimit call', async () => {
    fromMock.mockReturnValue(planLookup('enterprise'))

    const res = await makeProxyApp('org_1').request('/probe')
    expect(res.status).toBe(200)
    expect(res.headers.get('X-RateLimit-Limit')).toBeNull()
    expect(checkRateLimitMock).not.toHaveBeenCalled()
  })

  test('team plan limit is 1500 req/min', async () => {
    fromMock.mockReturnValue(planLookup('team'))
    checkRateLimitMock.mockResolvedValue(true)

    await makeProxyApp('org_1').request('/probe')
    expect(checkRateLimitMock).toHaveBeenCalledWith('proxy:org_1', 1500)
  })
})

// ── apiRateLimit ──────────────────────────────────────────────────────────────

function makeApiApp() {
  const app = new Hono()
  app.use('*', apiRateLimit as unknown as Parameters<typeof app.use>[1])
  app.get('/probe', (c) => c.json({ ok: true }))
  return app
}

describe('apiRateLimit', () => {
  test('no Authorization header → passes through (public endpoints unaffected)', async () => {
    const res = await makeApiApp().request('/probe')
    expect(res.status).toBe(200)
    expect(checkRateLimitMock).not.toHaveBeenCalled()
  })

  test('non-Bearer Authorization header → passes through', async () => {
    const res = await makeApiApp().request('/probe', {
      headers: { Authorization: 'Basic foo' },
    })
    expect(res.status).toBe(200)
    expect(checkRateLimitMock).not.toHaveBeenCalled()
  })

  test('within limit → pass with headers, keyed by hashed token', async () => {
    checkRateLimitMock.mockResolvedValue(true)
    const res = await makeApiApp().request('/probe', {
      headers: { Authorization: 'Bearer abc123' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('X-RateLimit-Limit')).toBe('120')
    // The key prefix is "api:" + SHA-256(token) — we just check the prefix
    const callArg = checkRateLimitMock.mock.calls[0]?.[0]
    expect(callArg).toMatch(/^api:[a-f0-9]{64}$/)
  })

  test('over limit → 429 with API-specific message', async () => {
    checkRateLimitMock.mockResolvedValue(false)
    const res = await makeApiApp().request('/probe', {
      headers: { Authorization: 'Bearer abc123' },
    })
    expect(res.status).toBe(429)
    const body = await res.json() as Record<string, unknown>
    expect(body['limit']).toBe(120)
    expect(body['window']).toBe('60s')
    expect(res.headers.get('Retry-After')).toBe('60')
  })

  test('different tokens produce different rate-limit keys (per-token bucket)', async () => {
    checkRateLimitMock.mockResolvedValue(true)
    await makeApiApp().request('/probe', { headers: { Authorization: 'Bearer token_a' } })
    await makeApiApp().request('/probe', { headers: { Authorization: 'Bearer token_b' } })

    const keyA = checkRateLimitMock.mock.calls[0]?.[0] as string
    const keyB = checkRateLimitMock.mock.calls[1]?.[0] as string
    expect(keyA).not.toBe(keyB)
  })
})
