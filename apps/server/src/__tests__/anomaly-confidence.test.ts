import { beforeEach, describe, expect, test, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// P3.2 confidence tier tests.
//
// Two layers tested:
//   1. `classifyConfidence(refCount)` — pure function, exhaustive boundaries.
//   2. `detectAnomalies(...)` — end-to-end via a mocked ClickHouse query,
//      verifying the right confidence tag travels through the detection
//      pipeline AND that <10-sample buckets are still suppressed entirely.
// ─────────────────────────────────────────────────────────────────────────────

const clickhouseQueryMock = vi.fn()

vi.mock('../lib/clickhouse.js', () => ({
  unscopedClickhouse: () => ({
    query: (opts: unknown) => clickhouseQueryMock(opts),
  }),
}))

// detectAnomalies now resolves org + retention scope via requestsScope, which
// internally reads the org plan from Supabase. Stub it so these unit tests
// stay DB-free (the retention bound itself is exercised in anomaly-detect.test.ts).
vi.mock('../lib/requests-query.js', () => ({
  requestsScope: vi.fn(async (orgId: string) => ({
    whereScope:
      'organization_id = {orgId:UUID} AND created_at >= now() - INTERVAL {retentionDays:UInt32} DAY',
    scopeParams: { orgId, retentionDays: 14 },
    plan: 'free',
  })),
}))

let classifyConfidence: typeof import('../lib/anomaly.js').classifyConfidence
let detectAnomalies: typeof import('../lib/anomaly.js').detectAnomalies
let ANOMALY_DEFAULTS: typeof import('../lib/anomaly.js').ANOMALY_DEFAULTS

beforeEach(async () => {
  vi.resetModules()
  clickhouseQueryMock.mockReset()
  ;({ classifyConfidence, detectAnomalies, ANOMALY_DEFAULTS } = await import('../lib/anomaly.js'))
})

/** Build a query result with one anomalous bucket where reference_count is the
 *  variable being tested. All three signals (latency, cost, error_rate) carry
 *  the same refCount so a single ClickHouse mock covers the full code path. */
function singleBucketResult(refCount: number) {
  return {
    json: () => Promise.resolve([
      {
        provider: 'openai',
        model: 'gpt-4o',
        // Anomalous: obs mean is 1000ms, baseline 100ms with 10ms stddev → 90σ
        obs_latency_mean: 1000,
        obs_latency_count: refCount,
        ref_latency_mean: 100,
        ref_latency_stddev: 10,
        ref_latency_count: refCount,
        // Cost not anomalous (within 1σ) so this row exercises only the
        // latency + error_rate branches.
        obs_cost_mean: 0.5,
        obs_cost_count: refCount,
        ref_cost_mean: 0.5,
        ref_cost_stddev: 0.1,
        ref_cost_count: refCount,
        // Error rate spike: 50% errors observed vs 1% baseline (huge σ)
        obs_error_rate: 0.5,
        obs_all_count: refCount,
        ref_error_rate: 0.01,
        ref_error_stddev: 0.05,
        ref_all_count: refCount,
      },
    ]),
  }
}

// ── Pure function tests ──────────────────────────────────────────────────────

describe('classifyConfidence', () => {
  test('returns null when refCount < MIN_SAMPLES_LOW (10)', () => {
    expect(classifyConfidence(0)).toBeNull()
    expect(classifyConfidence(5)).toBeNull()
    expect(classifyConfidence(9)).toBeNull()
  })

  test("returns 'low' for 10..29 reference samples", () => {
    expect(classifyConfidence(10)).toBe('low')
    expect(classifyConfidence(20)).toBe('low')
    expect(classifyConfidence(29)).toBe('low')
  })

  test("returns 'medium' for 30..99 reference samples", () => {
    expect(classifyConfidence(30)).toBe('medium')
    expect(classifyConfidence(50)).toBe('medium')
    expect(classifyConfidence(99)).toBe('medium')
  })

  test("returns 'high' for >= 100 reference samples", () => {
    expect(classifyConfidence(100)).toBe('high')
    expect(classifyConfidence(1_000)).toBe('high')
    expect(classifyConfidence(1_000_000)).toBe('high')
  })

  test('thresholds match the documented constants (regression guard)', () => {
    expect(ANOMALY_DEFAULTS.MIN_SAMPLES_LOW).toBe(10)
    expect(ANOMALY_DEFAULTS.MIN_SAMPLES_MEDIUM).toBe(30)
    expect(ANOMALY_DEFAULTS.MIN_SAMPLES_HIGH).toBe(100)
  })
})

// ── End-to-end via detectAnomalies ───────────────────────────────────────────

describe('detectAnomalies — confidence tier wiring', () => {
  test('refCount=15 surfaces anomalies tagged "low"', async () => {
    clickhouseQueryMock.mockResolvedValue(singleBucketResult(15))
    const anomalies = await detectAnomalies('org_1')
    expect(anomalies.length).toBeGreaterThan(0)
    for (const a of anomalies) {
      expect(a.confidence).toBe('low')
    }
  })

  test('refCount=50 surfaces anomalies tagged "medium"', async () => {
    clickhouseQueryMock.mockResolvedValue(singleBucketResult(50))
    const anomalies = await detectAnomalies('org_1')
    expect(anomalies.length).toBeGreaterThan(0)
    for (const a of anomalies) {
      expect(a.confidence).toBe('medium')
    }
  })

  test('refCount=200 surfaces anomalies tagged "high"', async () => {
    clickhouseQueryMock.mockResolvedValue(singleBucketResult(200))
    const anomalies = await detectAnomalies('org_1')
    expect(anomalies.length).toBeGreaterThan(0)
    for (const a of anomalies) {
      expect(a.confidence).toBe('high')
    }
  })

  test('refCount=5 (below low threshold) suppresses anomalies entirely', async () => {
    clickhouseQueryMock.mockResolvedValue(singleBucketResult(5))
    const anomalies = await detectAnomalies('org_1')
    expect(anomalies).toEqual([])
  })

  test('regression: refCount=29 is "low" not "medium" (boundary)', async () => {
    clickhouseQueryMock.mockResolvedValue(singleBucketResult(29))
    const anomalies = await detectAnomalies('org_1')
    expect(anomalies.length).toBeGreaterThan(0)
    expect(anomalies[0]?.confidence).toBe('low')
  })

  test('regression: refCount=30 is "medium" not "low" (boundary)', async () => {
    clickhouseQueryMock.mockResolvedValue(singleBucketResult(30))
    const anomalies = await detectAnomalies('org_1')
    expect(anomalies.length).toBeGreaterThan(0)
    expect(anomalies[0]?.confidence).toBe('medium')
  })

  test('caller can override minSamples to suppress low-confidence findings', async () => {
    clickhouseQueryMock.mockResolvedValue(singleBucketResult(15))
    // Cron that pages on-call passes minSamples=30 to gate at medium+ only.
    const anomalies = await detectAnomalies('org_1', { minSamples: 30 })
    expect(anomalies).toEqual([])
  })
})
