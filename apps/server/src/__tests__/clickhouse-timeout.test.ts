import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * ClickHouse request timeouts.
 *
 * The library default is 30s. That was invisible for as long as the service
 * was awake around the clock, and became a real failure the moment the cron
 * fleet stopped waking it: a suspended ClickHouse Cloud service takes tens of
 * seconds to come back, and the first cron to hit a sleeping one died at
 * exactly 30014ms — the default timeout, not a fault.
 *
 * Two opposite deadlines matter here and it is easy to regress one while
 * fixing the other, so both are pinned:
 *
 *   - queries get a WIDE timeout so a cold start finishes
 *   - the health ping gets a SHORT one, because a probe that patiently hangs
 *     for a minute is worse than one that answers "not ready" immediately.
 *     Better Stack polls /health/deep every three minutes.
 */

const createClientMock = vi.fn()
const pingMock = vi.fn()

vi.mock('@clickhouse/client', () => ({
  createClient: (config: unknown) => {
    createClientMock(config)
    return { ping: pingMock }
  },
}))

const ENV_KEYS = [
  'CLICKHOUSE_URL',
  'CLICKHOUSE_USER',
  'CLICKHOUSE_PASSWORD',
  'CLICKHOUSE_REQUEST_TIMEOUT_MS',
] as const
const origEnv = new Map(ENV_KEYS.map((k) => [k, process.env[k]]))

async function loadModule() {
  const mod = await import('../lib/clickhouse.js')
  mod.resetClickhouseClient()
  return mod
}

beforeEach(() => {
  vi.resetModules()
  createClientMock.mockReset()
  pingMock.mockReset()
  process.env['CLICKHOUSE_URL'] = 'http://localhost:8123'
  process.env['CLICKHOUSE_USER'] = 'default'
  process.env['CLICKHOUSE_PASSWORD'] = 'test'
  delete process.env['CLICKHOUSE_REQUEST_TIMEOUT_MS']
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    const orig = origEnv.get(key)
    if (orig === undefined) delete process.env[key]
    else process.env[key] = orig
  }
})

function configPassedToCreateClient(): { request_timeout?: number } {
  return createClientMock.mock.calls[0]?.[0] as { request_timeout?: number }
}

describe('client request_timeout', () => {
  test('defaults to 60s so a cold start has room to finish', async () => {
    const mod = await loadModule()
    mod.unscopedClickhouse()
    expect(configPassedToCreateClient().request_timeout).toBe(60_000)
  })

  test('is overridable without a deploy', async () => {
    process.env['CLICKHOUSE_REQUEST_TIMEOUT_MS'] = '90000'
    const mod = await loadModule()
    mod.unscopedClickhouse()
    expect(configPassedToCreateClient().request_timeout).toBe(90_000)
  })

  test.each(['nonsense', '0', '-1', ''])(
    'falls back to the default for the unusable value %o',
    async (value) => {
      process.env['CLICKHOUSE_REQUEST_TIMEOUT_MS'] = value
      const mod = await loadModule()
      mod.unscopedClickhouse()
      expect(configPassedToCreateClient().request_timeout).toBe(60_000)
    },
  )
})

describe('pingClickhouse deadline', () => {
  test('aborts on its own short deadline, not the client-wide one', async () => {
    pingMock.mockResolvedValue({ success: true })
    const mod = await loadModule()

    await mod.pingClickhouse()

    const params = pingMock.mock.calls[0]?.[0] as {
      select: boolean
      abort_signal: AbortSignal
    }
    // `select: false` keeps this on the HTTP /ping endpoint rather than a
    // SELECT — a real query would reset the idle timer this whole effort
    // exists to let expire.
    expect(params.select).toBe(false)
    expect(params.abort_signal).toBeInstanceOf(AbortSignal)
    expect(params.abort_signal.aborted).toBe(false)
  })

  test('still reports false rather than throwing when the deadline fires', async () => {
    pingMock.mockRejectedValue(new Error('The operation was aborted due to timeout'))
    const mod = await loadModule()
    await expect(mod.pingClickhouse()).resolves.toBe(false)
  })
})
