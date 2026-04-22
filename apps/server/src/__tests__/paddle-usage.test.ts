import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  isWithinChargingWindow,
  UNITS_PER_QUANTITY,
} from '../lib/paddle-usage-stats.js'
import { chargeSubscription } from '../lib/paddle-charge.js'

describe('isWithinChargingWindow', () => {
  const PERIOD_END = Date.UTC(2026, 4, 1) // 2026-05-01

  it('returns true when now is 1 hour before period_end', () => {
    const now = PERIOD_END - 1 * 3600_000
    expect(isWithinChargingWindow(PERIOD_END, now)).toBe(true)
  })

  it('returns true when now is exactly at period_end', () => {
    expect(isWithinChargingWindow(PERIOD_END, PERIOD_END)).toBe(true)
  })

  it('returns true anywhere inside the default 48h window', () => {
    expect(isWithinChargingWindow(PERIOD_END, PERIOD_END - 47 * 3600_000)).toBe(true)
    expect(isWithinChargingWindow(PERIOD_END, PERIOD_END - 24 * 3600_000)).toBe(true)
  })

  it('returns false when period has already ended', () => {
    expect(isWithinChargingWindow(PERIOD_END, PERIOD_END + 1)).toBe(false)
    expect(isWithinChargingWindow(PERIOD_END, PERIOD_END + 86_400_000)).toBe(false)
  })

  it('returns false when period_end is more than window hours away', () => {
    expect(isWithinChargingWindow(PERIOD_END, PERIOD_END - 49 * 3600_000)).toBe(false)
    expect(isWithinChargingWindow(PERIOD_END, PERIOD_END - 30 * 86_400_000)).toBe(false)
  })

  it('respects a custom window size', () => {
    // 24h window: 12h before = in, 25h before = out
    expect(isWithinChargingWindow(PERIOD_END, PERIOD_END - 12 * 3600_000, 24)).toBe(true)
    expect(isWithinChargingWindow(PERIOD_END, PERIOD_END - 25 * 3600_000, 24)).toBe(false)
  })
})

describe('UNITS_PER_QUANTITY', () => {
  it('is set to 1000 (one charge unit = 1K requests)', () => {
    expect(UNITS_PER_QUANTITY).toBe(1000)
  })
})

describe('chargeSubscription — Paddle API shape', () => {
  const originalApiKey = process.env['PADDLE_API_KEY']
  const originalEnv = process.env['PADDLE_ENVIRONMENT']

  beforeEach(() => {
    process.env['PADDLE_API_KEY'] = 'pdl_test_key'
    process.env['PADDLE_ENVIRONMENT'] = 'sandbox'
  })

  afterEach(() => {
    if (originalApiKey !== undefined) process.env['PADDLE_API_KEY'] = originalApiKey
    else delete process.env['PADDLE_API_KEY']
    if (originalEnv !== undefined) process.env['PADDLE_ENVIRONMENT'] = originalEnv
    else delete process.env['PADDLE_ENVIRONMENT']
    vi.unstubAllGlobals()
  })

  it('POSTs to /subscriptions/{id}/charge with correct body shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { id: 'sub_abc', status: 'active' } }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await chargeSubscription(
      'sub_01h2345',
      [{ priceId: 'pri_overage_starter', quantity: 3 }],
      'next_billing_period',
    )

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://sandbox-api.paddle.com/subscriptions/sub_01h2345/charge')

    const req = init as RequestInit
    expect(req.method).toBe('POST')
    const headers = req.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer pdl_test_key')
    expect(headers['Content-Type']).toBe('application/json')

    const body = JSON.parse(req.body as string) as {
      effective_from: string
      items: { price_id: string; quantity: number }[]
    }
    expect(body.effective_from).toBe('next_billing_period')
    expect(body.items).toEqual([{ price_id: 'pri_overage_starter', quantity: 3 }])
  })

  it('uses production base URL when PADDLE_ENVIRONMENT=production', async () => {
    process.env['PADDLE_ENVIRONMENT'] = 'production'
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"data":{}}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await chargeSubscription('sub_1', [{ priceId: 'p', quantity: 1 }])
    const [url] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.paddle.com/subscriptions/sub_1/charge')
  })

  it('defaults effective_from to next_billing_period', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"data":{}}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await chargeSubscription('sub_1', [{ priceId: 'p', quantity: 1 }])
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as {
      effective_from: string
    }
    expect(body.effective_from).toBe('next_billing_period')
  })

  it('returns ok=false with Paddle error detail on 400', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            type: 'request_error',
            code: 'subscription_update_not_allowed_for_status',
            detail: 'Subscription is canceled',
          },
        }),
        { status: 400 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await chargeSubscription('sub_1', [{ priceId: 'p', quantity: 1 }])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.error).toContain('subscription_update_not_allowed_for_status')
      expect(result.error).toContain('Subscription is canceled')
    }
  })

  it('returns ok=false on network error without throwing', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await chargeSubscription('sub_1', [{ priceId: 'p', quantity: 1 }])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(0)
      expect(result.error).toContain('ECONNRESET')
    }
  })

  it('fails fast when PADDLE_API_KEY is missing', async () => {
    delete process.env['PADDLE_API_KEY']
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await chargeSubscription('sub_1', [{ priceId: 'p', quantity: 1 }])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('PADDLE_API_KEY')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects empty items array', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await chargeSubscription('sub_1', [])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('empty')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
