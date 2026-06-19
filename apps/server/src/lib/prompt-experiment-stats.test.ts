import { describe, expect, it } from 'vitest'
import { errorRateTest, welchTest } from './prompt-experiment-stats.js'

/**
 * Phase 5: prompt-experiment-stats had ZERO tests but drives the customer-visible
 * A/B "winner" verdict (significance block at api/prompt-experiments.ts). A wrong
 * p-value silently mislabels a winner. These pin the math, the guard branches,
 * and two p-values against external (R / SciPy) reference values.
 *
 * Reference (R): 2 * pnorm(-1.96) = 0.0499958 ; 2 * pnorm(-2.576) = 0.0099954
 */

describe('errorRateTest (two-proportion z-test)', () => {
  it('returns the insufficient sentinel below 30 samples per arm', () => {
    expect(errorRateTest(29, 1, 100, 5)).toEqual({ statistic: 0, pValue: 1, significant: false, relativeLift: null })
    expect(errorRateTest(100, 5, 29, 1)).toEqual({ statistic: 0, pValue: 1, significant: false, relativeLift: null })
  })

  it('equal proportions → statistic 0, p 1, not significant, zero lift', () => {
    const r = errorRateTest(100, 10, 100, 10)
    expect(r.statistic).toBe(0)
    expect(r.pValue).toBeCloseTo(1, 5)
    expect(r.significant).toBe(false)
    expect(r.relativeLift).toBe(0)
  })

  it('flags a clearly significant divergence (5% vs 15%)', () => {
    const r = errorRateTest(1000, 50, 1000, 150)
    expect(r.significant).toBe(true)
    expect(r.pValue).toBeLessThan(0.05)
    // pa - pb = 0.05 - 0.15 < 0 → negative z
    expect(r.statistic).toBeLessThan(0)
    // (pb - pa) / pa = (0.15 - 0.05) / 0.05 = 2
    expect(r.relativeLift).toBeCloseTo(2, 6)
  })

  it('relativeLift is null when arm A has zero errors', () => {
    const r = errorRateTest(100, 0, 100, 5)
    expect(r.relativeLift).toBeNull()
  })

  it('se === 0 (no errors in either arm) → zero lift, not significant', () => {
    const r = errorRateTest(100, 0, 100, 0)
    expect(r).toEqual({ statistic: 0, pValue: 1, significant: false, relativeLift: 0 })
  })

  it('matches the R reference p-value at z ≈ 1.96 (two-tailed ≈ 0.05)', () => {
    // Construct proportions giving |z| ≈ 1.96. pa=0.5 (n=100, 50 err),
    // pb chosen so z≈1.96. Easier: assert the produced p-value is within
    // tolerance of the textbook 0.05 for a hand-built near-1.96 case.
    // na=nb=100, errA=40, errB=54: pooled p=0.47, se=sqrt(.47*.53*.02)=0.07060
    // z=(0.40-0.54)/0.07060 = -1.983 → p ≈ 0.0473
    const r = errorRateTest(100, 40, 100, 54)
    expect(r.statistic).toBeCloseTo(-1.983, 2)
    expect(Math.abs(r.pValue - 0.0473)).toBeLessThan(2e-3)
  })
})

describe('welchTest (unequal-variance t-test)', () => {
  it('returns the insufficient sentinel below 10 samples per arm', () => {
    expect(welchTest(9, 100, 10, 50, 100, 10)).toEqual({ statistic: 0, pValue: 1, significant: false, relativeLift: null })
    expect(welchTest(50, 100, 10, 9, 100, 10)).toEqual({ statistic: 0, pValue: 1, significant: false, relativeLift: null })
  })

  it('identical means → statistic 0, p ≈ 1, not significant, zero lift', () => {
    const r = welchTest(50, 100, 400, 50, 100, 400)
    expect(r.statistic).toBe(0)
    expect(r.pValue).toBeCloseTo(1, 5)
    expect(r.significant).toBe(false)
    expect(r.relativeLift).toBe(0)
  })

  it('flags a clearly significant mean difference (1000 vs 1100)', () => {
    const r = welchTest(100, 1000, 10000, 100, 1100, 10000)
    expect(r.significant).toBe(true)
    expect(r.pValue).toBeLessThan(0.05)
    expect(r.statistic).toBeLessThan(0)
    expect(r.relativeLift).toBeCloseTo(0.1, 6)
  })

  it('se === 0 (zero variance both arms) → lift from means, not significant', () => {
    const r = welchTest(10, 5, 0, 10, 7, 0)
    expect(r.significant).toBe(false)
    expect(r.pValue).toBe(1)
    expect(r.relativeLift).toBeCloseTo(0.4, 6) // (7 - 5) / 5
  })

  it('relativeLift is null when meanA === 0', () => {
    const r = welchTest(20, 0, 10, 20, 5, 10)
    expect(r.relativeLift).toBeNull()
  })

  it('uses the small-df path (df < 30) without producing NaN', () => {
    // na=nb=10, high variance → Welch df well under 30. Small t → not significant.
    const r = welchTest(10, 10, 100, 10, 12, 100)
    expect(Number.isFinite(r.pValue)).toBe(true)
    expect(r.pValue).toBeGreaterThan(0)
    expect(r.pValue).toBeLessThanOrEqual(1)
    expect(r.significant).toBe(false)
  })

  it('matches the R reference p-value at t ≈ 1.96 (two-tailed ≈ 0.0500)', () => {
    // na=nb=50, var=25 → se2 = 0.5 each, se = 1, df ≈ 98 (normal path).
    // meanA=100, meanB=101.96 → t = -1.96.
    const r = welchTest(50, 100, 25, 50, 101.96, 25)
    expect(r.statistic).toBeCloseTo(-1.96, 5)
    expect(Math.abs(r.pValue - 0.0499958)).toBeLessThan(1e-3)
  })

  it('matches the R reference p-value at t ≈ 2.576 (two-tailed ≈ 0.0100)', () => {
    const r = welchTest(50, 100, 25, 50, 102.576, 25)
    expect(r.statistic).toBeCloseTo(-2.576, 5)
    expect(Math.abs(r.pValue - 0.0099954)).toBeLessThan(1e-3)
  })
})
