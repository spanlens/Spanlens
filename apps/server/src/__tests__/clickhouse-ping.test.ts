import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * pingClickhouse tests.
 *
 * Replaces clickhouse-warm.test.ts (deleted 2026-08-11 along with
 * warmClickhouse / warmClickhouseWithRetry). Those functions ran a real
 * `SELECT 1` specifically so ClickHouse Cloud's idle-suspend timer kept
 * resetting on every health probe — which is exactly what made a
 * Development-tier instance serving ~250 requests/month bill as
 * continuously running ($232/mo, 2026-08-11). Health checks now use
 * pingClickhouse (HTTP /ping) instead: it still detects a genuine outage,
 * but it does not count as the "query activity" ClickHouse Cloud watches
 * before deciding whether to suspend. See the docstring on
 * `pingClickhouse` in lib/clickhouse.ts for the full history.
 */

const pingMock = vi.fn()

vi.mock('@clickhouse/client', () => ({
  createClient: () => ({ ping: pingMock }),
}))

let pingClickhouse: typeof import('../lib/clickhouse.js').pingClickhouse

const ENV_KEYS = ['CLICKHOUSE_URL', 'CLICKHOUSE_USER', 'CLICKHOUSE_PASSWORD'] as const
const origEnv = new Map(ENV_KEYS.map((k) => [k, process.env[k]]))

beforeEach(async () => {
  vi.resetModules()
  pingMock.mockReset()
  process.env['CLICKHOUSE_URL'] = 'http://localhost:8123'
  process.env['CLICKHOUSE_USER'] = 'default'
  process.env['CLICKHOUSE_PASSWORD'] = 'test'
  const mod = await import('../lib/clickhouse.js')
  mod.resetClickhouseClient()
  ;({ pingClickhouse } = mod)
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    const orig = origEnv.get(key)
    if (orig === undefined) delete process.env[key]
    else process.env[key] = orig
  }
})

describe('pingClickhouse', () => {
  test('returns true when the ping reports success', async () => {
    pingMock.mockResolvedValue({ success: true })

    await expect(pingClickhouse()).resolves.toBe(true)
    expect(pingMock).toHaveBeenCalledTimes(1)
  })

  test('returns false when the ping reports failure (never throws)', async () => {
    pingMock.mockResolvedValue({ success: false })

    await expect(pingClickhouse()).resolves.toBe(false)
  })

  test('returns false (never throws) when the ping request itself rejects', async () => {
    pingMock.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(pingClickhouse()).resolves.toBe(false)
  })
})
