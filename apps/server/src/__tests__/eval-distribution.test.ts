import { describe, expect, it } from 'vitest'
import { computeDistribution } from '../lib/eval-runners/distribution.js'
import type { TypedScoreConfig } from '../lib/eval-runners/judge-prompt.js'

// P3-16: server-side distribution / sample summary.

function sample(over: Partial<{ value_number: number | null; value_string: string | null; value_boolean: boolean | null }>) {
  return { value_number: null, value_string: null, value_boolean: null, ...over }
}

const sc = (data_type: TypedScoreConfig['data_type'], over: Partial<TypedScoreConfig> = {}): TypedScoreConfig => ({
  id: 'cfg',
  data_type,
  min_value: null,
  max_value: null,
  categories: null,
  bool_true_label: null,
  bool_false_label: null,
  ...over,
})

describe('computeDistribution', () => {
  it('returns null when there is no score config (NUMERIC / legacy path)', () => {
    expect(computeDistribution([sample({ value_number: 0.8 })], null)).toBeNull()
    expect(computeDistribution([sample({ value_number: 0.8 })], undefined)).toBeNull()
  })

  it('returns null on NUMERIC configs (avg_score + score_stddev already cover it)', () => {
    expect(computeDistribution([sample({ value_number: 0.7 })], sc('NUMERIC'))).toBeNull()
  })

  it('counts CATEGORICAL values, ignoring null entries', () => {
    const out = computeDistribution(
      [
        sample({ value_string: 'Helpful' }),
        sample({ value_string: 'Helpful' }),
        sample({ value_string: 'Neutral' }),
        sample({ value_string: null }),
        sample({ value_string: 'Helpful' }),
      ],
      sc('CATEGORICAL', { categories: ['Helpful', 'Neutral'] }),
    )
    expect(out).toEqual({ type: 'categorical', counts: { Helpful: 3, Neutral: 1 } })
  })

  it('returns an empty counts object on an empty CATEGORICAL run', () => {
    const out = computeDistribution([], sc('CATEGORICAL'))
    expect(out).toEqual({ type: 'categorical', counts: {} })
  })

  it('tallies BOOLEAN true / false (null is ignored)', () => {
    const out = computeDistribution(
      [
        sample({ value_boolean: true }),
        sample({ value_boolean: false }),
        sample({ value_boolean: true }),
        sample({ value_boolean: null }),
      ],
      sc('BOOLEAN'),
    )
    expect(out).toEqual({ type: 'boolean', counts: { true: 2, false: 1 } })
  })

  it('keeps up to 10 TEXT samples and counts the total', () => {
    const samples = Array.from({ length: 25 }, (_, i) => sample({ value_string: `answer ${i}` }))
    const out = computeDistribution(samples, sc('TEXT'))
    expect(out?.type).toBe('text')
    expect(out).toMatchObject({ count: 25 })
    if (out?.type === 'text') {
      expect(out.samples.length).toBe(10)
      expect(out.samples[0]).toBe('answer 0')
    }
  })

  it('truncates long TEXT samples to keep the summary row small', () => {
    const long = 'x'.repeat(500)
    const out = computeDistribution([sample({ value_string: long })], sc('TEXT'))
    if (out?.type === 'text') {
      // 240 chars + the ellipsis char added by the truncation branch.
      expect(out.samples[0]!.length).toBeLessThanOrEqual(241)
      expect(out.samples[0]!.endsWith('…')).toBe(true)
    } else {
      throw new Error('expected text distribution')
    }
  })

  it('skips empty TEXT entries when picking samples', () => {
    const out = computeDistribution(
      [sample({ value_string: '' }), sample({ value_string: 'real' }), sample({ value_string: null })],
      sc('TEXT'),
    )
    if (out?.type === 'text') {
      expect(out.count).toBe(1)
      expect(out.samples).toEqual(['real'])
    } else {
      throw new Error('expected text distribution')
    }
  })
})
