import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

// ─────────────────────────────────────────────────────────────────────────────
// api/index.ts error handling, over a real socket.
//
// Once the status line is out, the only honest way to report a failure is to
// abort the connection. The handler used to `res.end('Internal Server Error')`
// instead, which turned a failed CSV export into a 200 whose file ended in
// that string, saved by the browser as if complete (XVERIFY-2026-09-28
// C10.2b). A mocked response object cannot show what the client sees, so this
// runs the real handler behind node:http and reads it with fetch.
// ─────────────────────────────────────────────────────────────────────────────

const appFetch = vi.hoisted(() => vi.fn())
vi.mock('../app.js', () => ({ app: { fetch: appFetch } }))
vi.mock('../lib/sentry.js', () => ({ initSentry: vi.fn(), captureError: vi.fn() }))

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

// api/ sits outside tsconfig's rootDir (src), so a literal import would pull
// it into the typecheck program and fail it. A variable specifier keeps tsc
// out while vitest still resolves and transforms it.
const HANDLER_MODULE = '../../api/index.js'

let server: Server
let baseUrl: string

beforeAll(async () => {
  const { default: handler } = (await import(/* @vite-ignore */ HANDLER_MODULE)) as { default: Handler }
  server = createServer((req, res) => {
    void handler(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

beforeEach(() => {
  appFetch.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

/**
 * A body that sends one chunk and then fails, like a cursor dying mid-export.
 * `failAfterMs` lets the status line and first chunk reach the client first.
 */
function failingBody(failAfterMs: number): ReadableStream<Uint8Array> {
  let sent = false
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!sent) {
        sent = true
        controller.enqueue(new TextEncoder().encode('id,model\nreq_1,gpt-4o-mini\n'))
        return
      }
      await new Promise((r) => setTimeout(r, failAfterMs))
      controller.error(new Error('canceling statement due to statement timeout'))
    },
  })
}

function csvResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, { headers: { 'content-type': 'text/csv; charset=utf-8' } })
}

describe('api/index.ts handler errors', () => {
  test('a body that fails after the 200 aborts the connection instead of appending an error line', async () => {
    appFetch.mockResolvedValue(csvResponse(failingBody(50)))
    const res = await fetch(`${baseUrl}/api/v1/exports/requests`)
    expect(res.status).toBe(200)
    // The client must see a failed body read, not a complete-looking file.
    await expect(res.text()).rejects.toThrow()
  })

  test('a body that fails before anything flushed never reads as a complete download either', async () => {
    appFetch.mockResolvedValue(csvResponse(failingBody(0)))
    // Depending on timing the socket goes before or after the head is out:
    // fetch() rejects, or the body read does. Neither may yield text.
    const outcome = await fetch(`${baseUrl}/api/v1/exports/requests`)
      .then((r) => r.text())
      .then(
        (text) => ({ text }),
        () => ({ text: null }),
      )
    expect(outcome.text).toBeNull()
  })

  test('a failure before any header is still a plain 500', async () => {
    appFetch.mockRejectedValue(new Error('boom'))
    const res = await fetch(`${baseUrl}/anything`)
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('Internal Server Error')
  })

  test('a failure before the body pump starts still cancels the body it was handed', async () => {
    // An export's body holds a database cursor until it is read or cancelled.
    // If the bridge throws before pumping it, the body must be cancelled, or
    // that cursor keeps the instance's export connection.
    const cancelled = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      pull() {
        // Never produces; only cancel() can end it.
      },
      cancel: cancelled,
    })
    const brokenHeaders = {
      forEach() {
        throw new Error('header iteration failed')
      },
    }
    appFetch.mockResolvedValue({ status: 200, headers: brokenHeaders, body } as unknown as Response)

    const res = await fetch(`${baseUrl}/api/v1/exports/requests`)
    expect(res.status).toBe(500)
    await res.text()
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalled())
  })

  test('a normal streamed body still arrives whole', async () => {
    appFetch.mockResolvedValue(new Response('id\nreq_1\n', { headers: { 'content-type': 'text/csv' } }))
    const res = await fetch(`${baseUrl}/api/v1/exports/requests`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('id\nreq_1\n')
  })
})
