import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as createTcpServer, type AddressInfo, type Server } from 'node:net'
import type { SafeUrlResult } from './safe-url.js'

/**
 * lib/safe-http.ts is the only way a customer-supplied URL gets a POST from
 * Spanlens (webhooks). These tests run the real transport against real local
 * servers: the two bugs it closes, redirect-following into internal targets
 * and DNS rebinding between validation and connect, were both reproduced
 * against real sockets (XVERIFY C12.5), so a mocked fetch would prove nothing.
 *
 * The local servers live on 127.0.0.1, which the real validator rightly
 * refuses. Each test injects a `validate` that allows only the origin playing
 * "the customer's endpoint" and hands every other URL to the real
 * validateOutboundUrl, which is exactly the decision a redirect target gets
 * in production.
 */

type LookupAnswer = { address: string; family: number }
type LookupCallback = (err: NodeJS.ErrnoException | null, addresses?: LookupAnswer[]) => void
const lookupMock = vi.fn<(host: string, options: object, cb: LookupCallback) => void>()

vi.mock('node:dns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns')>()
  return {
    ...actual,
    lookup: (host: string, options: object, cb: LookupCallback) => lookupMock(host, options, cb),
  }
})

const { safePost, MAX_REDIRECTS } = await import('./safe-http.js')
const { validateOutboundUrl } = await import('./safe-url.js')

interface Received {
  method: string | undefined
  url: string | undefined
  headers: IncomingMessage['headers']
  body: string
}

type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void

interface TestServer {
  origin: string
  port: number
  received: Received[]
}

interface TcpCounter {
  port: number
  connections: () => number
}

const openServers: Server[] = []

async function listen(server: Server): Promise<number> {
  openServers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as AddressInfo).port
}

async function httpServer(handler: Handler): Promise<TestServer> {
  const received: Received[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      received.push({ method: req.method, url: req.url, headers: req.headers, body })
      handler(req, res, body)
    })
  })
  const port = await listen(server as unknown as Server)
  return { origin: `http://127.0.0.1:${port}`, port, received }
}

/** A raw TCP listener that only counts connections: proof nothing reached it. */
async function tcpCounter(): Promise<TcpCounter> {
  let count = 0
  const server = createTcpServer((socket) => {
    count++
    socket.destroy()
  })
  const port = await listen(server)
  return { port, connections: () => count }
}

function redirectTo(status: number, location: string): Handler {
  return (_req, res) => {
    res.writeHead(status, { Location: location })
    res.end()
  }
}

const respond =
  (status: number): Handler =>
  (_req, res) => {
    res.writeHead(status)
    res.end('ok')
  }

/** Allows `origins`; everything else gets the production validator. */
function allowOrigins(...origins: string[]) {
  return vi.fn(
    async (url: string): Promise<SafeUrlResult> =>
      origins.includes(new URL(url).origin)
        ? { ok: true, resolvedIps: [] }
        : validateOutboundUrl(url),
  )
}

const HEADERS = {
  'Content-Type': 'application/json',
  'X-Spanlens-Signature': 'sha256=abc',
  'X-Spanlens-Delivery-Id': '6f1c3a9e-0000-4000-8000-000000000001',
}
const BODY = '{"event":"test"}'

beforeEach(() => {
  lookupMock.mockReset()
})

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          ;(s as unknown as { closeAllConnections?: () => void }).closeAllConnections?.()
          s.close(() => resolve())
        }),
    ),
  )
})

describe('safePost — delivery', () => {
  test('POSTs the body and headers and reports the final status', async () => {
    const hook = await httpServer(respond(204))

    const r = await safePost(`${hook.origin}/hook`, {
      headers: HEADERS,
      body: BODY,
      timeoutMs: 2_000,
      validate: allowOrigins(hook.origin),
    })

    expect(r).toEqual({ status: 204, error: null })
    expect(hook.received).toHaveLength(1)
    const got = hook.received[0]!
    expect(got.method).toBe('POST')
    expect(got.body).toBe(BODY)
    expect(got.headers['x-spanlens-signature']).toBe('sha256=abc')
    expect(got.headers['x-spanlens-delivery-id']).toBe(HEADERS['X-Spanlens-Delivery-Id'])
    expect(got.headers['content-type']).toBe('application/json')
  })

  test('a URL the validator rejects is never connected to', async () => {
    const target = await tcpCounter()
    const validate = vi.fn(
      async (): Promise<SafeUrlResult> => ({
        ok: false,
        reason: 'BLOCKED_IP',
        message: 'url resolves to a blocked IP range (127.0.0.0/8)',
      }),
    )

    const r = await safePost(`http://127.0.0.1:${target.port}/`, {
      headers: HEADERS,
      body: BODY,
      timeoutMs: 2_000,
      validate,
    })

    expect(r.status).toBeNull()
    expect(r.error).toBe('URL rejected by SSRF guard: url resolves to a blocked IP range (127.0.0.0/8)')
    expect(target.connections()).toBe(0)
  })

  test('a 3xx without a Location header is a final response', async () => {
    const hook = await httpServer(respond(302))

    const r = await safePost(`${hook.origin}/hook`, {
      headers: HEADERS,
      body: BODY,
      timeoutMs: 2_000,
      validate: allowOrigins(hook.origin),
    })

    expect(r).toEqual({ status: 302, error: null })
  })

  test('a target that never answers times out inside the budget', async () => {
    const hang = await httpServer(() => undefined)

    const started = Date.now()
    const r = await safePost(`${hang.origin}/hook`, {
      headers: HEADERS,
      body: BODY,
      timeoutMs: 200,
      validate: allowOrigins(hang.origin),
    })

    expect(r.status).toBeNull()
    expect(r.error).toBe('Request timed out after 200ms')
    expect(Date.now() - started).toBeLessThan(2_000)
  })
})

