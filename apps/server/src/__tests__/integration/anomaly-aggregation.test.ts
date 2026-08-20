/**
 * Integration tests for the aggregation semantics behind detectAnomalies().
 *
 * These cover the *mechanics* of the GROUP BY scan in lib/anomaly.ts — org
 * scoping, per-(provider, model) bucketing, which window a row lands in,
 * how the reference mean and stddev are computed, and which rows each metric
 * is allowed to count. The sibling file `anomaly-e2e.test.ts` covers the
 * outcomes on top of those mechanics (does a spike get flagged, is the sort
 * order right, does the sigma threshold hold).
 *
 * Everything here is asserted through the public `detectAnomalies()` return
 * value rather than against the SQL directly, so the aggregate numbers are
 * read off `baselineMean` / `baselineStdDev` / `referenceCount` /
 * `sampleCount` of a bucket that actually surfaced. That means each fixture
 * has to be shaped so an anomaly fires — the assertions are never weakened
 * to make a bucket appear.
 *
 * These tests hit a real local Supabase instance (supabase start required).
 * Each test inserts requests, calls detectAnomalies, then cleans up in
 * afterEach.
 */
import { describe, it, expect, beforeEach, afterEach, inject } from 'vitest'
import { detectAnomalies, type AnomalyBucket } from '../../lib/anomaly.js'
import { insertRequests, cleanupRequests } from './helpers.js'

// ms constants for clarity
const DAYS = (n: number) => n * 86_400_000
const MINUTES = (n: number) => n * 60_000

/**
 * Sample stddev of the recurring 50×175ms + 50×225ms reference fixture,
 * computed by hand with Bessel's correction:
 *
 *   variance = (50·(175−200)² + 50·(225−200)²) / (100 − 1) = 62500 / 99
 *
 * The population stddev of the same 100 values is exactly 25; dividing by
 * n−1 instead of n is what makes this slightly larger.
 */
const SD_175_225 = Math.sqrt(62500 / 99)

/** An org id that owns nothing, used as the negative side of the scoping test. */
const FOREIGN_ORG_ID = '00000000-0000-0000-0000-000000000000'

let orgId: string
let projectId: string
let apiKeyId: string

beforeEach(() => {
  const f = inject('fixtures')
  orgId = f.orgId
  projectId = f.projectId
  apiKeyId = f.apiKeyId
})

afterEach(async () => {
  await cleanupRequests(orgId)
})

function latencyBuckets(result: AnomalyBucket[]): AnomalyBucket[] {
  return result.filter((a) => a.kind === 'latency')
}

function bucketFor(result: AnomalyBucket[], kind: string, model?: string): AnomalyBucket | undefined {
  return result.find((a) => a.kind === kind && (model === undefined || a.model === model))
}

describe('anomaly aggregation — tenant scoping', () => {
  it('scopes to organization_id — a different org sees none of this org data', async () => {
    // A textbook latency spike for the fixture org: reference mean 200ms,
    // observation 800ms.
    await Promise.all([
      insertRequests({ orgId, projectId, apiKeyId, count: 50, latencyMs: 175, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 50, latencyMs: 225, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 5, latencyMs: 800, createdAtMsAgo: MINUTES(30) }),
    ])

    // Positive control: the fixture really does produce an anomaly, so an
    // empty result for the other org means isolation and not a dead fixture.
    const mine = await detectAnomalies(orgId)
    expect(bucketFor(mine, 'latency')).toBeDefined()

    const theirs = await detectAnomalies(FOREIGN_ORG_ID)
    expect(theirs).toEqual([])
  })
})

describe('anomaly aggregation — grouping', () => {
  it('groups by (provider, model) — one bucket per pair, each with its own baseline', async () => {
    // Two buckets with deliberately different baselines. If the scan
    // aggregated across providers instead of grouping, both buckets would
    // report the same pooled mean (~550ms) rather than 200 and 900.
    await Promise.all([
      // openai/gpt-4o — reference mean 200ms, observation 800ms
      insertRequests({ orgId, projectId, apiKeyId, provider: 'openai', model: 'gpt-4o', count: 6, latencyMs: 175, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, provider: 'openai', model: 'gpt-4o', count: 6, latencyMs: 225, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, provider: 'openai', model: 'gpt-4o', count: 3, latencyMs: 800, createdAtMsAgo: MINUTES(30) }),
      // anthropic/claude-3 — reference mean 900ms, observation 2000ms
      insertRequests({ orgId, projectId, apiKeyId, provider: 'anthropic', model: 'claude-3', count: 6, latencyMs: 875, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, provider: 'anthropic', model: 'claude-3', count: 6, latencyMs: 925, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, provider: 'anthropic', model: 'claude-3', count: 3, latencyMs: 2000, createdAtMsAgo: MINUTES(30) }),
    ])

    const result = await detectAnomalies(orgId)
    const latency = latencyBuckets(result)

    // Exactly one bucket per (provider, model) pair — no duplicates.
    expect(latency.map((a) => `${a.provider}/${a.model}`).sort()).toEqual([
      'anthropic/claude-3',
      'openai/gpt-4o',
    ])

    const openai = latency.find((a) => a.provider === 'openai')!
    expect(openai.baselineMean).toBeCloseTo(200, 6)
    expect(openai.currentValue).toBeCloseTo(800, 6)
    expect(openai.referenceCount).toBe(12)
    expect(openai.sampleCount).toBe(3)

    const anthropic = latency.find((a) => a.provider === 'anthropic')!
    expect(anthropic.baselineMean).toBeCloseTo(900, 6)
    expect(anthropic.currentValue).toBeCloseTo(2000, 6)
    expect(anthropic.referenceCount).toBe(12)
    expect(anthropic.sampleCount).toBe(3)
  })
})

