/**
 * End-to-end integration tests for detectAnomalies() and snapshotAnomaliesForAllOrgs().
 *
 * These tests use a real local Supabase instance. Run: pnpm --filter server test:integration
 */
import { describe, it, expect, beforeEach, afterEach, inject } from 'vitest'
import { detectAnomalies } from '../../lib/anomaly.js'
import { snapshotAnomaliesForAllOrgs } from '../../lib/anomaly-snapshot.js'
import { supabaseAdmin } from '../../lib/db.js'
import { insertRequests, cleanupRequests, cleanupAnomalyEvents } from './helpers.js'

const DAYS = (n: number) => n * 86_400_000
const MINUTES = (n: number) => n * 60_000

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
  await Promise.all([cleanupRequests(orgId), cleanupAnomalyEvents(orgId)])
})

// Creates a clear latency anomaly scenario:
//   Reference: 50×175ms + 50×225ms → mean=200ms, stddev≈25ms
//   Observation (30 min ago): 10×800ms → ~24σ above baseline
async function createLatencyAnomaly() {
  await Promise.all([
    insertRequests({ orgId, projectId, apiKeyId, count: 50, latencyMs: 175, createdAtMsAgo: DAYS(3) }),
    insertRequests({ orgId, projectId, apiKeyId, count: 50, latencyMs: 225, createdAtMsAgo: DAYS(3) }),
    insertRequests({ orgId, projectId, apiKeyId, count: 10, latencyMs: 800, createdAtMsAgo: MINUTES(30) }),
  ])
}

describe('detectAnomalies (E2E)', () => {
  it('returns [] when no requests exist', async () => {
    const result = await detectAnomalies(orgId)
    expect(result).toEqual([])
  })

  it('returns [] when observation is within threshold (< 3σ)', async () => {
    // 210ms observation vs 200ms reference → ~0.4σ — below 3σ threshold
    await Promise.all([
      insertRequests({ orgId, projectId, apiKeyId, count: 50, latencyMs: 175, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 50, latencyMs: 225, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 5, latencyMs: 210, createdAtMsAgo: MINUTES(30) }),
    ])
    const result = await detectAnomalies(orgId)
    expect(result).toEqual([])
  })

  it('detects a clear latency spike', async () => {
    await createLatencyAnomaly()
    const result = await detectAnomalies(orgId)
    const latency = result.find((a) => a.kind === 'latency')
    expect(latency).toBeDefined()
    expect(latency!.provider).toBe('openai')
    expect(latency!.model).toBe('gpt-4o-mini')
    expect(latency!.currentValue).toBeCloseTo(800, 0)
    expect(latency!.baselineMean).toBeCloseTo(200, 0)
    expect(latency!.deviations).toBeGreaterThan(20)
  })

  it('skips latency bucket when reference sample count < minSamples (30)', async () => {
    // Only 5 reference rows — insufficient for reliable stats
    await Promise.all([
      insertRequests({ orgId, projectId, apiKeyId, count: 5, latencyMs: 200, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 3, latencyMs: 800, createdAtMsAgo: MINUTES(30) }),
    ])
    const result = await detectAnomalies(orgId)
    expect(result).toEqual([])
  })

  it('respects a custom sigmaThreshold', async () => {
    // ~0.4σ — below default 3σ but above custom 0.3σ
    await Promise.all([
      insertRequests({ orgId, projectId, apiKeyId, count: 50, latencyMs: 175, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 50, latencyMs: 225, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 5, latencyMs: 210, createdAtMsAgo: MINUTES(30) }),
    ])
    const result = await detectAnomalies(orgId, { sigmaThreshold: 0.3 })
    expect(result.length).toBeGreaterThan(0)
  })

  it('detects an error rate spike (one-sided)', async () => {
    // Reference: 1% error rate (99 OK + 1 error)
    // Observation: 50% error rate (5 OK + 5 error)
    await Promise.all([
      insertRequests({ orgId, projectId, apiKeyId, count: 99, latencyMs: 100, statusCode: 200, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 1, latencyMs: 10, statusCode: 500, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 5, latencyMs: 100, statusCode: 200, createdAtMsAgo: MINUTES(30) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 5, latencyMs: 10, statusCode: 500, createdAtMsAgo: MINUTES(30) }),
    ])
    const result = await detectAnomalies(orgId)
    const errAnomaly = result.find((a) => a.kind === 'error_rate')
    expect(errAnomaly).toBeDefined()
    expect(errAnomaly!.currentValue).toBeCloseTo(0.5, 1)
    expect(errAnomaly!.baselineMean).toBeCloseTo(0.01, 2)
  })

  it('does NOT flag a drop in error rate (one-sided guard)', async () => {
    // Observation has LOWER error rate than reference — should not fire
    await Promise.all([
      insertRequests({ orgId, projectId, apiKeyId, count: 90, latencyMs: 100, statusCode: 200, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 10, latencyMs: 10, statusCode: 500, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 10, latencyMs: 100, statusCode: 200, createdAtMsAgo: MINUTES(30) }),
    ])
    const result = await detectAnomalies(orgId)
    const errAnomaly = result.find((a) => a.kind === 'error_rate')
    expect(errAnomaly).toBeUndefined()
  })

  it('returns anomalies sorted by |deviations| descending', async () => {
    // Two buckets: openai/gpt-4o (small spike) and openai/gpt-4o-mini (large spike)
    await Promise.all([
      // gpt-4o reference: mean=200, stddev≈25
      insertRequests({ orgId, projectId, apiKeyId, provider: 'openai', model: 'gpt-4o', count: 50, latencyMs: 175, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, provider: 'openai', model: 'gpt-4o', count: 50, latencyMs: 225, createdAtMsAgo: DAYS(3) }),
      // gpt-4o obs: 330ms → ~5.2σ
      insertRequests({ orgId, projectId, apiKeyId, provider: 'openai', model: 'gpt-4o', count: 5, latencyMs: 330, createdAtMsAgo: MINUTES(30) }),

      // gpt-4o-mini reference: mean=100, stddev≈13
      insertRequests({ orgId, projectId, apiKeyId, provider: 'openai', model: 'gpt-4o-mini', count: 50, latencyMs: 88, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, provider: 'openai', model: 'gpt-4o-mini', count: 50, latencyMs: 112, createdAtMsAgo: DAYS(3) }),
      // gpt-4o-mini obs: 800ms → huge spike
      insertRequests({ orgId, projectId, apiKeyId, provider: 'openai', model: 'gpt-4o-mini', count: 5, latencyMs: 800, createdAtMsAgo: MINUTES(30) }),
    ])
    const result = await detectAnomalies(orgId)
    expect(result.length).toBeGreaterThanOrEqual(2)
    // Highest deviations first
    expect(Math.abs(result[0]!.deviations)).toBeGreaterThanOrEqual(Math.abs(result[1]!.deviations))
  })
})