describe('safePost — redirects are re-validated on every hop', () => {
  test.each([301, 302, 303, 307, 308])(
    '%i to an internal http target is refused and the target never sees it',
    async (status) => {
      const internal = await tcpCounter()
      const hook = await httpServer(
        redirectTo(status, `http://127.0.0.1:${internal.port}/admin`),
      )

      const r = await safePost(`${hook.origin}/hook`, {
        headers: HEADERS,
        body: BODY,
        timeoutMs: 2_000,
        validate: allowOrigins(hook.origin),
      })

      expect(r.status).toBe(status)
      expect(r.error).toContain('rejected by SSRF guard')
      expect(internal.connections()).toBe(0)
    },
  )

  test('redirect to the cloud metadata address is refused', async () => {
    const hook = await httpServer(redirectTo(307, 'https://169.254.169.254/latest/meta-data/'))
    const validate = allowOrigins(hook.origin)

    const r = await safePost(`${hook.origin}/hook`, {
      headers: HEADERS,
      body: BODY,
      timeoutMs: 2_000,
      validate,
    })

    expect(r.status).toBe(307)
    expect(r.error).toContain('rejected by SSRF guard')
    expect(r.error).toContain('169.254')
    expect(validate).toHaveBeenLastCalledWith('https://169.254.169.254/latest/meta-data/')
  })

  test('redirect to https loopback is refused and nothing connects', async () => {
    const internal = await tcpCounter()
    const hook = await httpServer(redirectTo(308, `https://127.0.0.1:${internal.port}/`))

    const r = await safePost(`${hook.origin}/hook`, {
      headers: HEADERS,
      body: BODY,
      timeoutMs: 2_000,
      validate: allowOrigins(hook.origin),
    })

    expect(r.error).toContain('127.0.0.0/8')
    expect(internal.connections()).toBe(0)
  })

  test('an allowed redirect is followed with the same method, body and signed headers', async () => {
    const final = await httpServer(respond(200))
    const hook = await httpServer(redirectTo(308, `${final.origin}/moved`))

    const r = await safePost(`${hook.origin}/hook`, {
      headers: HEADERS,
      body: BODY,
      timeoutMs: 2_000,
      validate: allowOrigins(hook.origin, final.origin),
    })

    expect(r).toEqual({ status: 200, error: null })
    expect(final.received).toHaveLength(1)
    const got = final.received[0]!
    expect(got.method).toBe('POST')
    expect(got.url).toBe('/moved')
    expect(got.body).toBe(BODY)
    expect(got.headers['x-spanlens-signature']).toBe('sha256=abc')
    expect(got.headers['x-spanlens-delivery-id']).toBe(HEADERS['X-Spanlens-Delivery-Id'])
  })

  test('a relative Location is resolved against the current URL before validation', async () => {
    const hook = await httpServer((req, res) => {
      if (req.url === '/start') {
        res.writeHead(307, { Location: '/next' })
        res.end()
      } else {
        res.writeHead(200)
        res.end()
      }
    })
    const validate = allowOrigins(hook.origin)

    const r = await safePost(`${hook.origin}/start`, {
      headers: HEADERS,
      body: BODY,
      timeoutMs: 2_000,
      validate,
    })

    expect(r).toEqual({ status: 200, error: null })
    expect(validate).toHaveBeenLastCalledWith(`${hook.origin}/next`)
  })

  test(`stops after ${MAX_REDIRECTS} redirects`, async () => {
    const loop = await httpServer(redirectTo(307, '/again'))

    const r = await safePost(`${loop.origin}/hook`, {
      headers: HEADERS,
      body: BODY,
      timeoutMs: 2_000,
      validate: allowOrigins(loop.origin),
    })

    expect(r.status).toBe(307)
    expect(r.error).toBe(`Too many redirects (more than ${MAX_REDIRECTS})`)
    expect(loop.received).toHaveLength(MAX_REDIRECTS + 1)
  })

  test('an unparseable Location fails the attempt', async () => {
    const hook = await httpServer(redirectTo(302, 'http://[not-an-ip/'))

    const r = await safePost(`${hook.origin}/hook`, {
      headers: HEADERS,
      body: BODY,
      timeoutMs: 2_000,
      validate: allowOrigins(hook.origin),
    })

    expect(r.status).toBe(302)
    expect(r.error).toBe('Redirect Location header is not a valid URL')
  })
})

describe('safePost — DNS rebinding is stopped at connect time', () => {
  test.each(['http', 'https'])(
    '%s: a hostname that validated as public never connects when the socket lookup returns loopback',
    async (scheme) => {
      const internal = await tcpCounter()
      // Validation saw a public answer (the first DNS query)...
      const validate = vi.fn(
        async (): Promise<SafeUrlResult> => ({ ok: true, resolvedIps: ['93.184.216.34'] }),
      )
      // ...and the connection's own query is answered with loopback.
      lookupMock.mockImplementation((_host, _options, cb) =>
        cb(null, [{ address: '127.0.0.1', family: 4 }]),
      )

      const r = await safePost(`${scheme}://rebind.attacker.test:${internal.port}/hook`, {
        headers: HEADERS,
        body: BODY,
        timeoutMs: 2_000,
        validate,
      })

      expect(r.status).toBeNull()
      expect(r.error).toContain('blocked by SSRF guard')
      expect(r.error).toContain('127.0.0.1')
      expect(lookupMock).toHaveBeenCalledWith('rebind.attacker.test', expect.anything(), expect.any(Function))
      expect(internal.connections()).toBe(0)
    },
  )
})
