/**
 * Integration tests for the detect_anomaly_stats PostgreSQL RPC.
 *
 * These tests hit a real local Supabase instance (supabase start required).
 * Each test inserts requests, calls the RPC, then cleans up in afterEach.
 */
import { describe, it, expect, beforeEach, afterEach, inject } from 'vitest'
import { supabaseAdmin } from '../../lib/db.js'
import { insertRequests, cleanupRequests } from './helpers.js'

// ms constants for clarity
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
  await cleanupRequests(orgId)
})

function rpcParams(orgIdArg: string, observationHours = 1, referenceHours = 168) {
  const now = Date.now()
  return {
    p_org_id: orgIdArg,
    p_ref_start: new Date(now - referenceHours * 3_600_000).toISOString(),
    p_obs_start: new Date(now - observationHours * 3_600_000).toISOString(),
    p_project_id: null,
  }
}

describe('detect_anomaly_stats — basic', () => {
  it('returns [] when no requests exist for the org', async () => {
    const { data, error } = await supabaseAdmin.rpc('detect_anomaly_stats', rpcParams(orgId))
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('scopes to organization_id — does not return other orgs data', async () => {
    await insertRequests({ orgId, projectId, apiKeyId, count: 5, latencyMs: 200, createdAtMsAgo: DAYS(3) })
    const { data, error } = await supabaseAdmin.rpc(
      'detect_anomaly_stats',
      rpcParams('00000000-0000-0000-0000-000000000000'),
    )
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('groups by (provider, model) — returns one row per bucket', async () => {
    await Promise.all([
      insertRequests({ orgId, projectId, apiKeyId, provider: 'openai', model: 'gpt-4o', count: 5, latencyMs: 200, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, provider: 'anthropic', model: 'claude-3', count: 5, latencyMs: 300, createdAtMsAgo: DAYS(3) }),
    ])
    const { data, error } = await supabaseAdmin.rpc('detect_anomaly_stats', rpcParams(orgId))
    expect(error).toBeNull()
    expect((data as unknown[]).length).toBe(2)
    const providers = (data as { provider: string }[]).map((r) => r.provider).sort()
    expect(providers).toEqual(['anthropic', 'openai'])
  })
})

describe('detect_anomaly_stats — window partitioning', () => {
  it('places requests in correct window based on created_at', async () => {
    // Reference window: 3 days ago (before obs_start = now - 1h)
    // Observation window: 30 min ago (after obs_start)
    await Promise.all([
      insertRequests({ orgId, projectId, apiKeyId, count: 10, latencyMs: 200, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 5, latencyMs: 800, createdAtMsAgo: MINUTES(30) }),
    ])
    const { data } = await supabaseAdmin.rpc('detect_anomaly_stats', rpcParams(orgId))
    const row = (data as {
      ref_latency_count: number
      ref_latency_mean: number
      obs_latency_count: number
      obs_latency_mean: number
    }[])[0]!
    expect(row.ref_latency_count).toBe(10)
    expect(row.ref_latency_mean).toBeCloseTo(200, 0)
    expect(row.obs_latency_count).toBe(5)
    expect(row.obs_latency_mean).toBeCloseTo(800, 0)
  })

  it('excludes data older than referenceHours', async () => {
    // 8 days ago — outside 7-day reference window
    await insertRequests({ orgId, projectId, apiKeyId, count: 5, latencyMs: 999, createdAtMsAgo: DAYS(8) })
    const { data } = await supabaseAdmin.rpc('detect_anomaly_stats', rpcParams(orgId))
    expect((data as unknown[]).length).toBe(0)
  })
})

describe('detect_anomaly_stats — latency aggregation', () => {
  it('computes correct reference mean', async () => {
    // 10 at 100ms + 10 at 300ms → mean = 200ms
    await Promise.all([
      insertRequests({ orgId, projectId, apiKeyId, count: 10, latencyMs: 100, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 10, latencyMs: 300, createdAtMsAgo: DAYS(3) }),
    ])
    const { data } = await supabaseAdmin.rpc('detect_anomaly_stats', rpcParams(orgId))
    const row = (data as { ref_latency_mean: number }[])[0]!
    expect(row.ref_latency_mean).toBeCloseTo(200, 0)
  })

  it('computes STDDEV_SAMP with Bessel correction', async () => {
    // 50 at 175ms + 50 at 225ms → mean=200ms, stddev≈25.1ms
    // Variance = (50*(175-200)² + 50*(225-200)²) / (100-1) = 62500/99 ≈ 631.3
    // STDDEV_SAMP = √631.3 ≈ 25.1ms
    await Promise.all([
      insertRequests({ orgId, projectId, apiKeyId, count: 50, latencyMs: 175, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 50, latencyMs: 225, createdAtMsAgo: DAYS(3) }),
    ])
    const { data } = await supabaseAdmin.rpc('detect_anomaly_stats', rpcParams(orgId))
    const row = (data as { ref_latency_mean: number; ref_latency_stddev: number }[])[0]!
    expect(row.ref_latency_mean).toBeCloseTo(200, 0)
    expect(row.ref_latency_stddev).toBeCloseTo(25.1, 0)
  })

  it('returns null stddev when reference has exactly 1 row (STDDEV_SAMP undefined)', async () => {
    await insertRequests({ orgId, projectId, apiKeyId, count: 1, latencyMs: 200, createdAtMsAgo: DAYS(3) })
    const { data } = await supabaseAdmin.rpc('detect_anomaly_stats', rpcParams(orgId))
    const row = (data as { ref_latency_stddev: number | null }[])[0]!
    expect(row.ref_latency_stddev).toBeNull()
  })

  it('excludes failed requests (status_code >= 400) from latency', async () => {
    await Promise.all([
      insertRequests({ orgId, projectId, apiKeyId, count: 5, latencyMs: 200, statusCode: 200, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 5, latencyMs: 9999, statusCode: 500, createdAtMsAgo: DAYS(3) }),
    ])
    const { data } = await supabaseAdmin.rpc('detect_anomaly_stats', rpcParams(orgId))
    const row = (data as { ref_latency_count: number; ref_latency_mean: number }[])[0]!
    // Only the 5 successful rows should contribute
    expect(row.ref_latency_count).toBe(5)
    expect(row.ref_latency_mean).toBeCloseTo(200, 0)
  })
})

describe('detect_anomaly_stats — error rate', () => {
  it('includes ALL rows regardless of status_code', async () => {
    await Promise.all([
      insertRequests({ orgId, projectId, apiKeyId, count: 9, latencyMs: 100, statusCode: 200, createdAtMsAgo: DAYS(3) }),
      insertRequests({ orgId, projectId, apiKeyId, count: 1, latencyMs: 10, statusCode: 500, createdAtMsAgo: DAYS(3) }),
    ])
    const { data } = await supabaseAdmin.rpc('detect_anomaly_stats', rpcParams(orgId))
    const row = (data as { ref_all_count: number; ref_error_rate: number }[])[0]!
    expect(row.ref_all_count).toBe(10)
    expect(row.ref_error_rate).toBeCloseTo(0.1, 2) // 10% error rate
  })
})