describe('anomaly aggregation — window partitioning', () => {
  it('assigns each row to the observation or reference window by created_at', async () => {
    // Observation window is the last hour. The 90-minute-old rows sit just
    // outside it and must fall on the reference side; the 30-minute-old rows
    // sit just inside it. Both carry latencies chosen so the counts, not the
    // means, are what distinguishes a misplaced row.
    await Promise.all([
      insertRequests({ orgId, projectId, apiKeyId, count: 6, latencyMs: 175, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 6, latencyMs: 225, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 2, latencyMs: 200, createdAtMsAgo: MINUTES(90) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 5, latencyMs: 800, createdAtMsAgo: MINUTES(30) }),
    ])

    const latency = bucketFor(await detectAnomalies(orgId), 'latency')!
    // 12 old rows + the 2 that are 90 minutes old — all before obsStart.
    expect(latency.referenceCount).toBe(14)
    expect(latency.baselineMean).toBeCloseTo(200, 6)
    // Only the 5 rows inside the last hour.
    expect(latency.sampleCount).toBe(5)
    expect(latency.currentValue).toBeCloseTo(800, 6)
  })

  it('excludes rows older than referenceHours from the reference window', async () => {
    // 12 rows inside the default 7-day reference window (mean 200ms) and 20
    // rows 8 days old (100ms). The org is on the free plan, whose 14-day
    // retention still admits the 8-day-old rows, so referenceHours is the
    // only thing that can exclude them.
    await Promise.all([
      insertRequests({ orgId, projectId, apiKeyId, count: 6, latencyMs: 175, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 6, latencyMs: 225, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 20, latencyMs: 100, createdAtMsAgo: DAYS(8) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 5, latencyMs: 800, createdAtMsAgo: MINUTES(30) }),
    ])

    const defaultWindow = bucketFor(await detectAnomalies(orgId), 'latency')!
    expect(defaultWindow.referenceCount).toBe(12)
    expect(defaultWindow.baselineMean).toBeCloseTo(200, 6)

    // Positive control: widening referenceHours to 10 days pulls exactly
    // those 20 rows in, which both raises the count and drags the mean down
    // to (12·200 + 20·100) / 32 = 137.5. Without this the assertion above
    // could not tell "excluded by the window" from "never inserted".
    const widerWindow = bucketFor(await detectAnomalies(orgId, { referenceHours: 240 }), 'latency')!
    expect(widerWindow.referenceCount).toBe(32)
    expect(widerWindow.baselineMean).toBeCloseTo(137.5, 6)
  })
})

