import { describe, it, expect } from 'vitest'
import { computeStats, groupByBucket } from '../lib/anomaly-stats.js'

describe('computeStats', () => {
  it('returns zero stats for empty array', () => {
    const s = computeStats([])
    expect(s).toEqual({ mean: 0, stdDev: 0, count: 0 })
  })

  it('computes mean for single sample, stddev=0', () => {
    const s = computeStats([42])
    expect(s.mean).toBe(42)
    expect(s.stdDev).toBe(0)
    expect(s.count).toBe(1)
  })

  it('computes sample stddev (n-1) correctly', () => {
    // values: 2,4,4,4,5,5,7,9 → mean=5, population stddev=2, sample stddev=~2.138
    const s = computeStats([2, 4, 4, 4, 5, 5, 7, 9])
    expect(s.mean).toBe(5)
    expect(s.stdDev).toBeCloseTo(2.138, 2)
    expect(s.count).toBe(8)
  })
})

describe('groupByBucket', () => {
  it('groups rows by provider|model', () => {
    const rows = [
      { provider: 'openai', model: 'gpt-4o', extra: 100 },
      { provider: 'openai', model: 'gpt-4o', extra: 200 },
      { provider: 'anthropic', model: 'claude-3-5', extra: 150 },
    ]
    const out = groupByBucket(rows)
    expect(out.size).toBe(2)
    expect(out.get('openai|gpt-4o')?.length).toBe(2)
    expect(out.get('anthropic|claude-3-5')?.length).toBe(1)
  })

  it('returns empty map for empty input', () => {
    expect(groupByBucket([]).size).toBe(0)
  })
})

describe('3-sigma math sanity', () => {
  it('value 3 stddev above mean triggers threshold', () => {
    const reference = [10, 10, 10, 10, 10, 11, 11, 11, 9, 9] // sum=101, mean=10.1
    const ref = computeStats(reference)
    expect(ref.mean).toBeCloseTo(10.1, 2)
    expect(ref.stdDev).toBeGreaterThan(0.5)

    // Observation: 15 → (15 - 10.2) / 0.79 ≈ 6.1 sigma → well past 3
    const deviations = (15 - ref.mean) / ref.stdDev
    expect(Math.abs(deviations)).toBeGreaterThan(3)
  })

  it('value within 1 stddev does NOT trigger', () => {
    const reference = [100, 101, 99, 102, 98, 100, 101, 99, 100, 100]
    const ref = computeStats(reference)
    const deviations = (101 - ref.mean) / ref.stdDev
    expect(Math.abs(deviations)).toBeLessThan(3)
  })
})

describe('error rate detection (Bernoulli proportion)', () => {
  it('encodes status_code as 0/1 — mean equals error rate', () => {
    const rows = [200, 200, 200, 200, 500, 200, 200, 500].map((c) => (c >= 400 ? 1 : 0))
    const s = computeStats(rows)
    // 2 errors / 8 rows = 25%
    expect(s.mean).toBe(0.25)
  })

  it('flags a clear spike: 1% baseline → 50% current', () => {
    // 1% baseline error rate → stddev ~0.10 with n=100. Spike to 50%
    // produces ~4.9σ deviation, well above the 3σ threshold.
    const baselineRows = [
      ...Array.from({ length: 99 }, () => 0),
      ...Array.from({ length: 1 }, () => 1),
    ]
    const baseline = computeStats(baselineRows)
    expect(baseline.mean).toBeCloseTo(0.01, 5)
    expect(baseline.stdDev).toBeGreaterThan(0)

    const obs = computeStats([
      ...Array.from({ length: 10 }, () => 0),
      ...Array.from({ length: 10 }, () => 1),
    ])
    const deviations = (obs.mean - baseline.mean) / baseline.stdDev
    expect(deviations).toBeGreaterThan(3)
  })

  it('does NOT flag drops in error rate — those are good news', () => {
    // baseline 10% errors → observation 0% errors. Should NOT fire.
    const baselineRows = [
      ...Array.from({ length: 90 }, () => 0),
      ...Array.from({ length: 10 }, () => 1),
    ]
    const baseline = computeStats(baselineRows)
    const obs = computeStats(Array.from({ length: 50 }, () => 0))
    const deviations = (obs.mean - baseline.mean) / baseline.stdDev
    // production code uses one-sided: `deviations >= sigmaThreshold` ;
    // a drop (negative deviations) never fires.
    expect(deviations).toBeLessThan(0)
  })
})
