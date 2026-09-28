import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SpanlensClient } from '../client.js'
import {
  registerTools,
  timeframeToHours,
  hoursAgoIso,
  sinceToObservationHours,
} from '../tools.js'

/**
 * Param-contract tests: every tool is a thin shim over a REST endpoint, so
 * the only thing that can break silently is the (path, query) pair it sends.
 * v0.2.0 shipped exactly that class of bug — get_stats sent a `window` param
 * no endpoint reads, so "spend this week" returned retention-wide totals.
 * These tests pin each tool's outgoing request against the params the server
 * actually parses (apps/server/src/api/{stats,requests,traces,anomalies,
 * recommendations,users}.ts).
 */

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>

function captureTools(client: SpanlensClient): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>()
  const fakeServer = {
    tool: (name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
      handlers.set(name, handler)
    },
  } as unknown as McpServer
  registerTools(fakeServer, client)
  return handlers
}

function fakeClient(
  response: unknown = { ok: true },
): { client: SpanlensClient; calls: Array<{ path: string; query?: Record<string, unknown> }> } {
  const calls: Array<{ path: string; query?: Record<string, unknown> }> = []
  const client = {
    get: async (path: string, query?: Record<string, unknown>) => {
      calls.push({ path, query })
      return response
    },
  } as unknown as SpanlensClient
  return { client, calls }
}

type ToolResult = { content: Array<{ text: string }>; isError?: boolean }

const parseText = (result: unknown): unknown =>
  JSON.parse((result as ToolResult).content[0]?.text ?? 'null')

const NOW = new Date('2026-07-13T12:00:00.000Z').getTime()

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('get_stats param contract', () => {
  test('overview: timeframe becomes a `from` ISO bound, never `window`', async () => {
    const { client, calls } = fakeClient()
    const handlers = captureTools(client)
    await handlers.get('get_stats')!({ timeframe: '7d' })

    expect(calls).toHaveLength(1)
    expect(calls[0].path).toBe('/api/v1/stats/overview')
    expect(calls[0].query).toEqual({ from: new Date(NOW - 168 * 3_600_000).toISOString() })
    expect(calls[0].query).not.toHaveProperty('window')
  })

  test('groupBy: models endpoint gets `hours`, never `window`', async () => {
    const { client, calls } = fakeClient()
    const handlers = captureTools(client)
    await handlers.get('get_stats')!({ timeframe: '24h', groupBy: 'model' })

    expect(calls[0].path).toBe('/api/v1/stats/models')
    expect(calls[0].query).toEqual({ hours: 24 })
  })

  describe('groupBy output (C17.5)', () => {
    // Shape of apps/server/src/api/stats.ts `/models`: one row per (provider, model).
    const MODEL_ROWS = [
      { provider: 'openai', model: 'gpt-4o', requests: 100, totalCostUsd: 1.5, avgLatencyMs: 800, errorRate: 0.1 },
      { provider: 'anthropic', model: 'claude-sonnet-4-5', requests: 10, totalCostUsd: 0.9, avgLatencyMs: 1200, errorRate: 0.5 },
      { provider: 'openai', model: 'gpt-4o-mini', requests: 300, totalCostUsd: 0.3, avgLatencyMs: 400, errorRate: 0 },
    ]

    test("'provider' rolls the per-model rows up to one row per provider", async () => {
      const { client, calls } = fakeClient(MODEL_ROWS)
      const handlers = captureTools(client)
      const result = await handlers.get('get_stats')!({ timeframe: '24h', groupBy: 'provider' })

      expect(calls[0].path).toBe('/api/v1/stats/models')
      expect(calls[0].query).toEqual({ hours: 24 })
      expect(parseText(result)).toEqual([
        { provider: 'openai', models: ['gpt-4o', 'gpt-4o-mini'], requests: 400, totalCostUsd: 1.8, avgLatencyMs: 500, errorRate: 0.025 },
        { provider: 'anthropic', models: ['claude-sonnet-4-5'], requests: 10, totalCostUsd: 0.9, avgLatencyMs: 1200, errorRate: 0.5 },
      ])
    })

    test("'model' keeps the per (provider, model) rows as the server sent them", async () => {
      const { client } = fakeClient(MODEL_ROWS)
      const handlers = captureTools(client)
      const result = await handlers.get('get_stats')!({ groupBy: 'model' })

      expect(parseText(result)).toEqual(MODEL_ROWS)
    })

    test("'provider' reports an unexpected response shape as a tool error", async () => {
      const { client } = fakeClient({ not: 'rows' })
      const handlers = captureTools(client)
      const result = (await handlers.get('get_stats')!({ groupBy: 'provider' })) as ToolResult

      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toContain('/api/v1/stats/models')
    })
  })

  test('default timeframe is 7d', async () => {
    const { client, calls } = fakeClient()
    const handlers = captureTools(client)
    await handlers.get('get_stats')!({})

    expect(calls[0].query).toEqual({ from: new Date(NOW - 168 * 3_600_000).toISOString() })
  })
})

