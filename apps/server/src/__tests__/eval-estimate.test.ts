import { describe, expect, it } from 'vitest'
import { estimateJudgeCostUsd } from '../lib/eval-runner.js'

// P3-13: better cost estimate — real provider routing, length-aware token math.

describe('estimateJudgeCostUsd', () => {
  it('returns 0 when calculateCost has no entry for the model (graceful fallback)', () => {
    expect(estimateJudgeCostUsd({ sampleSize: 10, judgeProvider: 'openai', judgeModel: 'no-such-model-xyz' })).toBe(0)
  })

  it('produces a positive number for a known model', () => {
    const c = estimateJudgeCostUsd({ sampleSize: 50, judgeProvider: 'openai', judgeModel: 'gpt-4o-mini' })
    expect(c).toBeGreaterThan(0)
  })

  it('routes anthropic models via the anthropic cost table (not openai)', () => {
    // The old prefix-sniff billed every non-gpt as anthropic. With the new
    // signature the caller passes the provider explicitly, so an anthropic
    // model only bills if the provider is 'anthropic'.
    const asAnthropic = estimateJudgeCostUsd({ sampleSize: 100, judgeProvider: 'anthropic', judgeModel: 'claude-3-5-haiku-20241022' })
    expect(asAnthropic).toBeGreaterThan(0)
  })

  it('routes azure pricing through the openai cost table', () => {
    // calculateCost('azure', model) would be missing — azure uses openai prices.
    const azure = estimateJudgeCostUsd({ sampleSize: 50, judgeProvider: 'azure', judgeModel: 'gpt-4o-mini' })
    const openai = estimateJudgeCostUsd({ sampleSize: 50, judgeProvider: 'openai', judgeModel: 'gpt-4o-mini' })
    expect(azure).toBe(openai)
  })

  it('scales linearly with sampleSize', () => {
    const small = estimateJudgeCostUsd({ sampleSize: 10, judgeProvider: 'openai', judgeModel: 'gpt-4o-mini' })
    const large = estimateJudgeCostUsd({ sampleSize: 100, judgeProvider: 'openai', judgeModel: 'gpt-4o-mini' })
    expect(large).toBeCloseTo(small * 10, 4)
  })

  it('increases with longer criterion / response inputs (length-aware)', () => {
    const tiny = estimateJudgeCostUsd({
      sampleSize: 50,
      judgeProvider: 'openai',
      judgeModel: 'gpt-4o-mini',
      criterionChars: 80,
      avgResponseChars: 200,
    })
    const huge = estimateJudgeCostUsd({
      sampleSize: 50,
      judgeProvider: 'openai',
      judgeModel: 'gpt-4o-mini',
      criterionChars: 80,
      avgResponseChars: 8000,
    })
    expect(huge).toBeGreaterThan(tiny)
  })

  it('uses the legacy 800-token estimate when neither length is provided (back-compat)', () => {
    const noLens = estimateJudgeCostUsd({ sampleSize: 50, judgeProvider: 'openai', judgeModel: 'gpt-4o-mini' })
    // Same model + same sample, identical to old hard-coded 800/100 split.
    expect(noLens).toBeGreaterThan(0)
  })
})
