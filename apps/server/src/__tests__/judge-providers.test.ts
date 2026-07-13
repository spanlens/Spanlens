import { describe, expect, it } from 'vitest'
import { VALID_JUDGE_PROVIDERS, isValidJudgeProvider } from '../lib/judge-providers.js'

// 2026-07-13 audit: this list was hardcoded in three places inside
// api/evals.ts and could drift. It is now a single module-level const —
// this test pins the exact membership so an accidental expansion (a product
// decision, not a refactor) fails loudly.

describe('VALID_JUDGE_PROVIDERS', () => {
  it('contains exactly the six judge providers', () => {
    expect([...VALID_JUDGE_PROVIDERS]).toEqual([
      'openai',
      'anthropic',
      'gemini',
      'azure',
      'mistral',
      'openrouter',
    ])
  })

  it('isValidJudgeProvider accepts members and rejects everything else', () => {
    expect(isValidJudgeProvider('openai')).toBe(true)
    expect(isValidJudgeProvider('openrouter')).toBe(true)
    // Proxied providers that are deliberately NOT judges.
    expect(isValidJudgeProvider('groq')).toBe(false)
    expect(isValidJudgeProvider('deepseek')).toBe(false)
    expect(isValidJudgeProvider('xai')).toBe(false)
    expect(isValidJudgeProvider('cohere')).toBe(false)
    expect(isValidJudgeProvider('')).toBe(false)
  })
})
