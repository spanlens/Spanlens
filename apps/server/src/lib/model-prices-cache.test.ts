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

/** DB row shape the refresh path reads. */
function dbRow(over: Record<string, unknown> = {}) {
  return {
    provider: 'openai',
    model: 'gpt-4o',
    prompt_price_per_1m: '2.5',
    completion_price_per_1m: '10',
    cache_read_price_per_1m: null,
    cache_write_price_per_1m: null,
    ...over,
  }
}

function mockSelect(data: unknown, error: unknown = null) {
  fromMock.mockReturnValue({ select: vi.fn().mockResolvedValue({ data, error }) })
}

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
  test('cache is empty before the first refresh (callers fall back)', () => {
    // The DB map can't be pre-seeded from FALLBACK_PRICES any more: those keys
    // carry no provider. Cold-start resolution lives in lookupPrice() instead.
    expect(cache.getCachedPrices()).toEqual({})
  })

  test('rows are keyed "<provider>:<model>", not by model alone', async () => {
    mockSelect([dbRow()])

    const ok = await cache.refreshPricesNow()
    expect(ok).toBe(true)

    const prices = cache.getCachedPrices()
    expect(prices['openai:gpt-4o']?.prompt).toBe(2.5)
    expect(prices['gpt-4o']).toBeUndefined()
  })

  test('same model name under two providers keeps both prices', async () => {
    // The bug this keying exists to prevent: qwen/qwen3-32b is $0.29/1M on
    // Groq and $0.08/1M on OpenRouter. Under a model-only key whichever row
    // the DB returned last silently won.
    mockSelect([
      dbRow({ provider: 'groq', model: 'qwen/qwen3-32b', prompt_price_per_1m: '0.29', completion_price_per_1m: '0.59' }),
      dbRow({ provider: 'openrouter', model: 'qwen/qwen3-32b', prompt_price_per_1m: '0.08', completion_price_per_1m: '0.28' }),
    ])

    await cache.refreshPricesNow()
    const prices = cache.getCachedPrices()

    expect(prices['groq:qwen/qwen3-32b']?.prompt).toBe(0.29)
    expect(prices['openrouter:qwen/qwen3-32b']?.prompt).toBe(0.08)
  })

  test('rows without a provider are skipped rather than keyed "undefined:"', async () => {
    mockSelect([dbRow({ provider: null })])

    await cache.refreshPricesNow()
    expect(cache.getCachedPrices()).toEqual({})
  })

  test('numeric string columns are coerced to Number (ClickHouse-style strings)', async () => {
    mockSelect([dbRow({
      prompt_price_per_1m: '0.0001',
      completion_price_per_1m: '0.0002',
      cache_read_price_per_1m: '0.00005',
    })])

    await cache.refreshPricesNow()
    const prices = cache.getCachedPrices()
    expect(typeof prices['openai:gpt-4o']?.prompt).toBe('number')
    expect(prices['openai:gpt-4o']?.prompt).toBe(0.0001)
    expect(prices['openai:gpt-4o']?.cacheRead).toBe(0.00005)
  })

  test('null cache columns are omitted from the result (not converted to 0)', async () => {
    mockSelect([dbRow({ provider: 'gemini', model: 'gemini-2.5-pro' })])

    await cache.refreshPricesNow()
    const prices = cache.getCachedPrices()
    expect(prices['gemini:gemini-2.5-pro']?.cacheRead).toBeUndefined()
    expect(prices['gemini:gemini-2.5-pro']?.cacheWrite).toBeUndefined()
  })

  test('DB error → returns false, leaves the previous snapshot intact', async () => {
    mockSelect([dbRow()])
    await cache.refreshPricesNow()

    mockSelect(null, { message: 'connection refused' })

    // Suppress the intentional console.warn from this error path so test
    // stderr stays clean. We still verify the warn was issued.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const ok = await cache.refreshPricesNow()
    expect(ok).toBe(false)
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(cache.getCachedPrices()['openai:gpt-4o']?.prompt).toBe(2.5)

    warnSpy.mockRestore()
  })

  test('empty table leaves the previous snapshot intact', async () => {
    mockSelect([dbRow()])
    await cache.refreshPricesNow()

    mockSelect([])
    await cache.refreshPricesNow()

    expect(cache.getCachedPrices()['openai:gpt-4o']?.prompt).toBe(2.5)
  })

  test('FALLBACK_PRICES contains all critical models', () => {
    const required = [
      'gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4-turbo', 'gpt-5.6-sol',
      'claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5', 'claude-opus-5',
      'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3.6-flash',
    ]
    for (const model of required) {
      expect(cache.FALLBACK_PRICES[model], `missing fallback for ${model}`).toBeDefined()
    }
  })

  test('FALLBACK_PRICES stays provider-unambiguous', () => {
    // lookupPrice() consults FALLBACK_PRICES without a provider, which is only
    // safe while it holds direct-provider models exclusively. OpenRouter ids
    // carry a vendor prefix and would collide with the direct rows.
    for (const model of Object.keys(cache.FALLBACK_PRICES)) {
      expect(model.startsWith('anthropic/'), `${model} looks like an OpenRouter id`).toBe(false)
      expect(model.startsWith('google/'), `${model} looks like an OpenRouter id`).toBe(false)
      expect(model.startsWith('mistralai/'), `${model} looks like an OpenRouter id`).toBe(false)
      expect(model.startsWith('x-ai/'), `${model} looks like an OpenRouter id`).toBe(false)
    }
  })

  test('refreshPricesNow does not block subsequent sync reads', async () => {
    // We can't easily test the "background refresh on stale cache" path
    // because VITEST env disables auto-refresh (to keep test stderr clean).
    // Instead, verify the explicit-refresh path: while refresh is in flight,
    // sync reads continue to return the existing cached snapshot.
    mockSelect([dbRow()])
    await cache.refreshPricesNow()

    let resolveSelect: (v: { data: unknown; error: unknown }) => void = () => {}
    const selectPromise = new Promise<{ data: unknown; error: unknown }>((resolve) => {
      resolveSelect = resolve
    })

    fromMock.mockReturnValue({
      select: vi.fn().mockReturnValue(selectPromise),
    })

    const refreshPromise = cache.refreshPricesNow()

    // While the DB call is pending, sync reads return the previous snapshot.
    expect(cache.getCachedPrices()['openai:gpt-4o']?.prompt).toBe(2.5)

    resolveSelect({
      data: [dbRow({ prompt_price_per_1m: '77', completion_price_per_1m: '88' })],
      error: null,
    })

    const ok = await refreshPromise
    expect(ok).toBe(true)
    expect(cache.getCachedPrices()['openai:gpt-4o']?.prompt).toBe(77)
  })
})