describe('anomaly aggregation — reference statistics', () => {
  it('computes the reference mean over the whole reference window', async () => {
    // 10 rows at 100ms + 10 at 300ms → mean 200ms. Two distinct values, so a
    // mean that merely echoed one of them would be visibly wrong.
    await Promise.all([
      insertRequests({ orgId, projectId, apiKeyId, count: 10, latencyMs: 100, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 10, latencyMs: 300, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 5, latencyMs: 900, createdAtMsAgo: MINUTES(30) }),
    ])

    const latency = bucketFor(await detectAnomalies(orgId), 'latency')!
    expect(latency.referenceCount).toBe(20)
    expect(latency.baselineMean).toBeCloseTo(200, 6)
  })

  it('computes the reference stddev with Bessel correction (stddev_samp, n−1)', async () => {
    // 50 at 175ms + 50 at 225ms → mean 200ms, sample stddev √(62500/99).
    await Promise.all([
      insertRequests({ orgId, projectId, apiKeyId, count: 50, latencyMs: 175, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 50, latencyMs: 225, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 5, latencyMs: 800, createdAtMsAgo: MINUTES(30) }),
    ])

    const latency = bucketFor(await detectAnomalies(orgId), 'latency')!
    expect(latency.referenceCount).toBe(100)
    expect(latency.baselineMean).toBeCloseTo(200, 6)
    expect(latency.baselineStdDev).toBeCloseTo(SD_175_225, 6)
    // The distinguishing bit: an uncorrected (population) stddev would be
    // exactly 25 here, so anything ≤ 25 means the n−1 divisor was lost.
    expect(latency.baselineStdDev).toBeGreaterThan(25)
    // And the σ count the caller sees is derived from that same stddev.
    expect(latency.deviations).toBeCloseTo((800 - 200) / SD_175_225, 6)
  })

  it('surfaces no latency anomaly for a reference window holding a single sample', async () => {
    // stddev_samp over one row is NULL, so no σ count can be formed — the
    // bucket has to drop out no matter how extreme the observation is.
    // A sibling bucket with a 12-row reference gets the identical
    // observation, so the two differ only in the size of their reference.
    await Promise.all([
      insertRequests({ orgId, projectId, apiKeyId, model: 'one-sample', count: 1, latencyMs: 200, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, model: 'one-sample', count: 10, latencyMs: 5000, createdAtMsAgo: MINUTES(30) }),
      insertRequests({ orgId, projectId, apiKeyId, model: 'many-samples', count: 6, latencyMs: 175, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, model: 'many-samples', count: 6, latencyMs: 225, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, model: 'many-samples', count: 10, latencyMs: 5000, createdAtMsAgo: MINUTES(30) }),
    ])

    // minSamples is dropped to 1 and the threshold to 0.5σ so the reference
    // size gate cannot be what suppresses the single-sample bucket.
    const result = await detectAnomalies(orgId, { minSamples: 1, sigmaThreshold: 0.5 })

    expect(bucketFor(result, 'latency', 'one-sample')).toBeUndefined()

    const many = bucketFor(result, 'latency', 'many-samples')!
    expect(many.referenceCount).toBe(12)
    expect(many.baselineStdDev).toBeGreaterThan(0)
    expect(Number.isFinite(many.baselineStdDev)).toBe(true)
  })
})

describe('anomaly aggregation — status_code handling', () => {
  it('excludes failed requests (status_code >= 400) from the latency statistics', async () => {
    // 40 failures at ~100 seconds sit in the reference window and 5 more in
    // the observation window. Counting them would move the reference mean
    // from 200ms to roughly 28 seconds and the observation mean from 800ms
    // to roughly 50 seconds.
    await Promise.all([
      insertRequests({ orgId, projectId, apiKeyId, count: 50, latencyMs: 175, statusCode: 200, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 50, latencyMs: 225, statusCode: 200, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 40, latencyMs: 99_999, statusCode: 500, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 5, latencyMs: 800, statusCode: 200, createdAtMsAgo: MINUTES(30) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 5, latencyMs: 99_999, statusCode: 500, createdAtMsAgo: MINUTES(30) }),
    ])

    const latency = bucketFor(await detectAnomalies(orgId), 'latency')!
    expect(latency.referenceCount).toBe(100)
    expect(latency.baselineMean).toBeCloseTo(200, 6)
    expect(latency.baselineStdDev).toBeCloseTo(SD_175_225, 6)
    expect(latency.sampleCount).toBe(5)
    expect(latency.currentValue).toBeCloseTo(800, 6)
  })

  it('counts ALL rows regardless of status_code for the error-rate metric', async () => {
    // One fixture, two metrics off the same bucket:
    //   error rate — 99 successes + 1 failure = 100 reference rows, rate 0.01
    //   latency    — the 99 successes only
    // The pair of referenceCounts is the assertion; a success-only error rate
    // would report 99 and a rate of 0.
    await Promise.all([
      insertRequests({ orgId, projectId, apiKeyId, count: 50, latencyMs: 175, statusCode: 200, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 49, latencyMs: 225, statusCode: 200, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 1, latencyMs: 300, statusCode: 500, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 5, latencyMs: 800, statusCode: 200, createdAtMsAgo: MINUTES(30) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 5, latencyMs: 800, statusCode: 500, createdAtMsAgo: MINUTES(30) }),
    ])

    const result = await detectAnomalies(orgId)

    const errorRate = bucketFor(result, 'error_rate')!
    expect(errorRate.referenceCount).toBe(100)
    expect(errorRate.sampleCount).toBe(10)
    expect(errorRate.baselineMean).toBeCloseTo(0.01, 6)
    expect(errorRate.currentValue).toBeCloseTo(0.5, 6)
    // Bernoulli indicator with Bessel correction:
    //   variance = (99·0.01² + 1·0.99²) / 99 = 0.99 / 99 = 0.01
    expect(errorRate.baselineStdDev).toBeCloseTo(0.1, 6)

    // Same bucket, success-only metric: the failure is not there.
    const latency = bucketFor(result, 'latency')!
    expect(latency.referenceCount).toBe(99)
    expect(latency.sampleCount).toBe(5)
  })
})
