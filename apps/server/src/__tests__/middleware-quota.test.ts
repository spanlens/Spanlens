import { beforeEach, describe, expect, test, vi } from 'vitest'
import { installOnError } from './helpers/install-on-error.js'
import { Hono } from 'hono'

// ─────────────────────────────────────────────────────────────────────────────
// Tests for the proxy-side quota middleware. A regression here either lets
// over-limit traffic through (revenue leak) or rejects legitimate requests
// (customer-visible outage). We mock `checkMonthlyQuota` directly so the
// middleware's branching can be exercised without hitting Supabase/ClickHouse.
// ─────────────────────────────────────────────────────────────────────────────

const checkMonthlyQuotaMock = vi.fn()
vi.mock('../lib/quota.js', () => ({
  checkMonthlyQuota: (...args: unknown[]) => checkMonthlyQuotaMock(...args),
}))

let enforceQuota: typeof import('../middleware/quota.js').enforceQuota

beforeEach(async () => {
  vi.resetModules()
  checkMonthlyQuotaMock.mockReset()
  ;({ enforceQuota } = await import('../middleware/quota.js'))
})

/** Tiny app that injects an organizationId via a fixed-value middleware and then
 * mounts the real `enforceQuota`. The probe route reflects the headers so tests
 * can assert response shape + headers in one place. */
function makeApp(orgId: string | null) {
  const app = new Hono<{ Variables: { organizationId: string | null } }>()
  app.use('*', async (c, next) => {
    c.set('organizationId', orgId)
    return next()
  })
  // Cast satisfies ApiKeyContext shape requirement
  app.use('*', enforceQuota as unknown as Parameters<typeof app.use>[1])
  app.get('/probe', (c) => c.json({ ok: true }))
  // Sprint 8 hotfix: enforceQuota now throws ApiError (was: return c.json).
  // Without the onError serialiser the thrown error surfaces as a generic
  // 500 and assertions like expect(res.status).toBe(429) fail.
  installOnError(app)
  return app
}

describe('enforceQuota — auth precondition', () => {
  test('missing organizationId → passes through (relies on upstream authApiKey to 401)', async () => {
    const res = await makeApp(null).request('/probe')
    expect(res.status).toBe(200)
    expect(checkMonthlyQuotaMock).not.toHaveBeenCalled()
  })
})

describe('enforceQuota — enterprise (unlimited)', () => {
  test('limit=null → pass through with no headers, no headers leak from policy', async () => {
    checkMonthlyQuotaMock.mockResolvedValue({
      plan: 'enterprise',
      usedThisMonth: 9_999_999,
      limit: null,
      allowOverage: true,
      capMultiplier: 5,
    })

    const res = await makeApp('org_1').request('/probe')
    expect(res.status).toBe(200)
    expect(res.headers.get('X-RateLimit-Limit')).toBeNull()
    expect(res.headers.get('X-Overage-Active')).toBeNull()
  })
})

describe('enforceQuota — Free plan (hard block at limit)', () => {
  test('under limit → pass with X-RateLimit-Remaining header', async () => {
    checkMonthlyQuotaMock.mockResolvedValue({
      plan: 'free',
      usedThisMonth: 100,
      limit: 50_000,
      allowOverage: false,
      capMultiplier: 1,
    })
    const res = await makeApp('org_1').request('/probe')
    expect(res.status).toBe(200)
    expect(res.headers.get('X-RateLimit-Plan')).toBe('free')
    expect(res.headers.get('X-RateLimit-Limit')).toBe('50000')
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('49900')
    expect(res.headers.get('X-Overage-Active')).toBeNull()
  })

  test('at limit → 429 free_limit (no overage band for Free)', async () => {
    checkMonthlyQuotaMock.mockResolvedValue({
      plan: 'free',
      usedThisMonth: 50_000,
      limit: 50_000,
      allowOverage: false,
      capMultiplier: 1,
    })
    const res = await makeApp('org_1').request('/probe')
    expect(res.status).toBe(429)
    const body = await res.json() as Record<string, unknown>
    expect((body['error'] as { details: { reason: string } }).details.reason).toBe('free_limit')
    expect((body['error'] as { details: Record<string, unknown> }).details['plan']).toBe('free')
    expect((body['error'] as { details: Record<string, unknown> }).details['used']).toBe(50_000)
    expect((body['error'] as { details: { limit: number } }).details.limit).toBe(50_000)
    expect((body['error'] as { details: Record<string, unknown> }).details['hard_cap']).toBe(50_000) // limit × capMultiplier(1)
    expect((body['error'] as { details: Record<string, unknown> }).details['upgrade_url']).toBe('https://www.spanlens.io/billing')
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0')
  })
})

describe('enforceQuota — Paid plan with overage disabled', () => {
  test('over limit → 429 overage_disabled (paid plans block when overage off)', async () => {
    checkMonthlyQuotaMock.mockResolvedValue({
      plan: 'pro',
      usedThisMonth: 100_001,
      limit: 100_000,
      allowOverage: false,
      capMultiplier: 5,
    })
    const res = await makeApp('org_1').request('/probe')
    expect(res.status).toBe(429)
    const body = await res.json() as Record<string, unknown>
    expect((body['error'] as { details: { reason: string } }).details.reason).toBe('overage_disabled')
    expect((body['error'] as { details: Record<string, unknown> }).details['plan']).toBe('pro')
  })
})

describe('enforceQuota — Paid plan with overage allowed', () => {
  test('over limit but under hard cap → pass with X-Overage-Active', async () => {
    checkMonthlyQuotaMock.mockResolvedValue({
      plan: 'pro',
      usedThisMonth: 150_000, // 1.5× the 100k limit, cap is 5× = 500k
      limit: 100_000,
      allowOverage: true,
      capMultiplier: 5,
    })
    const res = await makeApp('org_1').request('/probe')
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Overage-Active')).toBe('true')
    // Remaining can be negative inside the overage band
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('-50000')
  })

  test('at hard cap → 429 hard_cap (safety ceiling)', async () => {
    checkMonthlyQuotaMock.mockResolvedValue({
      plan: 'pro',
      usedThisMonth: 500_000, // exactly the 5× cap
      limit: 100_000,
      allowOverage: true,
      capMultiplier: 5,
    })
    const res = await makeApp('org_1').request('/probe')
    expect(res.status).toBe(429)
    const body = await res.json() as Record<string, unknown>
    expect((body['error'] as { details: { reason: string } }).details.reason).toBe('hard_cap')
    expect((body['error'] as { details: Record<string, unknown> }).details['hard_cap']).toBe(500_000)
  })
})

describe('enforceQuota — response shape', () => {
  test('passing request does not set X-Overage-Active when overage inactive', async () => {
    checkMonthlyQuotaMock.mockResolvedValue({
      plan: 'pro',
      usedThisMonth: 1_000,
      limit: 100_000,
      allowOverage: true,
      capMultiplier: 5,
    })
    const res = await makeApp('org_1').request('/probe')
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Overage-Active')).toBeNull()
  })
})
