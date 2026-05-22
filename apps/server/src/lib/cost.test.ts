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

describe('calculateCost — tiered (long context) pricing', () => {
  test('gpt-5.5 short tier: 100k prompt billed at short rate', () => {
    // short: prompt 5, completion 30
    const cost = calculateCost('openai', 'gpt-5.5', {
      promptTokens: 100_000,
      completionTokens: 1_000,
    })
    expect(cost).not.toBeNull()
    // 100k × 5/1M + 1k × 30/1M = 0.5 + 0.03 = 0.53
    expect(cost!.totalCost).toBeCloseTo(0.53, 6)
  })

  test('gpt-5.5 long tier: 300k prompt billed at long rate (≥272k threshold)', () => {
    // long: prompt 10, completion 45
    const cost = calculateCost('openai', 'gpt-5.5', {
      promptTokens: 300_000,
      completionTokens: 1_000,
    })
    expect(cost).not.toBeNull()
    // 300k × 10/1M + 1k × 45/1M = 3.0 + 0.045 = 3.045
    expect(cost!.totalCost).toBeCloseTo(3.045, 6)
  })

  test('gpt-5.5 long tier: cache_read uses long cache rate ($1/M)', () => {
    // long: prompt 10, completion 45, cacheRead 1.0
    const cost = calculateCost('openai', 'gpt-5.5', {
      promptTokens: 300_000,
      completionTokens: 0,
      cacheReadTokens: 100_000,
    })
    expect(cost).not.toBeNull()
    // non-cached = 200k × 10/1M = 2.0
    // cache_read = 100k × 1.0/1M = 0.1
    expect(cost!.promptCost).toBeCloseTo(2.0, 6)
    expect(cost!.cacheReadCost).toBeCloseTo(0.1, 6)
    expect(cost!.totalCost).toBeCloseTo(2.1, 6)
  })

  test('gpt-5.5 boundary: exactly at threshold (272k) stays in short tier', () => {
    // condition is `promptTokens > threshold` (strict), so 272k → short
    const cost = calculateCost('openai', 'gpt-5.5', {
      promptTokens: 272_000,
      completionTokens: 0,
    })
    expect(cost).not.toBeNull()
    // short: 272k × 5/1M = 1.36
    expect(cost!.totalCost).toBeCloseTo(1.36, 6)
  })

  test('gpt-5.5 boundary: one token over threshold flips to long', () => {
    const cost = calculateCost('openai', 'gpt-5.5', {
      promptTokens: 272_001,
      completionTokens: 0,
    })
    expect(cost).not.toBeNull()
    // long: 272001 × 10/1M ≈ 2.72001
    expect(cost!.totalCost).toBeCloseTo(2.72001, 5)
  })

  test('gemini-2.5-pro long tier: 250k prompt billed at long rate', () => {
    // short: 1.25 / 10, long: 2.5 / 15, threshold 200k
    const cost = calculateCost('gemini', 'gemini-2.5-pro', {
      promptTokens: 250_000,
      completionTokens: 5_000,
    })
    expect(cost).not.toBeNull()
    // 250k × 2.5/1M + 5k × 15/1M = 0.625 + 0.075 = 0.7
    expect(cost!.totalCost).toBeCloseTo(0.7, 6)
  })

  test('gpt-5.4-mini has no long tier → 500k prompt still short rate', () => {
    // short only: prompt 0.75, completion 4.5
    const cost = calculateCost('openai', 'gpt-5.4-mini', {
      promptTokens: 500_000,
      completionTokens: 0,
    })
    expect(cost).not.toBeNull()
    // 500k × 0.75/1M = 0.375
    expect(cost!.totalCost).toBeCloseTo(0.375, 6)
  })
})

