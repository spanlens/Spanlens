import { describe, expect, test } from 'vitest'
import { aggregateByProvider } from '../aggregate.js'

/**
 * /api/v1/stats/models returns one row per (provider, model), the shape
 * built in apps/server/src/api/stats.ts `/models`:
 *   { provider, model, requests, totalCostUsd, avgLatencyMs, errorRate }
 * get_stats(groupBy='provider') used to hand those rows back unchanged
 * (C17.5), leaving the LLM to sum them and, worse, to average the averages.
 */

const row = (
  provider: string,
  model: string,
  requests: number,
  totalCostUsd: number,
  avgLatencyMs: number,
  errorRate: number,
): Record<string, unknown> => ({ provider, model, requests, totalCostUsd, avgLatencyMs, errorRate })

describe('aggregateByProvider', () => {
  test('sums volume and cost, and weights latency and error rate by requests', () => {
    const out = aggregateByProvider([
      row('openai', 'gpt-4o', 100, 1.5, 800, 0.1), // 10 errors
      row('anthropic', 'claude-sonnet-4-5', 10, 0.9, 1200, 0.5), // 5 errors
      row('openai', 'gpt-4o-mini', 300, 0.3, 400, 0), // 0 errors
    ])

    expect(out).toEqual([
      {
        provider: 'openai',
        models: ['gpt-4o', 'gpt-4o-mini'],
        requests: 400,
        totalCostUsd: 1.8,
        // (800*100 + 400*300) / 400 = 500. A plain mean of the two rows would say 600.
        avgLatencyMs: 500,
        // 10 / 400. A plain mean of the two rows would say 0.05.
        errorRate: 0.025,
      },
      {
        provider: 'anthropic',
        models: ['claude-sonnet-4-5'],
        requests: 10,
        totalCostUsd: 0.9,
        avgLatencyMs: 1200,
        errorRate: 0.5,
      },
    ])
  })

  test('recovers exact error counts from non-terminating rates', () => {
    // 1/3 and 2/3 are not exact in binary; the roll-up must still be 3/9.
    const out = aggregateByProvider([
      row('groq', 'llama-a', 3, 0, 100, 1 / 3),
      row('groq', 'llama-b', 6, 0, 100, 2 / 3),
    ])
    expect(out[0]?.errorRate).toBe(5 / 9)
  })

  test('cost sums are rounded to the server precision (6 dp)', () => {
    const out = aggregateByProvider([
      row('openai', 'a', 1, 0.1, 0, 0),
      row('openai', 'b', 1, 0.2, 0, 0),
    ])
    expect(out[0]?.totalCostUsd).toBe(0.3)
  })

  test('orders providers by cost, highest first', () => {
    const out = aggregateByProvider([
      row('mistral', 'm', 1, 0.01, 0, 0),
      row('gemini', 'g', 1, 2, 0, 0),
      row('xai', 'x', 1, 0.5, 0, 0),
    ])
    expect(out.map((r) => r.provider)).toEqual(['gemini', 'xai', 'mistral'])
  })

  test('accepts numeric strings and treats missing numbers as zero', () => {
    const out = aggregateByProvider([
      { provider: 'openai', model: 'a', requests: '4', totalCostUsd: '0.004', avgLatencyMs: '250', errorRate: '0.25' },
      { provider: 'openai', model: 'b' },
    ])
    expect(out).toEqual([
      { provider: 'openai', models: ['a', 'b'], requests: 4, totalCostUsd: 0.004, avgLatencyMs: 250, errorRate: 0.25 },
    ])
  })

  test('an empty window gives an empty list', () => {
    expect(aggregateByProvider([])).toEqual([])
  })

  test('a provider whose rows all report zero requests does not divide by zero', () => {
    const out = aggregateByProvider([row('openai', 'a', 0, 0, 0, 0)])
    expect(out[0]).toMatchObject({ requests: 0, avgLatencyMs: 0, errorRate: 0 })
  })

  test('rejects a response that is not a list of rows', () => {
    expect(() => aggregateByProvider({ rows: [] })).toThrow(/stats\/models/)
    expect(() => aggregateByProvider([1, 2])).toThrow(/stats\/models/)
  })
})
