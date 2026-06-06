import { describe, expect, it } from 'vitest'
import {
  parseCategories,
  validateScore,
  validateScoreConfigShape,
  type ScoreConfig,
} from './score-validation.js'

function makeConfig(overrides: Partial<ScoreConfig> = {}): ScoreConfig {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    data_type: 'NUMERIC',
    min_value: 0,
    max_value: 1,
    categories: null,
    bool_true_label: null,
    bool_false_label: null,
    ...overrides,
  }
}

describe('validateScore — NUMERIC', () => {
  const config = makeConfig({ data_type: 'NUMERIC', min_value: 0, max_value: 1 })

  it('accepts a number inside the range', () => {
    const r = validateScore(config, 0.75)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.fields.score).toBe(0.75)
      expect(r.fields.value_number).toBe(0.75)
      expect(r.fields.value_string).toBeNull()
      expect(r.fields.value_boolean).toBeNull()
    }
  })

  it('mirrors the legacy `score` column', () => {
    const r = validateScore(config, 1)
    if (r.ok) expect(r.fields.score).toBe(r.fields.value_number)
  })

  it('rejects values below min', () => {
    const r = validateScore(config, -0.1)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('NUMERIC_OUT_OF_RANGE')
  })

  it('rejects values above max', () => {
    const r = validateScore(config, 1.5)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('NUMERIC_OUT_OF_RANGE')
  })

  it('rejects non-finite values (NaN, Infinity)', () => {
    expect(validateScore(config, NaN).ok).toBe(false)
    expect(validateScore(config, Infinity).ok).toBe(false)
  })

  it('coerces numeric strings', () => {
    const r = validateScore(config, '0.5')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.fields.value_number).toBe(0.5)
  })

  it('rejects garbage strings', () => {
    const r = validateScore(config, 'not a number')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('INVALID_NUMERIC')
  })

  it('respects custom ranges (-1..1)', () => {
    const wide = makeConfig({ data_type: 'NUMERIC', min_value: -1, max_value: 1 })
    expect(validateScore(wide, -1).ok).toBe(true)
    expect(validateScore(wide, 1).ok).toBe(true)
    expect(validateScore(wide, 2).ok).toBe(false)
  })
})

describe('validateScore — CATEGORICAL', () => {
  const config = makeConfig({
    data_type: 'CATEGORICAL',
    min_value: null,
    max_value: null,
    categories: ['Helpful', 'Neutral', 'Unhelpful'],
  })

  it('accepts a value from the list', () => {
    const r = validateScore(config, 'Helpful')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.fields.value_string).toBe('Helpful')
      expect(r.fields.value_number).toBeNull()
      expect(r.fields.score).toBeNull() // does NOT pollute legacy column
    }
  })

  it('rejects values not in the list', () => {
    const r = validateScore(config, 'Excellent')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('INVALID_CATEGORICAL')
  })

  it('rejects empty strings', () => {
    const r = validateScore(config, '')
    expect(r.ok).toBe(false)
  })

  it('rejects non-string types (numbers, booleans)', () => {
    expect(validateScore(config, 1).ok).toBe(false)
    expect(validateScore(config, true).ok).toBe(false)
  })

  it('is case sensitive (does NOT auto-correct casing)', () => {
    const r = validateScore(config, 'helpful')
    expect(r.ok).toBe(false)
  })
})