describe('snapshotAnomaliesForAllOrgs (E2E)', () => {
  it('persists a detected anomaly into anomaly_events', async () => {
    await createLatencyAnomaly()

    await snapshotAnomaliesForAllOrgs()

    const { data, error } = await supabaseAdmin
      .from('anomaly_events')
      .select('kind, deviations, provider, model')
      .eq('organization_id', orgId)

    expect(error).toBeNull()
    expect(data!.length).toBeGreaterThan(0)
    const row = data!.find((r) => r.kind === 'latency')
    expect(row).toBeDefined()
    expect(row!.provider).toBe('openai')
    expect(Number(row!.deviations)).toBeGreaterThan(20)
  })

  it('is idempotent — second run on same day upserts, not duplicates', async () => {
    await createLatencyAnomaly()

    await snapshotAnomaliesForAllOrgs()
    await snapshotAnomaliesForAllOrgs()

    const { data } = await supabaseAdmin
      .from('anomaly_events')
      .select('id')
      .eq('organization_id', orgId)
      .eq('kind', 'latency')

    // UNIQUE (org, detected_on, provider, model, kind) → second run overwrites, not adds
    expect(data!.length).toBe(1)
  })

  it('skips orgs with no recent traffic (last 24h)', async () => {
    // Only old data — 3 days ago — org won't appear in the 24h scan
    await Promise.all([
      insertRequests({ orgId, projectId, apiKeyId, count: 50, latencyMs: 175, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 50, latencyMs: 225, createdAtMsAgo: DAYS(3) }),
    ])

    await snapshotAnomaliesForAllOrgs()

    const { data } = await supabaseAdmin
      .from('anomaly_events')
      .select('id')
      .eq('organization_id', orgId)

    expect(data!.length).toBe(0)
  })
})
