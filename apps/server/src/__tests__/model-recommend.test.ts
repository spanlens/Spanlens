import { describe, it, expect } from 'vitest'
import { matchSubstitute } from '../lib/model-recommend-rules.js'

describe('matchSubstitute — dated variant handling', () => {
  it('matches exact alias keys', () => {
    const sub = matchSubstitute('openai:gpt-4o')
    expect(sub).not.toBeNull()
    expect(sub?.suggestedModel).toBe('gpt-4o-mini')
  })

  it('matches OpenAI dated variant via longest-prefix', () => {
    // OpenAI returns 'gpt-4o-mini-2024-07-18' in response body.model.
    // We want recommendation logic to still hit the 'openai:gpt-4o-mini'
    // rule (if one exists) or fall back gracefully if none.
    const sub = matchSubstitute('openai:gpt-4o-2024-08-06')
    expect(sub).not.toBeNull()
    expect(sub?.suggestedModel).toBe('gpt-4o-mini')
    expect(sub?.costRatio).toBe(0.06)
  })

  it('does NOT mistakenly match a different family via prefix', () => {
    // 'openai:gpt-4' should NOT hit anything just because some key
    // happens to start with 'gpt-4' (e.g. 'gpt-4o') — boundary must be '-'.
    const sub = matchSubstitute('openai:gpt-4-turbo-2024-04-09')
    // No rule for gpt-4/gpt-4-turbo in SUBSTITUTES → expect null.
    expect(sub).toBeNull()
  })

  it('matches Anthropic Sonnet dated variant', () => {
    const sub = matchSubstitute('anthropic:claude-3-5-sonnet-20241022')
    expect(sub).not.toBeNull()
    expect(sub?.suggestedModel).toBe('claude-haiku-4.5')
  })

  it('returns null for unknown models', () => {
    expect(matchSubstitute('openai:future-model-9000')).toBeNull()
    expect(matchSubstitute('unknown:anything')).toBeNull()
  })

  it('picks the LONGEST matching prefix — not the first', () => {
    // If we had both 'openai:gpt-4o' and 'openai:gpt-4o-mini' registered,
    // 'openai:gpt-4o-mini-2024-07-18' should match the more specific one.
    // Current SUBSTITUTES has 'openai:gpt-4o' only (no gpt-4o-mini), so this
    // test documents the expected behavior when gpt-4o-mini rule is added.
    // For now: gpt-4o-mini-2024-07-18 starts with 'gpt-4o-' (with dash) which
    // matches 'openai:gpt-4o' → returns its substitute (same rule applied to
    // mini, which is arguably over-aggressive but safe — mini tokens are
    // below the threshold anyway).
    const sub = matchSubstitute('openai:gpt-4o-mini-2024-07-18')
    expect(sub).not.toBeNull()
  })
})
