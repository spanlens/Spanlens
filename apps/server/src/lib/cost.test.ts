import { describe, expect, test } from 'vitest'
import { calculateCost } from './cost.js'

describe('calculateCost — basic (no cache)', () => {
  test('gpt-4o-mini: 1k prompt + 500 completion', () => {
    const cost = calculateCost('openai', 'gpt-4o-mini', {
      promptTokens: 1000,
      completionTokens: 500,
    })
    expect(cost).not.toBeNull()
    // 1000/1M × 0.15 + 500/1M × 0.60 = 0.00015 + 0.0003 = 0.00045
    expect(cost!.totalCost).toBeCloseTo(0.00045, 8)
    expect(cost!.cacheReadCost).toBe(0)
    expect(cost!.cacheWriteCost).toBe(0)
  })

  test('returns null for unknown model', () => {
    expect(
      calculateCost('openai', 'no-such-model-xyz', { promptTokens: 100, completionTokens: 50 }),
    ).toBeNull()
  })

  test('boundary-aware prefix match: dated suffix resolves to base model', () => {
    const cost = calculateCost('openai', 'gpt-4o-mini-2024-07-18', {
      promptTokens: 1000,
      completionTokens: 0,
    })
    expect(cost).not.toBeNull()
    expect(cost!.totalCost).toBeCloseTo(0.00015, 8)
  })
})

describe('calculateCost — cache breakdown', () => {
  test('Anthropic Sonnet: 10k prompt total = 8k regular + 1k cache_read + 1k cache_write', () => {
    // claude-sonnet-4-6: prompt 3, completion 15, cacheRead 0.3, cacheWrite 3.75
    const cost = calculateCost('anthropic', 'claude-sonnet-4-6', {
      promptTokens: 10_000,
      completionTokens: 500,
      cacheReadTokens: 1000,
      cacheWriteTokens: 1000,
    })
    expect(cost).not.toBeNull()
    // non_cached = 10_000 - 1000 - 1000 = 8000
    // prompt_cost      = 8000/1M  × 3.0   = 0.024
    // cache_read_cost  = 1000/1M  × 0.3   = 0.0003
    // cache_write_cost = 1000/1M  × 3.75  = 0.00375
    // completion_cost  = 500/1M   × 15.0  = 0.0075
    expect(cost!.promptCost).toBeCloseTo(0.024, 8)
    expect(cost!.cacheReadCost).toBeCloseTo(0.0003, 8)
    expect(cost!.cacheWriteCost).toBeCloseTo(0.00375, 8)
    expect(cost!.completionCost).toBeCloseTo(0.0075, 8)
    expect(cost!.totalCost).toBeCloseTo(0.03555, 8)
  })

  test('OpenAI gpt-4o: 10k prompt = 5k cached + 5k non-cached', () => {
    // gpt-4o: prompt 2.5, completion 10, cacheRead 1.25 (no cacheWrite)
    const cost = calculateCost('openai', 'gpt-4o', {
      promptTokens: 10_000,
      completionTokens: 1000,
      cacheReadTokens: 5000,
      cacheWriteTokens: 0,
    })
    expect(cost).not.toBeNull()
    // prompt_cost     = 5000/1M  × 2.5  = 0.0125
    // cache_read_cost = 5000/1M  × 1.25 = 0.00625
    // completion_cost = 1000/1M  × 10   = 0.01
    expect(cost!.promptCost).toBeCloseTo(0.0125, 8)
    expect(cost!.cacheReadCost).toBeCloseTo(0.00625, 8)
    expect(cost!.completionCost).toBeCloseTo(0.01, 8)
    expect(cost!.totalCost).toBeCloseTo(0.02875, 8)
  })

  test('overcounting protection: cache_read + cache_write > promptTokens → non_cached clamped at 0', () => {
    const cost = calculateCost('anthropic', 'claude-sonnet-4-6', {
      promptTokens: 100,
      completionTokens: 0,
      cacheReadTokens: 200,
      cacheWriteTokens: 0,
    })
    expect(cost).not.toBeNull()
    expect(cost!.promptCost).toBe(0)
    // cache_read still charged on its full count
    expect(cost!.cacheReadCost).toBeCloseTo(0.00006, 10)
  })

  test('model without cache pricing falls back to prompt rate for cache_read', () => {
    // gpt-4-turbo: prompt 10, completion 30, NO cacheRead defined
    const cost = calculateCost('openai', 'gpt-4-turbo', {
      promptTokens: 1000,
      completionTokens: 0,
      cacheReadTokens: 500,
    })
    expect(cost).not.toBeNull()
    // non_cached = 1000 - 500 = 500 × 10/1M = 0.005
    // cache_read = 500 × 10/1M (fallback to prompt rate) = 0.005
    // total = 0.01 (matches the OLD overcounting behavior — safe default)
    expect(cost!.cacheReadCost).toBeCloseTo(0.005, 8)
    expect(cost!.totalCost).toBeCloseTo(0.01, 8)
  })
})

describe('calculateCost — regression vs. old behavior', () => {
  test('no cache tokens → identical total to pre-migration cost', () => {
    // Anthropic Haiku, 1000 prompt + 500 completion, NO cache.
    // Old formula: 1000/1M × 1 + 500/1M × 5 = 0.001 + 0.0025 = 0.0035
    // New formula (cacheReadTokens=0, cacheWriteTokens=0): same.
    const cost = calculateCost('anthropic', 'claude-haiku-4-5', {
      promptTokens: 1000,
      completionTokens: 500,
    })
    expect(cost!.totalCost).toBeCloseTo(0.0035, 8)
  })

  test('Anthropic cache-heavy workload shows cost reduction vs. old behavior', () => {
    // 100k prompt = 90k cache_read + 10k non-cached
    // Old (broken): 100_000 × 3/1M = 0.30
    // New: 10_000 × 3/1M + 90_000 × 0.3/1M = 0.03 + 0.027 = 0.057
    // Ratio: 0.057 / 0.30 ≈ 0.19 → 5.3× overcount fixed
    const cost = calculateCost('anthropic', 'claude-sonnet-4-6', {
      promptTokens: 100_000,
      completionTokens: 0,
      cacheReadTokens: 90_000,
    })
    expect(cost!.totalCost).toBeCloseTo(0.057, 6)
    const oldCostEstimate = 100_000 / 1_000_000 * 3
    expect(oldCostEstimate / cost!.totalCost).toBeGreaterThan(5)
  })
})