describe('get_anomalies param contract', () => {
  test('since maps to observationHours; sigma passes through', async () => {
    const { client, calls } = fakeClient()
    const handlers = captureTools(client)
    const sixHoursAgo = new Date(NOW - 6 * 3_600_000).toISOString()
    await handlers.get('get_anomalies')!({ since: sixHoursAgo, sigma: 2 })

    expect(calls[0].path).toBe('/api/v1/anomalies')
    expect(calls[0].query).toEqual({ observationHours: 6, sigma: 2 })
    // v0.2.0 sent `severity`/`from`, which the endpoint never read.
    expect(calls[0].query).not.toHaveProperty('severity')
    expect(calls[0].query).not.toHaveProperty('from')
  })

  test('no args sends no params (server defaults apply)', async () => {
    const { client, calls } = fakeClient()
    const handlers = captureTools(client)
    await handlers.get('get_anomalies')!({})

    expect(calls[0].query).toEqual({ observationHours: undefined, sigma: undefined })
  })
})

describe('other tools keep server-parsed param names', () => {
  test('query_requests sends from (not since) + supported filters', async () => {
    const { client, calls } = fakeClient()
    const handlers = captureTools(client)
    await handlers.get('query_requests')!({
      limit: 5,
      provider: 'groq',
      status: 'error',
      since: '2026-07-01T00:00:00Z',
    })

    expect(calls[0].path).toBe('/api/v1/requests')
    expect(calls[0].query).toMatchObject({
      limit: 5,
      provider: 'groq',
      status: 'error',
      from: '2026-07-01T00:00:00Z',
    })
  })

  test('list_traces sends from/q', async () => {
    const { client, calls } = fakeClient()
    const handlers = captureTools(client)
    await handlers.get('list_traces')!({ since: '2026-07-01T00:00:00Z', query: 'agent' })

    expect(calls[0].path).toBe('/api/v1/traces')
    expect(calls[0].query).toMatchObject({ from: '2026-07-01T00:00:00Z', q: 'agent' })
  })

  test('get_savings sends hours/minSavings', async () => {
    const { client, calls } = fakeClient()
    const handlers = captureTools(client)
    await handlers.get('get_savings')!({ hours: 24, minSavings: 10 })

    expect(calls[0].path).toBe('/api/v1/recommendations')
    expect(calls[0].query).toEqual({ hours: 24, minSavings: 10 })
  })
})

describe('tool errors', () => {
  const origFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = origFetch
  })

  test('server error envelope reaches the LLM as readable text (C17.3)', async () => {
    // Shape produced by apps/server/src/app.ts onError for authApiKey's 401.
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'UNAUTHORIZED', message: 'Invalid API key', requestId: 'req-42' },
        }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch
    const handlers = captureTools(new SpanlensClient({ apiKey: 'sl_live_pub_bad' }))

    const result = (await handlers.get('get_stats')!({})) as {
      content: Array<{ text: string }>
      isError?: boolean
    }

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toBe(
      'Error: Invalid API key (HTTP 401, UNAUTHORIZED, requestId req-42)',
    )
  })
})

describe('helpers', () => {
  test('timeframeToHours maps all enum values', () => {
    expect(timeframeToHours('1h')).toBe(1)
    expect(timeframeToHours('24h')).toBe(24)
    expect(timeframeToHours('7d')).toBe(168)
    expect(timeframeToHours('30d')).toBe(720)
    expect(timeframeToHours(undefined)).toBe(168)
  })

  test('hoursAgoIso subtracts from now', () => {
    expect(hoursAgoIso(1)).toBe(new Date(NOW - 3_600_000).toISOString())
  })

  test('sinceToObservationHours clamps to the server range 0.25–72', () => {
    const oneWeekAgo = new Date(NOW - 168 * 3_600_000).toISOString()
    expect(sinceToObservationHours(oneWeekAgo)).toBe(72)
    const oneMinuteAgo = new Date(NOW - 60_000).toISOString()
    expect(sinceToObservationHours(oneMinuteAgo)).toBe(0.25)
    expect(sinceToObservationHours('not-a-date')).toBeUndefined()
  })
})
