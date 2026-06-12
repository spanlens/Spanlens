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

  it('calculates cost for OpenAI embeddings (input-only, completion is 0)', () => {
    // Embeddings return prompt_tokens only; completion_tokens is always 0
    // (the response carries vectors, not generated text). The calculator
    // multiplies completion_tokens × completion_price so the completion side
    // contributes 0 to the total regardless of the seed price. This test
    // pins that RAG cost tracking lands non-zero for the prompt side.
    const result = calculateCost('openai', 'text-embedding-3-small', {
      promptTokens: 1_000_000,
      completionTokens: 0,
    })
    expect(result).not.toBeNull()
    expect(result?.promptCost).toBe(0.02)
    expect(result?.completionCost).toBe(0)
    expect(result?.totalCost).toBe(0.02)
  })

  it('calculates cost for text-embedding-3-large at $0.13 / 1M', () => {
    const result = calculateCost('openai', 'text-embedding-3-large', {
      promptTokens: 1_000_000,
      completionTokens: 0,
    })
    expect(result?.totalCost).toBe(0.13)
  })

  it('falls back to prefix match for dated model suffix (e.g. gpt-4o-mini-2024-07-18)', () => {
    const result = calculateCost('openai', 'gpt-4o-mini-2024-07-18', {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
    })
    expect(result).not.toBeNull()
    expect(result?.promptCost).toBe(0.15)
    expect(result?.completionCost).toBe(0.6)
  })

  it('prefers longest prefix match (gpt-4o-mini > gpt-4)', () => {
    const result = calculateCost('openai', 'gpt-4o-mini-2024-07-18', {
      promptTokens: 1_000_000,
      completionTokens: 0,
    })
    // gpt-4o-mini prompt price is 0.15, gpt-4 is 30 — must match the former
    expect(result?.promptCost).toBe(0.15)
  })
})
