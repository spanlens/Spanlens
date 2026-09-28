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

  test('numeric columns arriving as strings are coerced to Number', async () => {
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
      'gpt-6-astra', 'gpt-6-sol', 'claude-opus-5-5', 'claude-fable-5-1',
    ]
    for (const model of required) {
      expect(cache.FALLBACK_PRICES[model], `missing fallback for ${model}`).toBeDefined()
    }
  })

  test('GPT-5.6 fallback rates match the published table on BOTH tiers', () => {
    // This family has now moved twice, and never all at once. In 2026-08
    // OpenAI cut terra and luna and left sol; in 2026-09 it cut sol (5 -> 4
    // input, 30 -> 20 output, long 10/45 -> 8/30) and left the other two. A
    // spot check of "the flagship" passes in one direction and fails in the
    // other, so pin every member on both tiers.
    // Source: developers.openai.com/api/docs/pricing (verified 2026-09-28).
    const expected = {
      'gpt-5.6-sol':   { prompt: 4.0,  completion: 20,   cacheRead: 0.4,  cacheWrite: 5.0,
                         longPrompt: 8,   longCompletion: 30,  longCacheRead: 0.8,  longCacheWrite: 10 },
      'gpt-5.6-terra': { prompt: 2.0,  completion: 12,   cacheRead: 0.2,  cacheWrite: 2.5,
                         longPrompt: 4,   longCompletion: 18,  longCacheRead: 0.4,  longCacheWrite: 5.0 },
      'gpt-5.6-luna':  { prompt: 0.2,  completion: 1.2,  cacheRead: 0.02, cacheWrite: 0.25,
                         longPrompt: 0.4, longCompletion: 1.8, longCacheRead: 0.04, longCacheWrite: 0.5 },
    } as const

    for (const [model, rates] of Object.entries(expected)) {
      const actual = cache.FALLBACK_PRICES[model]
      expect(actual, `missing fallback for ${model}`).toBeDefined()
      expect({ ...actual, longThreshold: undefined }, model).toEqual({ ...rates, longThreshold: undefined })
      expect(actual?.longThreshold, `${model} long-context threshold`).toBe(272000)
    }

    // Cyber publishes no long-context tier — pin that absence too, so adding
    // one silently (or copying sol's by mistake) fails.
    const cyber = cache.FALLBACK_PRICES['gpt-5.6-cyber']
    expect(cyber).toEqual({ prompt: 12.5, completion: 75, cacheRead: 1.25, cacheWrite: 15.625 })
    expect(cyber?.longThreshold).toBeUndefined()
  })

  test('Gemini flash fallback holds the introductory rates, not the 2027 ones', () => {
    // Google publishes two prices per axis for these models: 0.75/3.75/0.075
    // through 2026-12-31, then 1.50/7.50/0.15 from 2027-01-01. The 2026-08-11
    // seed took the 2027 column, so every 3.6-flash request was over-reported
    // by exactly 2x on all three axes until 2026-08-21. Pin both sides of the
    // boundary: flipping early over-reports by 2x, flipping late under-reports
    // by 50%. Source: ai.google.dev/gemini-api/docs/pricing?hl=en (2026-08-21).
    const introductory = { prompt: 0.75, completion: 3.75, cacheRead: 0.075 }

    for (const model of ['gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash']) {
      const actual = cache.FALLBACK_PRICES[model]
      expect(actual, `missing fallback for ${model}`).toBeDefined()
      expect(actual, model).toEqual(introductory)
      // The >200k split is a Pro-family thing. Flash has none, and inheriting
      // one from a neighbouring row would silently double long requests.
      expect(actual?.longThreshold, `${model} must have no long-context tier`).toBeUndefined()
    }

    // Robotics ER 2 is on the same introductory window (1.00 / 5.00 / 0.10
    // through 2026-12-31, then 2.00 / 10.00 / 0.20). Both rows actually shipped
    // with the 2027 column in 2026-08 and over-reported by 2x for six weeks,
    // so pin them here rather than trusting the flash rows to stand in.
    expect(cache.FALLBACK_PRICES['gemini-robotics-er-2-preview'])
      .toEqual({ prompt: 1.0, completion: 5, cacheRead: 0.1 })
    expect(cache.FALLBACK_PRICES['gemini-robotics-er-2-streaming-preview'])
      .toEqual({ prompt: 1.0, completion: 5 })
  })

  test('grok-4.6 doubles every axis at 200k and does not inherit 4.5 cache rate', () => {
    // xAI re-rates the WHOLE request at 2x once the prompt reaches 200k, so the
    // long tier is just the short tier doubled — including cache. grok-4.6 and
    // grok-4.5 share input/output but NOT the cache rate (0.50 vs 0.30), so
    // copying the 4.5 row would misprice every 4.6 cache hit by 67%.
    // Source: docs.x.ai/docs/models (verified 2026-08-21).
    const grok46 = cache.FALLBACK_PRICES['grok-4.6']
    expect(grok46, 'missing fallback for grok-4.6').toBeDefined()
    expect(grok46).toEqual({
      prompt: 2.0, completion: 6.0, cacheRead: 0.5,
      longThreshold: 200000, longPrompt: 4.0, longCompletion: 12.0, longCacheRead: 1.0,
    })

    for (const axis of ['prompt', 'completion', 'cacheRead'] as const) {
      const long = ({ prompt: 'longPrompt', completion: 'longCompletion', cacheRead: 'longCacheRead' } as const)[axis]
      expect(grok46?.[long], `grok-4.6 ${long} must be 2x ${axis}`).toBe((grok46?.[axis] ?? 0) * 2)
    }

    expect(cache.FALLBACK_PRICES['grok-4.5']?.cacheRead, 'grok-4.5 cache rate is distinct').toBe(0.3)
  })

  test('Anthropic cache reads are read, not derived as 0.1x input', () => {
    // Cache read was 0.1x base input for every Claude model until the 5.1
    // generation. It is not any more: Fable 5.1 and Mythos 5.1 read at 0.025x
    // and Opus 5.5 at 0.05x. A helper that "knows" the 0.1x rule would
    // over-charge their cache hits by 4x and 2x. Pin the real multipliers.
    // Source: platform.claude.com pricing (verified 2026-09-28).
    const expected = {
      'claude-fable-5-1':  { prompt: 10, cacheRead: 0.25, multiplier: 0.025 },
      'claude-mythos-5-1': { prompt: 10, cacheRead: 0.25, multiplier: 0.025 },
      'claude-opus-5-5':   { prompt: 4,  cacheRead: 0.2,  multiplier: 0.05 },
      // The 0.1x models, pinned alongside so a blanket "fix" to either rule fails.
      'claude-fable-5':    { prompt: 10, cacheRead: 1.0,  multiplier: 0.1 },
      'claude-opus-5':     { prompt: 5,  cacheRead: 0.5,  multiplier: 0.1 },
      'claude-sonnet-5':   { prompt: 2,  cacheRead: 0.2,  multiplier: 0.1 },
    } as const

    for (const [model, e] of Object.entries(expected)) {
      const actual = cache.FALLBACK_PRICES[model]
      expect(actual, `missing fallback for ${model}`).toBeDefined()
      expect(actual?.prompt, `${model} input`).toBe(e.prompt)
      expect(actual?.cacheRead, `${model} cache read`).toBeCloseTo(e.cacheRead, 10)
      expect(actual?.cacheRead, `${model} cache multiplier`).toBeCloseTo(e.prompt * e.multiplier, 10)
    }
  })

  test('GPT-6 fallback holds the 272k tier shape: 2x input, 1.5x output', () => {
    // The long tier is NOT a flat doubling, which is the easy thing to assume
    // and wrong: input, cached input and cache write all double, but output
    // goes up 1.5x (astra 50 -> 75, sol 10 -> 15, luna 0.50 -> 0.75). Same
    // shape as the whole GPT-5.6 family. Doubling output instead would
    // over-report every >272k request by 33%.
    // Source: developers.openai.com/api/docs/pricing (verified 2026-09-28).
    const expected = {
      'gpt-6-astra': { prompt: 10,  completion: 50,  cacheRead: 1.0,  cacheWrite: 12.5 },
      'gpt-6-sol':   { prompt: 2.0, completion: 10,  cacheRead: 0.2,  cacheWrite: 2.5 },
      'gpt-6-luna':  { prompt: 0.1, completion: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
      // Cut in 2026-09 from 5 / 30 / 0.5 / 6.25; its long tier followed down.
      'gpt-5.6-sol': { prompt: 4.0, completion: 20,  cacheRead: 0.4,  cacheWrite: 5.0 },
    } as const

    for (const [model, short] of Object.entries(expected)) {
      const actual = cache.FALLBACK_PRICES[model]
      expect(actual, `missing fallback for ${model}`).toBeDefined()
      expect(actual?.longThreshold, `${model} threshold`).toBe(272000)
      expect(actual?.prompt, `${model} input`).toBe(short.prompt)
      expect(actual?.completion, `${model} output`).toBe(short.completion)
      expect(actual?.cacheRead, `${model} cache read`).toBe(short.cacheRead)
      expect(actual?.cacheWrite, `${model} cache write`).toBe(short.cacheWrite)
    }

    // The 2x / 1.5x split holds across GPT-6 and GPT-5.6 alike.
    for (const model of ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna',
                         'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
      const p = cache.FALLBACK_PRICES[model]
      expect(p?.longPrompt, `${model} long input is 2x`).toBeCloseTo((p?.prompt ?? 0) * 2, 10)
      expect(p?.longCacheRead, `${model} long cache read is 2x`).toBeCloseTo((p?.cacheRead ?? 0) * 2, 10)
      expect(p?.longCacheWrite, `${model} long cache write is 2x`).toBeCloseTo((p?.cacheWrite ?? 0) * 2, 10)
      expect(p?.longCompletion, `${model} long output is 1.5x`).toBeCloseTo((p?.completion ?? 0) * 1.5, 10)
    }
  })

  test('Daybreak aliases mirror the rows they point at', () => {
    // These are moving pointers: OpenAI repoints them at each new flagship, and
    // only the twice-monthly price audit can catch that. What this test CAN
    // catch is the internal failure — someone updating gpt-5.6-sol or
    // gpt-5.6-cyber and leaving the alias on the old numbers.
    // Targets as of 2026-09-28: blue -> gpt-5.6-sol, red -> gpt-5.6-cyber.
    expect(cache.FALLBACK_PRICES['gpt-daybreak-blue-latest'])
      .toEqual(cache.FALLBACK_PRICES['gpt-5.6-sol'])
    expect(cache.FALLBACK_PRICES['gpt-daybreak-red-latest'])
      .toEqual(cache.FALLBACK_PRICES['gpt-5.6-cyber'])
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
