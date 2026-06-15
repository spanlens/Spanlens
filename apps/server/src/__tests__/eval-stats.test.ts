import { describe, expect, it } from 'vitest'
import { sampleStdDev, confidenceMargin95 } from '../lib/eval-runners/stats.js'

describe('sampleStdDev', () => {
  it('returns null for fewer than 2 values', () => {
    expect(sampleStdDev([])).toBeNull()
    expect(sampleStdDev([0.5])).toBeNull()
  })

  it('returns 0 when all values are identical', () => {
    expect(sampleStdDev([0.8, 0.8, 0.8, 0.8])).toBe(0)
  })

  it('computes the Bessel-corrected (n-1) sample stddev', () => {
    // Known set: [2, 4, 4, 4, 5, 5, 7, 9]. Population stddev = 2, but the
    // sample (n-1) stddev is sqrt(32/7) ≈ 2.13809.
    const s = sampleStdDev([2, 4, 4, 4, 5, 5, 7, 9])
    expect(s).toBeCloseTo(2.13809, 4)
  })

  it('handles 0/1 boolean-derived values (pass-rate spread)', () => {
    // 2 passes, 2 fails → mean 0.5, sample variance = (4 * 0.25)/3 = 1/3.
    const s = sampleStdDev([1, 1, 0, 0])
    expect(s).toBeCloseTo(Math.sqrt(1 / 3), 6)
  })
})

describe('confidenceMargin95', () => {
  it('returns null when stddev is null or n < 2', () => {
    expect(confidenceMargin95(null, 50)).toBeNull()
    expect(confidenceMargin95(0.1, 1)).toBeNull()
    expect(confidenceMargin95(Number.NaN, 50)).toBeNull()
  })

  it('computes 1.96 * stddev / sqrt(n)', () => {
    // stddev 0.2, n 100 → 1.96 * 0.2 / 10 = 0.0392.
    expect(confidenceMargin95(0.2, 100)).toBeCloseTo(0.0392, 6)
  })

  it('shrinks the margin as the sample grows (same spread)', () => {
    const small = confidenceMargin95(0.2, 9)!
    const large = confidenceMargin95(0.2, 900)!
    expect(large).toBeLessThan(small)
    // 100x the samples → 10x tighter interval.
    expect(small / large).toBeCloseTo(10, 5)
  })

  it('is 0 when there is no spread', () => {
    expect(confidenceMargin95(0, 50)).toBe(0)
  })
})
