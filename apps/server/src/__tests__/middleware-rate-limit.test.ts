import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Hono } from 'hono'
import { installOnError } from './helpers/install-on-error.js'

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

// ── proxyRateLimit ────────────────────────────────────────────────────────────
//
// R-4/R-5: proxyRateLimit no longer SELECTs `organizations.plan` —
// authApiKey caches the plan onto the context as part of its lookup.
// These tests inject `plan` directly via c.set('plan', ...) to mirror
// the production wiring.

function makeProxyApp(orgId: string | null, plan: string | null = null) {
  const app = new Hono<{ Variables: { organizationId: string | null; plan: string | null } }>()
  app.use('*', async (c, next) => {
    c.set('organizationId', orgId)
    if (plan !== null) c.set('plan', plan)
    return next()
  })
  app.use('*', proxyRateLimit as unknown as Parameters<typeof app.use>[1])
  app.get('/probe', (c) => c.json({ ok: true }))
  // proxyRateLimit passes through on overage (no 429), but apiRateLimit still
  // throws ApiError — installOnError keeps the shared helper consistent.
  installOnError(app)
  return app
}

describe('proxyRateLimit', () => {
  test('no organizationId → passes through (upstream authApiKey is responsible)', async () => {
    const res = await makeProxyApp(null).request('/probe')
    expect(res.status).toBe(200)
    expect(fromMock).not.toHaveBeenCalled()
  })

  test('free plan within limit → pass with X-RateLimit headers', async () => {
    checkRateLimitMock.mockResolvedValue(true)

    const res = await makeProxyApp('org_1', 'free').request('/probe')
    expect(res.status).toBe(200)
    expect(res.headers.get('X-RateLimit-Limit')).toBe('600')
    expect(res.headers.get('X-RateLimit-Window')).toBe('60s')
    expect(res.headers.get('X-RateLimit-Reset')).not.toBeNull()
    expect(checkRateLimitMock).toHaveBeenCalledWith('proxy:org_1', 600)
    // R-5: no DB SELECT for plan anymore — authApiKey caches it
    expect(fromMock).not.toHaveBeenCalled()
  })

  test('over the ceiling → pass-through (NOT 429) with overage header + warn', async () => {
    checkRateLimitMock.mockResolvedValue(false)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const res = await makeProxyApp('org_1', 'free').request('/probe')

    // Critical: the customer's LLM request still goes through.
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Spanlens-RateLimit-Overage')).toBe('true')
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0')
    // No 429 means no Retry-After and no upgrade_url leakage.
    expect(res.headers.get('Retry-After')).toBeNull()
    // Overage is surfaced for observability via the stable warn code.
    const overageWarns = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes('PROXY_RATE_LIMIT_OVERAGE'),
    )
    expect(overageWarns).toHaveLength(1)
  })

  test('missing plan falls back to free (600 req/min)', async () => {
    // The cached lookup didn't set plan → middleware defaults to 'free'
    checkRateLimitMock.mockResolvedValue(true)

    const res = await makeProxyApp('org_1', null).request('/probe')
    expect(res.status).toBe(200)
    expect(res.headers.get('X-RateLimit-Limit')).toBe('600')
  })

  test('enterprise plan (limit=null) → unlimited, no rate-limit headers set', async () => {
    const res = await makeProxyApp('org_1', 'enterprise').request('/probe')
    expect(res.status).toBe(200)
    expect(res.headers.get('X-RateLimit-Limit')).toBeNull()
    expect(checkRateLimitMock).not.toHaveBeenCalled()
  })

  test('team plan ceiling is 15000 req/min', async () => {
    checkRateLimitMock.mockResolvedValue(true)

    await makeProxyApp('org_1', 'team').request('/probe')
    expect(checkRateLimitMock).toHaveBeenCalledWith('proxy:org_1', 15000)
  })
})

// ── apiRateLimit ──────────────────────────────────────────────────────────────

function makeApiApp() {
  const app = new Hono()
  app.use('*', apiRateLimit as unknown as Parameters<typeof app.use>[1])
  app.get('/probe', (c) => c.json({ ok: true }))
  // Sprint 8 hotfix — apiRateLimit throws ApiError now.
  installOnError(app)
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
    expect((body['error'] as { details: { limit: number } }).details.limit).toBe(120)
    expect((body['error'] as { details: Record<string, unknown> }).details['window']).toBe('60s')
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
