import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock is hoisted to the top of the file by Vitest, so any variables
// referenced inside the factory must be created with vi.hoisted() to avoid
// "Cannot access before initialization" errors.
const mockRpc = vi.hoisted(() => vi.fn())
vi.mock('../lib/db.js', () => ({
  supabaseAdmin: { rpc: mockRpc },
}))

import { detectAnomalies } from '../lib/anomaly.js'

function makeRpcReturn(rows: object[]) {
  return Promise.resolve({ data: rows, error: null })
}

function makeRpcError(message: string) {
  return Promise.resolve({ data: null, error: { message } })
}

// A helper that builds a minimal AnomalyStatsRow with all nulls by default,
// letting individual tests override only the fields they care about.
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider: 'openai',
    model: 'gpt-4o-mini',
    obs_latency_mean: null, obs_latency_count: 0,
    ref_latency_mean: null, ref_latency_stddev: null, ref_latency_count: 0,
    obs_cost_mean: null,    obs_cost_count: 0,
    ref_cost_mean: null,    ref_cost_stddev: null,    ref_cost_count: 0,
    obs_error_rate: null,   obs_all_count: 0,
    ref_error_rate: null,   ref_error_stddev: null,   ref_all_count: 0,
    ...overrides,
  }
}

beforeEach(() => { mockRpc.mockReset() })

describe('detectAnomalies — rpc error', () => {
  it('returns [] and does not throw when rpc fails', async () => {
    mockRpc.mockReturnValue(makeRpcError('connection refused'))
    const result = await detectAnomalies('org-1')
    expect(result).toEqual([])
  })
})

describe('detectAnomalies — no data', () => {
  it('returns [] when rpc returns empty array', async () => {
    mockRpc.mockReturnValue(makeRpcReturn([]))
    expect(await detectAnomalies('org-1')).toEqual([])
  })
})

describe('detectAnomalies — latency', () => {
  it('flags a latency spike above sigma threshold', async () => {
    mockRpc.mockReturnValue(makeRpcReturn([row({
      obs_latency_mean: 800, obs_latency_count: 50,
      ref_latency_mean: 200, ref_latency_stddev: 50, ref_latency_count: 100,
      // deviations = (800 - 200) / 50 = 12σ → well above 3σ
    })]))
    const result = await detectAnomalies('org-1')
    expect(result).toHaveLength(1)
    expect(result[0]!.kind).toBe('latency')
    expect(result[0]!.deviations).toBeCloseTo(12, 1)
  })

  it('does NOT flag latency within threshold', async () => {
    mockRpc.mockReturnValue(makeRpcReturn([row({
      obs_latency_mean: 210, obs_latency_count: 50,
      ref_latency_mean: 200, ref_latency_stddev: 50, ref_latency_count: 100,
      // deviations = (210 - 200) / 50 = 0.2σ → below 3σ
    })]))
    expect(await detectAnomalies('org-1')).toEqual([])
  })

  it('skips latency when reference count below minSamples', async () => {
    mockRpc.mockReturnValue(makeRpcReturn([row({
      obs_latency_mean: 800, obs_latency_count: 10,
      ref_latency_mean: 200, ref_latency_stddev: 50, ref_latency_count: 5, // < 30
    })]))
    expect(await detectAnomalies('org-1')).toEqual([])
  })

  it('skips latency when stddev is null (only 1 reference sample)', async () => {
    mockRpc.mockReturnValue(makeRpcReturn([row({
      obs_latency_mean: 800, obs_latency_count: 10,
      ref_latency_mean: 200, ref_latency_stddev: null, ref_latency_count: 100,
    })]))
    expect(await detectAnomalies('org-1')).toEqual([])
  })
})

describe('detectAnomalies — cost', () => {
  it('flags a cost spike above sigma threshold', async () => {
    mockRpc.mockReturnValue(makeRpcReturn([row({
      obs_cost_mean: 0.05, obs_cost_count: 40,
      ref_cost_mean: 0.01, ref_cost_stddev: 0.002, ref_cost_count: 100,
      // deviations = (0.05 - 0.01) / 0.002 = 20σ
    })]))
    const result = await detectAnomalies('org-1')
    expect(result).toHaveLength(1)
    expect(result[0]!.kind).toBe('cost')
  })
})

describe('detectAnomalies — error rate', () => {
  it('flags an error rate spike (one-sided, upward)', async () => {
    mockRpc.mockReturnValue(makeRpcReturn([row({
      obs_error_rate: 0.5,  obs_all_count: 60,
      ref_error_rate: 0.01, ref_error_stddev: 0.01, ref_all_count: 100,
      // deviations = (0.5 - 0.01) / 0.01 = 49σ
    })]))
    const result = await detectAnomalies('org-1')
    expect(result).toHaveLength(1)
    expect(result[0]!.kind).toBe('error_rate')
  })

  it('does NOT flag a drop in error rate (one-sided)', async () => {
    mockRpc.mockReturnValue(makeRpcReturn([row({
      obs_error_rate: 0.0,  obs_all_count: 50,
      ref_error_rate: 0.10, ref_error_stddev: 0.03, ref_all_count: 100,
      // deviations = (0.0 - 0.10) / 0.03 = -3.3σ → negative → should NOT fire
    })]))
    expect(await detectAnomalies('org-1')).toEqual([])
  })
})

describe('detectAnomalies — sorting', () => {
  it('returns results sorted by |deviations| descending', async () => {
    mockRpc.mockReturnValue(makeRpcReturn([
      row({ provider: 'openai', model: 'gpt-4o',
        obs_latency_mean: 250, obs_latency_count: 50,
        ref_latency_mean: 200, ref_latency_stddev: 10, ref_latency_count: 100,
        // deviations = 5σ
      }),
      row({ provider: 'anthropic', model: 'claude',
        obs_latency_mean: 400, obs_latency_count: 50,
        ref_latency_mean: 200, ref_latency_stddev: 10, ref_latency_count: 100,
        // deviations = 20σ
      }),
    ]))
    const result = await detectAnomalies('org-1')
    expect(result).toHaveLength(2)
    expect(result[0]!.model).toBe('claude')   // 20σ first
    expect(result[1]!.model).toBe('gpt-4o')  // 5σ second
  })
})

describe('detectAnomalies — custom options', () => {
  it('respects custom sigmaThreshold', async () => {
    mockRpc.mockReturnValue(makeRpcReturn([row({
      obs_latency_mean: 220, obs_latency_count: 50,
      ref_latency_mean: 200, ref_latency_stddev: 10, ref_latency_count: 100,
      // deviations = 2σ — below default 3σ but above custom 1σ
    })]))
    const result = await detectAnomalies('org-1', { sigmaThreshold: 1 })
    expect(result).toHaveLength(1)
  })

  it('passes projectId to rpc call', async () => {
    mockRpc.mockReturnValue(makeRpcReturn([]))
    await detectAnomalies('org-1', { projectId: 'proj-abc' })
    expect(mockRpc).toHaveBeenCalledWith(
      'detect_anomaly_stats',
      expect.objectContaining({ p_project_id: 'proj-abc' }),
    )
  })
})
