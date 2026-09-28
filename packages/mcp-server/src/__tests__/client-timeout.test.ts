import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  DEFAULT_TIMEOUT_MS,
  SpanlensClient,
  SpanlensTimeoutError,
  parseTimeoutMs,
} from '../client.js'

/**
 * Request timeout (C17.4). v0.2.1 called fetch with no signal, so a Spanlens
 * API that stopped answering held the startup key check (which runs outside
 * any MCP request timeout) for as long as undici's own 300 s header/body
 * timeouts, then failed with a bare "fetch failed".
 *
 * These tests use a real local HTTP server rather than a fetch mock: the
 * failure is about how real fetch behaves when headers or the body never
 * arrive, and a mock would simply return whatever we told it to.
 */

type Handler = (req: IncomingMessage, res: ServerResponse) => void

let server: Server | undefined

async function startServer(handler: Handler): Promise<string> {
  server = createServer(handler)
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}`
}

afterEach(async () => {
  vi.restoreAllMocks()
  if (!server) return
  // A stalled response keeps its socket open, and close() waits for it.
  server.closeAllConnections()
  await new Promise<void>((resolve) => server!.close(() => resolve()))
  server = undefined
})

describe('SpanlensClient request timeout', () => {
  test('gives up when the server never sends headers', { timeout: 3_000 }, async () => {
    const baseUrl = await startServer(() => {
      // Never respond.
    })
    const client = new SpanlensClient({ apiKey: 'k', baseUrl, timeoutMs: 200 })

    const started = Date.now()
    const err = await client.keyInfo().catch((e: unknown) => e)

    expect(err).toBeInstanceOf(SpanlensTimeoutError)
    expect(err).toMatchObject({ name: 'SpanlensTimeoutError', timeoutMs: 200 })
    expect((err as Error).message).toContain('within 200 ms')
    expect((err as Error).message).toContain(`${baseUrl}/api/v1/me/key-info`)
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  test('gives up when the body stalls after headers', { timeout: 3_000 }, async () => {
    const baseUrl = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.write('{"success":true,"data":')
      // Never finish the body.
    })
    const client = new SpanlensClient({ apiKey: 'k', baseUrl, timeoutMs: 200 })

    const err = await client.get('/api/v1/stats/overview').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(SpanlensTimeoutError)
  })

  test('a response inside the budget is unaffected', async () => {
    const baseUrl = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ success: true, data: { ok: 1 } }))
    })
    const client = new SpanlensClient({ apiKey: 'k', baseUrl, timeoutMs: 2_000 })

    await expect(client.get('/api/v1/stats/overview')).resolves.toEqual({ ok: 1 })
  })

  test('uses a 30 s budget by default', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    const baseUrl = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ success: true, data: null }))
    })
    const client = new SpanlensClient({ apiKey: 'k', baseUrl })

    await client.get('/x')

    expect(DEFAULT_TIMEOUT_MS).toBe(30_000)
    expect(client.timeoutMs).toBe(30_000)
    expect(timeoutSpy).toHaveBeenCalledWith(30_000)
  })

  test('a network failure that is not a timeout is not relabelled', async () => {
    const baseUrl = await startServer((req) => {
      req.socket.destroy()
    })
    const client = new SpanlensClient({ apiKey: 'k', baseUrl, timeoutMs: 2_000 })

    const err = await client.get('/x').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(SpanlensTimeoutError)
  })

  test('rejects a timeout that is not a whole number of ms in range', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, 600_001]) {
      expect(() => new SpanlensClient({ apiKey: 'k', timeoutMs: bad })).toThrow(/timeoutMs/)
    }
    expect(new SpanlensClient({ apiKey: 'k', timeoutMs: 600_000 }).timeoutMs).toBe(600_000)
  })
})

describe('parseTimeoutMs (SPANLENS_TIMEOUT_MS)', () => {
  test('unset or blank means "use the default"', () => {
    expect(parseTimeoutMs(undefined)).toBeUndefined()
    expect(parseTimeoutMs('')).toBeUndefined()
    expect(parseTimeoutMs('  ')).toBeUndefined()
  })

  test('reads a whole number of milliseconds', () => {
    expect(parseTimeoutMs('5000')).toBe(5_000)
    expect(parseTimeoutMs(' 45000 ')).toBe(45_000)
  })

  test('fails loudly on anything else', () => {
    for (const bad of ['abc', '5s', '1.5', '-10', '0', '600001']) {
      expect(() => parseTimeoutMs(bad)).toThrow(/SPANLENS_TIMEOUT_MS/)
    }
  })
})
