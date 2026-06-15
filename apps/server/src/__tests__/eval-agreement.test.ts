import { describe, expect, it } from 'vitest'
import {
  pearsonR,
  cohensKappa,
  interpretAgreement,
  computeAgreement,
} from '../lib/eval-runners/agreement.js'

// P3-19: server-side agreement statistics (Pearson r + Cohen's κ).

describe('pearsonR', () => {
  it('returns null on <2 pairs', () => {
    expect(pearsonR([])).toBeNull()
    expect(pearsonR([{ judge: 0.5, human: 0.5 }])).toBeNull()
  })

  it('returns 1 for perfectly identical pairs', () => {
    const r = pearsonR([
      { judge: 0.2, human: 0.2 },
      { judge: 0.5, human: 0.5 },
      { judge: 0.9, human: 0.9 },
    ])
    expect(r).toBeCloseTo(1, 6)
  })

  it('returns -1 for perfectly inverted pairs', () => {
    const r = pearsonR([
      { judge: 0.2, human: 0.8 },
      { judge: 0.5, human: 0.5 },
      { judge: 0.8, human: 0.2 },
    ])
    expect(r).toBeCloseTo(-1, 6)
  })

  it('returns null when one rater has zero variance (denominator = 0)', () => {
    // human is constant — no chance to correlate.
    expect(
      pearsonR([
        { judge: 0.2, human: 0.5 },
        { judge: 0.5, human: 0.5 },
        { judge: 0.8, human: 0.5 },
      ]),
    ).toBeNull()
  })
})

describe('cohensKappa', () => {
  it('returns 1 for perfect agreement on 2 labels', () => {
    const k = cohensKappa([
      { judge: 'Helpful', human: 'Helpful' },
      { judge: 'Helpful', human: 'Helpful' },
      { judge: 'Neutral', human: 'Neutral' },
      { judge: 'Neutral', human: 'Neutral' },
    ])
    expect(k).toBeCloseTo(1, 6)
  })

  it('returns 0 when raters agree exactly at chance', () => {
    // Each rater 50/50 with no correlation. Build a 2x2 contingency table:
    //   H=A H=B
    // J=A  1   1
    // J=B  1   1
    // po = 2/4 = 0.5, pe = (2*2+2*2)/16 = 0.5 → κ = 0.
    const k = cohensKappa([
      { judge: 'A', human: 'A' },
      { judge: 'A', human: 'B' },
      { judge: 'B', human: 'A' },
      { judge: 'B', human: 'B' },
    ])
    expect(k).toBeCloseTo(0, 6)
  })

  it('returns null on <2 pairs', () => {
    expect(cohensKappa([])).toBeNull()
    expect(cohensKappa([{ judge: 'A', human: 'A' }])).toBeNull()
  })

  it('returns null when both raters use a single identical label (pe = 1)', () => {
    expect(
      cohensKappa([
        { judge: 'A', human: 'A' },
        { judge: 'A', human: 'A' },
        { judge: 'A', human: 'A' },
      ]),
    ).toBeNull()
  })

  it('handles 3+ categories (multi-class κ)', () => {
    // Mostly-agreeing 3-label set should yield a strong positive κ but < 1.
    const k = cohensKappa([
      { judge: 'Good', human: 'Good' },
      { judge: 'Good', human: 'Good' },
      { judge: 'Mid',  human: 'Mid' },
      { judge: 'Mid',  human: 'Good' }, // one disagreement
      { judge: 'Bad',  human: 'Bad' },
    ])
    expect(k).not.toBeNull()
    expect(k!).toBeGreaterThan(0.5)
    expect(k!).toBeLessThan(1)
  })

  it('works for boolean (true/false) pairs', () => {
    const k = cohensKappa([
      { judge: 'true', human: 'true' },
      { judge: 'true', human: 'true' },
      { judge: 'false', human: 'false' },
      { judge: 'false', human: 'false' },
    ])
    expect(k).toBeCloseTo(1, 6)
  })
})

describe('interpretAgreement', () => {
  it('buckets values into the standard rule-of-thumb labels', () => {
    expect(interpretAgreement(0)).toBe('none')
    expect(interpretAgreement(0.1)).toBe('none')
    expect(interpretAgreement(0.25)).toBe('weak')
    expect(interpretAgreement(0.5)).toBe('moderate')
    expect(interpretAgreement(0.8)).toBe('strong')
    // negative magnitudes use |value|.
    expect(interpretAgreement(-0.75)).toBe('strong')
  })
})

describe('computeAgreement', () => {
  it('routes numeric to Pearson', () => {
    const out = computeAgreement({
      type: 'numeric',
      numericPairs: [
        { judge: 0.2, human: 0.2 },
        { judge: 0.5, human: 0.5 },
        { judge: 0.9, human: 0.9 },
      ],
    })
    expect(out).not.toBeNull()
    expect(out!.metric).toBe('pearson')
    expect(out!.value).toBeCloseTo(1, 6)
    expect(out!.interpretation).toBe('strong')
    expect(out!.n).toBe(3)
  })

  it('routes categorical and boolean to κ', () => {
    const cat = computeAgreement({
      type: 'categorical',
      labelPairs: [
        { judge: 'Good', human: 'Good' },
        { judge: 'Bad', human: 'Bad' },
      ],
    })
    expect(cat?.metric).toBe('kappa')

    const bool = computeAgreement({
      type: 'boolean',
      labelPairs: [
        { judge: 'true', human: 'true' },
        { judge: 'false', human: 'false' },
      ],
    })
    expect(bool?.metric).toBe('kappa')
  })

  it('returns null when the underlying metric is undefined', () => {
    expect(computeAgreement({ type: 'numeric', numericPairs: [] })).toBeNull()
    expect(
      computeAgreement({ type: 'categorical', labelPairs: [{ judge: 'A', human: 'A' }, { judge: 'A', human: 'A' }] }),
    ).toBeNull()
  })
})