describe('validateScore — BOOLEAN', () => {
  const config = makeConfig({
    data_type: 'BOOLEAN',
    min_value: null,
    max_value: null,
  })

  it('accepts real booleans', () => {
    const r = validateScore(config, true)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.fields.value_boolean).toBe(true)
  })

  it('accepts "true"/"false" string aliases', () => {
    const r1 = validateScore(config, 'true')
    const r2 = validateScore(config, 'false')
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    if (r1.ok) expect(r1.fields.value_boolean).toBe(true)
    if (r2.ok) expect(r2.fields.value_boolean).toBe(false)
  })

  it('accepts pass/fail aliases', () => {
    if (validateScore(config, 'pass').ok && validateScore(config, 'fail').ok) {
      // ok
    } else {
      expect.fail('pass/fail aliases should be accepted')
    }
  })

  it('does NOT silently coerce arbitrary truthy strings', () => {
    // This is the bug we want to avoid: JS Boolean("false") === true.
    const r = validateScore(config, 'maybe')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('INVALID_BOOLEAN')
  })

  it('keeps legacy score column null', () => {
    const r = validateScore(config, true)
    if (r.ok) {
      expect(r.fields.score).toBeNull()
      expect(r.fields.value_number).toBeNull()
    }
  })
})

describe('validateScore — TEXT', () => {
  const config = makeConfig({
    data_type: 'TEXT',
    min_value: null,
    max_value: null,
  })

  it('accepts a non-empty string', () => {
    const r = validateScore(config, 'Customer praised the tone')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.fields.value_string).toBe('Customer praised the tone')
  })

  it('trims surrounding whitespace', () => {
    const r = validateScore(config, '  hello  ')
    if (r.ok) expect(r.fields.value_string).toBe('hello')
  })

  it('rejects empty or whitespace-only strings', () => {
    expect(validateScore(config, '').ok).toBe(false)
    expect(validateScore(config, '   ').ok).toBe(false)
  })

  it('rejects non-string types', () => {
    expect(validateScore(config, 42).ok).toBe(false)
    expect(validateScore(config, null).ok).toBe(false)
  })
})

describe('parseCategories', () => {
  it('returns string[] from a clean JSONB array', () => {
    expect(parseCategories(['A', 'B'])).toEqual(['A', 'B'])
  })

  it('filters out non-string entries', () => {
    expect(parseCategories(['A', 1, null, 'B', ''])).toEqual(['A', 'B'])
  })

  it('returns empty array for non-array input', () => {
    expect(parseCategories(null)).toEqual([])
    expect(parseCategories('A,B')).toEqual([])
    expect(parseCategories({ a: 1 })).toEqual([])
  })
})

describe('validateScoreConfigShape', () => {
  it('NUMERIC needs both bounds and min<max', () => {
    expect(
      validateScoreConfigShape({ data_type: 'NUMERIC', min_value: 0, max_value: 1, categories: null }),
    ).toBeNull()
    expect(
      validateScoreConfigShape({ data_type: 'NUMERIC', min_value: 1, max_value: 1, categories: null }),
    ).toMatch(/strictly less/)
    expect(
      validateScoreConfigShape({ data_type: 'NUMERIC', min_value: null, max_value: 1, categories: null }),
    ).toMatch(/min_value and max_value/)
  })

  it('CATEGORICAL needs at least 2 unique categories', () => {
    expect(
      validateScoreConfigShape({
        data_type: 'CATEGORICAL',
        min_value: null,
        max_value: null,
        categories: ['A', 'B'],
      }),
    ).toBeNull()
    expect(
      validateScoreConfigShape({
        data_type: 'CATEGORICAL',
        min_value: null,
        max_value: null,
        categories: ['A'],
      }),
    ).toMatch(/at least 2/)
    expect(
      validateScoreConfigShape({
        data_type: 'CATEGORICAL',
        min_value: null,
        max_value: null,
        categories: ['A', 'A'],
      }),
    ).toMatch(/unique/)
  })

  it('BOOLEAN / TEXT accept any', () => {
    expect(
      validateScoreConfigShape({ data_type: 'BOOLEAN', min_value: null, max_value: null, categories: null }),
    ).toBeNull()
    expect(
      validateScoreConfigShape({ data_type: 'TEXT', min_value: null, max_value: null, categories: null }),
    ).toBeNull()
  })

  it('rejects unknown data_type', () => {
    expect(
      validateScoreConfigShape({ data_type: 'FOO', min_value: null, max_value: null, categories: null }),
    ).toMatch(/Unknown data_type/)
  })
})
