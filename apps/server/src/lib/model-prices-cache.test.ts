import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// We mock `./db.js` BEFORE importing the module under test so that
// `supabaseAdmin.from()` returns a programmable stub.
const fromMock = vi.fn()
vi.mock('./db.js', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}))

// Dynamic import so the mock is in place first.
let cache: typeof import('./model-prices-cache.js')

beforeEach(async () => {
  vi.resetModules()
  fromMock.mockReset()
  cache = await import('./model-prices-cache.js')
  cache._resetCacheForTests()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('model-prices-cache', () => {
  test('cold start returns fallback prices synchronously', () => {
    const prices = cache.getCachedPrices()
    expect(prices['gpt-4o']).toBeDefined()
    expect(prices['gpt-4o']?.prompt).toBe(2.5)
    expect(prices['claude-sonnet-4-6']?.cacheRead).toBe(0.3)
  })

  test('refreshPricesNow loads from DB and overrides fallback', async () => {
    fromMock.mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [
          {
            model: 'gpt-4o',
            prompt_price_per_1m: '99.99',
            completion_price_per_1m: '100.00',
            cache_read_price_per_1m: null,
            cache_write_price_per_1m: null,
          },
        ],
        error: null,
      }),
    })

    const ok = await cache.refreshPricesNow()
    expect(ok).toBe(true)

    const prices = cache.getCachedPrices()
    expect(prices['gpt-4o']?.prompt).toBe(99.99)
    expect(prices['gpt-4o']?.completion).toBe(100)
    // Other models still come from fallback
    expect(prices['gpt-4o-mini']?.prompt).toBe(0.15)
  })

  test('numeric string columns are coerced to Number (ClickHouse-style strings)', async () => {
    fromMock.mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [
          {
            model: 'gpt-4o',
            prompt_price_per_1m: '0.0001',
            completion_price_per_1m: '0.0002',
            cache_read_price_per_1m: '0.00005',
            cache_write_price_per_1m: null,
          },
        ],
        error: null,
      }),
    })

    await cache.refreshPricesNow()
    const prices = cache.getCachedPrices()
    expect(typeof prices['gpt-4o']?.prompt).toBe('number')
    expect(prices['gpt-4o']?.prompt).toBe(0.0001)
    expect(prices['gpt-4o']?.cacheRead).toBe(0.00005)
  })

  test('null cache columns are omitted from the result (not converted to 0)', async () => {
    fromMock.mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [
          {
            model: 'gemini-2.5-pro',
            prompt_price_per_1m: '1.25',
            completion_price_per_1m: '10',
            cache_read_price_per_1m: null,
            cache_write_price_per_1m: null,
          },
        ],
        error: null,
      }),
    })

    await cache.refreshPricesNow()
    const prices = cache.getCachedPrices()
    expect(prices['gemini-2.5-pro']?.cacheRead).toBeUndefined()
    expect(prices['gemini-2.5-pro']?.cacheWrite).toBeUndefined()
  })

  test('DB error → returns false, falls back to existing cache', async () => {
    fromMock.mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'connection refused' },
      }),
    })

    // Suppress the intentional console.warn from this error path so test
    // stderr stays clean. We still verify the warn was issued.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const ok = await cache.refreshPricesNow()
    expect(ok).toBe(false)
    expect(warnSpy).toHaveBeenCalledOnce()
    // Fallback prices still available
    expect(cache.getCachedPrices()['gpt-4o']?.prompt).toBe(2.5)

    warnSpy.mockRestore()
  })

  test('empty table preserves fallback prices', async () => {
    fromMock.mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [], error: null }),
    })

    await cache.refreshPricesNow()
    expect(cache.getCachedPrices()['gpt-4o']?.prompt).toBe(2.5)
  })

  test('FALLBACK_PRICES contains all critical models', () => {
    const required = [
      'gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4-turbo',
      'claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5',
      'gemini-2.5-pro', 'gemini-2.5-flash',
    ]
    for (const model of required) {
      expect(cache.FALLBACK_PRICES[model], `missing fallback for ${model}`).toBeDefined()
    }
  })

  test('refreshPricesNow does not block subsequent sync reads', async () => {
    // We can't easily test the "background refresh on stale cache" path
    // because VITEST env disables auto-refresh (to keep test stderr clean).
    // Instead, verify the explicit-refresh path: while refresh is in flight,
    // sync reads continue to return the existing cached snapshot.
    let resolveSelect: (v: { data: unknown; error: unknown }) => void = () => {}
    const selectPromise = new Promise<{ data: unknown; error: unknown }>((resolve) => {
      resolveSelect = resolve
    })

    fromMock.mockReturnValue({
      select: vi.fn().mockReturnValue(selectPromise),
    })

    const refreshPromise = cache.refreshPricesNow()

    // While the DB call is pending, sync reads return the existing (fallback) snapshot
    expect(cache.getCachedPrices()['gpt-4o']?.prompt).toBe(2.5)

    resolveSelect({
      data: [{
        model: 'gpt-4o',
        prompt_price_per_1m: '77',
        completion_price_per_1m: '88',
        cache_read_price_per_1m: null,
        cache_write_price_per_1m: null,
      }],
      error: null,
    })

    const ok = await refreshPromise
    expect(ok).toBe(true)
    expect(cache.getCachedPrices()['gpt-4o']?.prompt).toBe(77)
  })
})
