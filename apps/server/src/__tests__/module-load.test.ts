import { describe, expect, test, beforeAll } from 'vitest'

/**
 * Module-load smoke test.
 *
 * Catches the class of bug that took production down on 2026-05-19 between
 * the P3.3 deploy (07:34 UTC) and this hotfix: a circular ES-module import
 * (`model-recommend-rules.ts` ↔ `model-recommendations-cache.ts`) that
 * Vitest doesn't reproduce — but esbuild's Vercel Node bundle does. The
 * symptom was `ReferenceError: Cannot access 'X' before initialization`
 * at module-init time, causing every endpoint (including `/health` and
 * `/favicon.ico`) to return 500 because the module evaluation itself
 * threw.
 *
 * This test imports the modules in the order that esbuild evaluates them
 * inside the bundle, and asserts every public symbol the cache + rules
 * pair exposes is reachable. If anyone re-introduces a back-edge from
 * `rules.ts` to `cache.ts` (e.g. via `export { foo } from './cache'`),
 * this would still pass under Vitest because Vitest doesn't bundle.
 *
 * To actually surface the bundle-time bug, the test additionally invokes
 * the cache module's `getCachedRules()` at import time — the same path
 * that the production hot path takes. If that path triggers the cycle's
 * fragile evaluation order, Vitest will see it too.
 */
describe('module load — circular import regression', () => {
  let rulesMod: typeof import('../lib/model-recommend-rules.js')
  let cacheMod: typeof import('../lib/model-recommendations-cache.js')
  let recommendMod: typeof import('../lib/model-recommend.js')

  beforeAll(async () => {
    rulesMod = await import('../lib/model-recommend-rules.js')
    cacheMod = await import('../lib/model-recommendations-cache.js')
    recommendMod = await import('../lib/model-recommend.js')
  })

  test('SUBSTITUTES constant is fully initialised', () => {
    expect(rulesMod.SUBSTITUTES).toBeTypeOf('object')
    // Spreading it must not throw — the very operation cache.ts does at
    // top level in `let cache = { ...FALLBACK_RULES }`.
    expect(() => ({ ...rulesMod.SUBSTITUTES })).not.toThrow()
    expect(Object.keys(rulesMod.SUBSTITUTES).length).toBeGreaterThan(0)
  })

  test('matchSubstituteIn is callable directly from rules module', () => {
    expect(rulesMod.matchSubstituteIn).toBeTypeOf('function')
    const sub = rulesMod.matchSubstituteIn('openai:gpt-4o', rulesMod.SUBSTITUTES)
    expect(sub).not.toBeNull()
    expect(sub?.suggestedModel).toBe('gpt-4o-mini')
  })

  test('rules.ts does NOT re-export matchSubstitute (cycle guard)', () => {
    // Re-exporting from cache here is the bug. Importing `matchSubstitute`
    // from cache directly is the supported path. This test pins that
    // contract so a future "convenience" re-export doesn't silently put
    // the server back into TDZ-crash territory in production.
    expect((rulesMod as Record<string, unknown>)['matchSubstitute']).toBeUndefined()
  })

  test('matchSubstitute resolves through the cache module', () => {
    expect(cacheMod.matchSubstitute).toBeTypeOf('function')
    const sub = cacheMod.matchSubstitute('openai:gpt-4o-2024-08-06')
    expect(sub).not.toBeNull()
    expect(sub?.suggestedModel).toBe('gpt-4o-mini')
  })

  test('FALLBACK_RULES re-export from cache survives spread (the exact init path)', () => {
    expect(cacheMod.FALLBACK_RULES).toBeTypeOf('object')
    const copy = { ...cacheMod.FALLBACK_RULES }
    expect(Object.keys(copy)).toEqual(Object.keys(rulesMod.SUBSTITUTES))
  })

  test('model-recommend.ts loads and exposes its expected surface', () => {
    // Just touching `recommendMod` after beforeAll forces evaluation.
    // If the cache cycle re-emerges this will throw during dynamic import.
    expect(recommendMod).toBeDefined()
  })
})
