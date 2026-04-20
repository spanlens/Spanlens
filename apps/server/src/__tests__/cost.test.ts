import { describe, it, expect } from 'vitest'
import { calculateCost } from '../lib/cost.js'

describe('calculateCost', () => {
  it('calculates cost for gpt-4o', () => {
    const result = calculateCost('openai', 'gpt-4o', {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
    })
    expect(result).not.toBeNull()
    expect(result?.promptCost).toBe(2.5)
    expect(result?.completionCost).toBe(10)
    expect(result?.totalCost).toBe(12.5)
  })

  it('returns null for unknown model', () => {
    const result = calculateCost('openai', 'unknown-model-xyz', {
      promptTokens: 100,
      completionTokens: 100,
    })
    expect(result).toBeNull()
  })

  it('calculates cost for claude-sonnet', () => {
    const result = calculateCost('anthropic', 'claude-sonnet-4-6', {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
    })
    expect(result?.totalCost).toBe(18)
  })
})
