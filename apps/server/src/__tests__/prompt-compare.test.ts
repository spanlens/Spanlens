import { describe, it, expect } from 'vitest'
import { aggregate } from '../lib/prompt-compare-stats.js'

describe('aggregate (prompt version metrics)', () => {
  const version = { id: 'v1', version: 1, created_at: '2026-04-21T00:00:00Z' }

  it('returns zero metrics when no rows', () => {
    const m = aggregate(version, [])
    expect(m.sampleCount).toBe(0)
    expect(m.avgLatencyMs).toBe(0)
    expect(m.errorRate).toBe(0)
    expect(m.totalCostUsd).toBe(0)
  })

  it('computes averages + error rate correctly', () => {
    const rows = [
      { prompt_version_id: 'v1', latency_ms: 100, cost_usd: 0.01, status_code: 200, prompt_tokens: 50, completion_tokens: 20 },
      { prompt_version_id: 'v1', latency_ms: 200, cost_usd: 0.02, status_code: 200, prompt_tokens: 60, completion_tokens: 30 },
      { prompt_version_id: 'v1', latency_ms: 300, cost_usd: 0.03, status_code: 500, prompt_tokens: 70, completion_tokens: 40 },
    ]
    const m = aggregate(version, rows)
    expect(m.sampleCount).toBe(3)
    expect(m.avgLatencyMs).toBe(200)
    expect(m.errorRate).toBeCloseTo(1 / 3, 3)
    expect(m.avgCostUsd).toBeCloseTo(0.02, 5)
    expect(m.totalCostUsd).toBeCloseTo(0.06, 5)
    expect(m.avgPromptTokens).toBe(60)
    expect(m.avgCompletionTokens).toBe(30)
  })

  it('handles null fields gracefully', () => {
    const rows = [
      { prompt_version_id: 'v1', latency_ms: null, cost_usd: null, status_code: 200, prompt_tokens: null, completion_tokens: null },
      { prompt_version_id: 'v1', latency_ms: 100, cost_usd: 0.01, status_code: 200, prompt_tokens: 50, completion_tokens: 20 },
    ]
    const m = aggregate(version, rows)
    expect(m.sampleCount).toBe(2)
    expect(m.avgLatencyMs).toBe(100) // only the non-null one
    expect(m.errorRate).toBe(0)
    expect(m.avgCostUsd).toBeCloseTo(0.01, 5)
  })

  it('counts 4xx as errors too', () => {
    const rows = [
      { prompt_version_id: 'v1', latency_ms: 100, cost_usd: null, status_code: 404, prompt_tokens: 0, completion_tokens: 0 },
      { prompt_version_id: 'v1', latency_ms: 100, cost_usd: null, status_code: 200, prompt_tokens: 0, completion_tokens: 0 },
    ]
    expect(aggregate(version, rows).errorRate).toBe(0.5)
  })
})