describe('calculateCost — service tier multiplier', () => {
  test('default tier matches no-tier cost (1.0× multiplier)', () => {
    const baseline = calculateCost('openai', 'gpt-4o-mini', {
      promptTokens: 1000, completionTokens: 500,
    })!
    const defaulted = calculateCost('openai', 'gpt-4o-mini', {
      promptTokens: 1000, completionTokens: 500, serviceTier: 'default',
    })!
    expect(defaulted.totalCost).toBeCloseTo(baseline.totalCost, 10)
  })

  test('flex tier applies 0.5× discount', () => {
    const baseline = calculateCost('openai', 'gpt-4o-mini', {
      promptTokens: 1000, completionTokens: 500,
    })!
    const flex = calculateCost('openai', 'gpt-4o-mini', {
      promptTokens: 1000, completionTokens: 500, serviceTier: 'flex',
    })!
    expect(flex.totalCost).toBeCloseTo(baseline.totalCost * 0.5, 10)
  })

  test('priority tier applies 1.8× premium', () => {
    const baseline = calculateCost('openai', 'gpt-4o-mini', {
      promptTokens: 1000, completionTokens: 500,
    })!
    const priority = calculateCost('openai', 'gpt-4o-mini', {
      promptTokens: 1000, completionTokens: 500, serviceTier: 'priority',
    })!
    expect(priority.totalCost).toBeCloseTo(baseline.totalCost * 1.8, 10)
  })

  test('batch tier applies 0.5× discount', () => {
    const baseline = calculateCost('openai', 'gpt-4o-mini', {
      promptTokens: 1000, completionTokens: 500,
    })!
    const batch = calculateCost('openai', 'gpt-4o-mini', {
      promptTokens: 1000, completionTokens: 500, serviceTier: 'batch',
    })!
    expect(batch.totalCost).toBeCloseTo(baseline.totalCost * 0.5, 10)
  })

  test('priority scales cache_read alongside prompt/completion', () => {
    // Anthropic Sonnet — cache_read is 0.3, prompt 3, completion 15.
    // Priority should scale all three by 1.8.
    const baseline = calculateCost('anthropic', 'claude-sonnet-4-6', {
      promptTokens: 10_000, completionTokens: 500, cacheReadTokens: 5_000,
    })!
    const priority = calculateCost('anthropic', 'claude-sonnet-4-6', {
      promptTokens: 10_000, completionTokens: 500, cacheReadTokens: 5_000,
      serviceTier: 'priority',
    })!
    expect(priority.promptCost).toBeCloseTo(baseline.promptCost * 1.8, 8)
    expect(priority.cacheReadCost).toBeCloseTo(baseline.cacheReadCost * 1.8, 8)
    expect(priority.completionCost).toBeCloseTo(baseline.completionCost * 1.8, 8)
    expect(priority.totalCost).toBeCloseTo(baseline.totalCost * 1.8, 8)
  })

  test('flex + long context: multipliers stack correctly', () => {
    // gpt-5.5 long tier: prompt $10 / completion $45. Flex = 0.5×.
    // 300k prompt + 1k completion at flex:
    //   prompt: 300k × 10 × 0.5 / 1M = 1.50
    //   completion: 1k × 45 × 0.5 / 1M = 0.0225
    const cost = calculateCost('openai', 'gpt-5.5', {
      promptTokens: 300_000, completionTokens: 1_000, serviceTier: 'flex',
    })!
    expect(cost.totalCost).toBeCloseTo(1.5225, 5)
  })

  test('unknown serviceTier value defaults to 1.0×', () => {
    const baseline = calculateCost('openai', 'gpt-4o-mini', {
      promptTokens: 1000, completionTokens: 500,
    })!
    // TS won't let unknown tier through normally, but runtime might receive
    // a value we never enumerated — calculator must not crash and must
    // default to Standard.
    const unknown = calculateCost('openai', 'gpt-4o-mini', {
      promptTokens: 1000, completionTokens: 500,
      serviceTier: 'something-weird' as never,
    })!
    expect(unknown.totalCost).toBeCloseTo(baseline.totalCost, 10)
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
