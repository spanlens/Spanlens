import { describe, it, expect } from 'vitest'
import { matchSubstitute, SUBSTITUTES } from '../lib/model-recommend-rules.js'

describe('matchSubstitute — dated variant handling', () => {
  it('matches exact alias keys', () => {
    const sub = matchSubstitute('openai:gpt-4o')
    expect(sub).not.toBeNull()
    expect(sub?.suggestedModel).toBe('gpt-4o-mini')
  })

  it('matches OpenAI dated variant via longest-prefix', () => {
    const sub = matchSubstitute('openai:gpt-4o-2024-08-06')
    expect(sub).not.toBeNull()
    expect(sub?.suggestedModel).toBe('gpt-4o-mini')
    expect(sub?.costRatio).toBe(0.06)
  })

  it('does NOT mistakenly match a different family via prefix', () => {
    // 'openai:gpt-4-turbo-2024-04-09' should match 'openai:gpt-4-turbo', not 'openai:gpt-4'
    const sub = matchSubstitute('openai:gpt-4-turbo-2024-04-09')
    expect(sub).not.toBeNull()
    expect(sub?.suggestedModel).toBe('gpt-4o') // gpt-4-turbo rule
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
    // 'openai:gpt-4-turbo-...' starts with both 'openai:gpt-4' and 'openai:gpt-4-turbo'.
    // Must resolve to the longer (more specific) key.
    const sub = matchSubstitute('openai:gpt-4-turbo-2024-04-09')
    expect(sub?.suggestedModel).toBe('gpt-4o') // gpt-4-turbo rule, not gpt-4 rule
  })
})

describe('self-recommendation guard', () => {
  // These tests verify that the suggestedKey guard in model-recommend.ts
  // correctly identifies when the current model is already the suggested substitute.
  // The guard logic: key === suggestedKey || key.startsWith(suggestedKey + '-')

  it('gpt-4o-mini dated variant matches gpt-4o rule via prefix — guard must catch it', () => {
    // matchSubstitute alone returns the gpt-4o rule (suggesting gpt-4o-mini)
    // but the caller must apply the guard to skip it.
    const key = 'openai:gpt-4o-mini-2024-07-18'
    const sub = matchSubstitute(key)
    expect(sub).not.toBeNull()
    expect(sub?.suggestedModel).toBe('gpt-4o-mini')

    // Simulate the guard from model-recommend.ts
    const suggestedKey = `${sub!.suggestedProvider}:${sub!.suggestedModel}`
    const isSelfRec = key === suggestedKey || key.startsWith(suggestedKey + '-')
    expect(isSelfRec).toBe(true) // guard fires → recommendation skipped
  })

  it('gpt-4o (not mini) does NOT trigger the guard', () => {
    const key = 'openai:gpt-4o-2024-08-06'
    const sub = matchSubstitute(key)
    expect(sub).not.toBeNull()
    expect(sub?.suggestedModel).toBe('gpt-4o-mini')

    const suggestedKey = `${sub!.suggestedProvider}:${sub!.suggestedModel}`
    const isSelfRec = key === suggestedKey || key.startsWith(suggestedKey + '-')
    expect(isSelfRec).toBe(false) // guard does NOT fire → recommendation shown
  })

  it('haiku-4.5 usage does not get recommended to switch to haiku-4.5', () => {
    const key = 'anthropic:claude-haiku-4.5'
    // claude-haiku-4.5 is the SUGGESTED model in several rules, not a source rule itself.
    // matchSubstitute should return null for it (no rule has haiku-4.5 as source).
    const sub = matchSubstitute(key)
    // Even if it matched something, the guard would catch it. But ideally it returns null.
    if (sub) {
      const suggestedKey = `${sub.suggestedProvider}:${sub.suggestedModel}`
      const isSelfRec = key === suggestedKey || key.startsWith(suggestedKey + '-')
      expect(isSelfRec).toBe(true)
    } else {
      expect(sub).toBeNull()
    }
  })
})

describe('SUBSTITUTES rule table sanity checks', () => {
  it('no rule suggests switching to the same model as the source', () => {
    for (const [key, sub] of Object.entries(SUBSTITUTES)) {
      const [srcProvider, ...srcModelParts] = key.split(':')
      const srcModel = srcModelParts.join(':')
      expect(sub.suggestedModel).not.toBe(srcModel)
      expect(sub.suggestedProvider + ':' + sub.suggestedModel).not.toBe(key)
    }
  })

  it('all costRatios are between 0 and 1 (substitutes must be cheaper)', () => {
    for (const [key, sub] of Object.entries(SUBSTITUTES)) {
      expect(sub.costRatio).toBeGreaterThan(0)
      expect(sub.costRatio).toBeLessThan(1)
      // Also sanity-check envelopes are positive
      expect(sub.maxAvgPromptTokens).toBeGreaterThan(0)
      expect(sub.maxAvgCompletionTokens).toBeGreaterThan(0)
    }
  })
})
