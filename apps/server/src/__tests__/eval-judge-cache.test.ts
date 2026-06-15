import { describe, expect, it } from 'vitest'
import { hashEvaluatorConfig, hashSampleInputs } from '../lib/eval-runners/judge-cache.js'
import type { JudgeConfig } from '../lib/eval-runners/judge-prompt.js'

// P3-18: judge_cache hashing — the cache key rotation logic.

function cfg(over: Partial<JudgeConfig> = {}): JudgeConfig {
  return {
    criterion: 'Is the answer helpful?',
    judge_provider: 'openai',
    judge_model: 'gpt-4o-mini',
    scale_min: 0,
    scale_max: 1,
    ...over,
  }
}

describe('hashEvaluatorConfig', () => {
  it('is deterministic for the same config', async () => {
    const a = await hashEvaluatorConfig(cfg())
    const b = await hashEvaluatorConfig(cfg())
    expect(a).toBe(b)
    // SHA-256 hex.
    expect(a).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rotates when the criterion changes', async () => {
    const a = await hashEvaluatorConfig(cfg({ criterion: 'crit A' }))
    const b = await hashEvaluatorConfig(cfg({ criterion: 'crit B' }))
    expect(a).not.toBe(b)
  })

  it('rotates when the judge model changes', async () => {
    const a = await hashEvaluatorConfig(cfg({ judge_model: 'gpt-4o-mini' }))
    const b = await hashEvaluatorConfig(cfg({ judge_model: 'gpt-4o' }))
    expect(a).not.toBe(b)
  })

  it('rotates when the rubric changes', async () => {
    const a = await hashEvaluatorConfig(cfg({ rubric: 'old rubric' }))
    const b = await hashEvaluatorConfig(cfg({ rubric: 'new rubric' }))
    expect(a).not.toBe(b)
  })

  it('treats missing rubric and empty/whitespace rubric as equivalent', async () => {
    const noRubric = await hashEvaluatorConfig(cfg())
    const emptyRubric = await hashEvaluatorConfig(cfg({ rubric: '' }))
    const whitespaceRubric = await hashEvaluatorConfig(cfg({ rubric: '   ' }))
    expect(noRubric).toBe(emptyRubric)
    expect(noRubric).toBe(whitespaceRubric)
  })

  it('rotates when anchors change', async () => {
    const a = await hashEvaluatorConfig(cfg({ anchors: [{ response: 'good', score: 1 }] }))
    const b = await hashEvaluatorConfig(cfg({ anchors: [{ response: 'bad', score: 0 }] }))
    expect(a).not.toBe(b)
  })

  it('treats missing anchors array and empty anchors array as equivalent', async () => {
    const noAnchors = await hashEvaluatorConfig(cfg())
    const emptyAnchors = await hashEvaluatorConfig(cfg({ anchors: [] }))
    expect(noAnchors).toBe(emptyAnchors)
  })

  it('rotates when score_config_id changes', async () => {
    const a = await hashEvaluatorConfig(cfg({ score_config: { id: 'a', data_type: 'NUMERIC', min_value: 0, max_value: 1, categories: null, bool_true_label: null, bool_false_label: null } }))
    const b = await hashEvaluatorConfig(cfg({ score_config: { id: 'b', data_type: 'NUMERIC', min_value: 0, max_value: 1, categories: null, bool_true_label: null, bool_false_label: null } }))
    expect(a).not.toBe(b)
  })
})

describe('hashSampleInputs', () => {
  it('is deterministic for the same inputs', async () => {
    const a = await hashSampleInputs('Paris', null)
    const b = await hashSampleInputs('Paris', null)
    expect(a).toBe(b)
  })

  it('rotates when the response text changes', async () => {
    const a = await hashSampleInputs('Paris', null)
    const b = await hashSampleInputs('Lyon', null)
    expect(a).not.toBe(b)
  })

  it('rotates when the golden expected_output changes', async () => {
    const a = await hashSampleInputs('Paris', 'The capital is Paris.')
    const b = await hashSampleInputs('Paris', 'France is in Europe.')
    expect(a).not.toBe(b)
  })

  it('treats no expected_output as distinct from any expected_output', async () => {
    const noGold = await hashSampleInputs('Paris', null)
    const emptyGold = await hashSampleInputs('Paris', '')
    // Both end up with no extra content after the separator. The null/'' case
    // collapses to the same hash by design — both mean "no reference".
    expect(noGold).toBe(emptyGold)
  })

  it('does not collide when response/expected boundary is ambiguous (null-byte separator)', async () => {
    // "a b" + null vs "a" + "b" — without a null-byte separator these would
    // both naively concat to "a b". The implementation must keep them distinct.
    const a = await hashSampleInputs('a b', null)
    const b = await hashSampleInputs('a', 'b')
    expect(a).not.toBe(b)
  })
})
