import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// Mock `./db.js` BEFORE importing the module under test so `supabaseAdmin.from()`
// returns a programmable stub. Mirror of model-prices-cache.test.ts.
const fromMock = vi.fn()
vi.mock('./db.js', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}))

let cache: typeof import('./model-recommendations-cache.js')
let rulesMod: typeof import('./model-recommend-rules.js')

beforeEach(async () => {
  vi.resetModules()
  fromMock.mockReset()
  cache = await import('./model-recommendations-cache.js')
  rulesMod = await import('./model-recommend-rules.js')
  cache._resetCacheForTests()
})

afterEach(() => vi.useRealTimers())

describe('model-recommendations-cache', () => {
  test('cold start returns FALLBACK_RULES synchronously', () => {
    const rules = cache.getCachedRules()
    expect(rules['openai:gpt-4o']).toBeDefined()
    expect(rules['openai:gpt-4o']?.suggestedModel).toBe('gpt-4o-mini')
    expect(rules['anthropic:claude-opus-4-7']?.suggestedModel).toBe('claude-haiku-4.5')
  })

  test('refreshRulesNow loads from DB and overrides fallback', async () => {
    fromMock.mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [
          {
            current_provider: 'openai',
            current_model: 'gpt-4o',
            suggested_provider: 'openai',
            suggested_model: 'gpt-4.1-nano',
            cost_ratio: '0.01',
            max_avg_prompt_tokens: 100,
            max_avg_completion_tokens: 50,
            reason: 'admin-tuned',
          },
        ],
        error: null,
      }),
    })

    const ok = await cache.refreshRulesNow()
    expect(ok).toBe(true)

    const rules = cache.getCachedRules()
    expect(rules['openai:gpt-4o']?.suggestedModel).toBe('gpt-4.1-nano')
    expect(rules['openai:gpt-4o']?.costRatio).toBe(0.01)
    expect(rules['openai:gpt-4o']?.reason).toBe('admin-tuned')
    // Other rules still come from fallback (e.g. anthropic family)
    expect(rules['anthropic:claude-opus-4-7']?.suggestedModel).toBe('claude-haiku-4.5')
  })

  test('numeric string columns are coerced to Number (Postgres decimal)', async () => {
    fromMock.mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [
          {
            current_provider: 'openai',
            current_model: 'gpt-4o',
            suggested_provider: 'openai',
            suggested_model: 'gpt-4o-mini',
            cost_ratio: '0.123456',
            max_avg_prompt_tokens: 500,
            max_avg_completion_tokens: 150,
            reason: 'numeric coercion check',
          },
        ],
        error: null,
      }),
    })
    await cache.refreshRulesNow()
    const rule = cache.getCachedRules()['openai:gpt-4o']
    expect(rule).toBeDefined()
    expect(typeof rule?.costRatio).toBe('number')
    expect(rule?.costRatio).toBe(0.123456)
  })

  test('DB error → returns false, falls back to existing cache', async () => {
    fromMock.mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'connection refused' },
      }),
    })

    // Suppress the intentional console.warn from the error path
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const ok = await cache.refreshRulesNow()
    expect(ok).toBe(false)
    expect(warnSpy).toHaveBeenCalledOnce()

    // Fallback rules still available
    expect(cache.getCachedRules()['openai:gpt-4o']).toBeDefined()
    warnSpy.mockRestore()
  })

  test('empty table preserves fallback rules', async () => {
    fromMock.mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [], error: null }),
    })

    await cache.refreshRulesNow()
    expect(cache.getCachedRules()['openai:gpt-4o']).toBeDefined()
  })

  test('FALLBACK_RULES contains all the canonical models in seed', () => {
    const required = [
      'openai:gpt-4o', 'openai:gpt-4.1', 'openai:gpt-4-turbo', 'openai:gpt-4',
      'anthropic:claude-opus-4-7', 'anthropic:claude-3-opus-20240229',
      'anthropic:claude-sonnet-4-6', 'anthropic:claude-sonnet-4-5',
      'anthropic:claude-3-5-sonnet-20241022',
      'gemini:gemini-2.5-pro', 'gemini:gemini-1.5-pro', 'gemini:gemini-2.0-pro',
    ]
    for (const key of required) {
      expect(cache.FALLBACK_RULES[key], `missing fallback for ${key}`).toBeDefined()
    }
  })
})

// ── matchSubstitute regression — DB rules MUST produce identical matches to
//    FALLBACK_RULES on the inputs covered by existing model-recommend tests. ──
describe('matchSubstitute regression vs FALLBACK_RULES', () => {
  test('exact match returns the same substitute as the legacy hardcoded path', () => {
    const fromFallback = rulesMod.matchSubstituteIn('openai:gpt-4o', rulesMod.SUBSTITUTES)
    const fromCache = cache.matchSubstitute('openai:gpt-4o')
    expect(fromCache).toEqual(fromFallback)
  })

  test('dated suffix prefix-matches like before', () => {
    const fromFallback = rulesMod.matchSubstituteIn('openai:gpt-4o-mini-2024-07-18', rulesMod.SUBSTITUTES)
    const fromCache = cache.matchSubstitute('openai:gpt-4o-mini-2024-07-18')
    // Note: gpt-4o-mini is the SUGGESTED side, not the current side, so no
    // substitute rule exists for it — both paths should agree on "null".
    expect(fromCache).toBe(fromFallback)
  })

  test('boundary-aware prefix: openai:gpt-4 does not match gpt-4o', () => {
    // Sanity that we did NOT regress the gpt-4 vs gpt-4o boundary trick.
    const fromCache = cache.matchSubstitute('openai:gpt-4o')
    expect(fromCache?.suggestedModel).toBe('gpt-4o-mini') // matches gpt-4o exact
  })

  test('unknown key returns null', () => {
    expect(cache.matchSubstitute('openai:no-such-model')).toBeNull()
  })
})
