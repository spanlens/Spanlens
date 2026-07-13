import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * warmClickhouse / warmClickhouseWithRetry tests.
 *
 * Why these exist: the status-page "Spanlens Proxy (Deep)" monitor sat at
 * 98.2% uptime because /health/deep probed ClickHouse with HTTP /ping,
 * which wakes a suspended ClickHouse Cloud service but does NOT count as
 * query activity — so the Development tier kept idle-suspending between
 * probes. The fix routes health probes and /cron/keep-warm through a real
 * `SELECT 1`. These tests pin the two behaviors the fix depends on:
 *
 *   - warmClickhouse issues an actual query (not ping) and maps
 *     success/failure to boolean without throwing.
 *   - warmClickhouseWithRetry retries exactly once, so a transient blip
 *     (or an in-flight cold wake) doesn't 503 the monitor while a real
 *     outage still resolves to false.
 */

const queryMock = vi.fn()

vi.mock('@clickhouse/client', () => ({
  createClient: () => ({ query: queryMock }),
}))

let warmClickhouse: typeof import('../lib/clickhouse.js').warmClickhouse
let warmClickhouseWithRetry: typeof import('../lib/clickhouse.js').warmClickhouseWithRetry

const ENV_KEYS = ['CLICKHOUSE_URL', 'CLICKHOUSE_USER', 'CLICKHOUSE_PASSWORD'] as const
const origEnv = new Map(ENV_KEYS.map((k) => [k, process.env[k]]))

beforeEach(async () => {
  vi.resetModules()
  queryMock.mockReset()
  process.env['CLICKHOUSE_URL'] = 'http://localhost:8123'
  process.env['CLICKHOUSE_USER'] = 'default'
  process.env['CLICKHOUSE_PASSWORD'] = 'test'
  const mod = await import('../lib/clickhouse.js')
  mod.resetClickhouseClient()
  ;({ warmClickhouse, warmClickhouseWithRetry } = mod)
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    const orig = origEnv.get(key)
    if (orig === undefined) delete process.env[key]
    else process.env[key] = orig
  }
})

function queryOk() {
  return Promise.resolve({ json: () => Promise.resolve([{ 1: 1 }]) })
}

describe('warmClickhouse', () => {
  test('returns true when SELECT 1 succeeds', async () => {
    queryMock.mockImplementation(queryOk)

    await expect(warmClickhouse()).resolves.toBe(true)

    expect(queryMock).toHaveBeenCalledTimes(1)
    const arg = queryMock.mock.calls[0]?.[0] as { query: string; abort_signal: AbortSignal }
    expect(arg.query).toBe('SELECT 1')
    expect(arg.abort_signal).toBeInstanceOf(AbortSignal)
  })

  test('returns false (never throws) when the query rejects', async () => {
    queryMock.mockRejectedValue(new Error('Timeout error.'))

    await expect(warmClickhouse()).resolves.toBe(false)
  })
})

describe('warmClickhouseWithRetry', () => {
  test('first attempt succeeds → no retry', async () => {
    queryMock.mockImplementation(queryOk)

    await expect(warmClickhouseWithRetry()).resolves.toBe(true)
    expect(queryMock).toHaveBeenCalledTimes(1)
  })

  test('first attempt fails, retry succeeds → true (transient blip absorbed)', async () => {
    queryMock.mockRejectedValueOnce(new Error('socket hang up')).mockImplementation(queryOk)

    await expect(warmClickhouseWithRetry()).resolves.toBe(true)
    expect(queryMock).toHaveBeenCalledTimes(2)
  })

  test('both attempts fail → false (real outage still surfaces)', async () => {
    queryMock.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(warmClickhouseWithRetry()).resolves.toBe(false)
    expect(queryMock).toHaveBeenCalledTimes(2)
  })
})
