import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SpanlensClient } from '../client.js'
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

function fakeClient(): { client: SpanlensClient; calls: Array<{ path: string; query?: Record<string, unknown> }> } {
  const calls: Array<{ path: string; query?: Record<string, unknown> }> = []
  const client = {
    get: async (path: string, query?: Record<string, unknown>) => {
      calls.push({ path, query })
      return { ok: true }
    },
  } as unknown as SpanlensClient
  return { client, calls }
}

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
