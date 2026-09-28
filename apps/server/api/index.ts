import type { IncomingMessage, ServerResponse } from 'node:http'
import { initSentry, captureError } from '../src/lib/sentry.js'
import { app } from '../src/app.js'

// Initialise Sentry before any request is handled. No-op when SENTRY_DSN is unset.
initSentry()

// Node.js runtime: maxDuration set in vercel.json
//
// WHY a custom handler instead of @hono/node-server getRequestListener:
//   Vercel's Node.js runtime passes IncomingMessage whose stream may not
//   emit 'end' reliably once Readable.toWeb() is called lazily inside
//   @hono/node-server. This causes c.req.json() / c.req.text() to await
//   a Promise that never resolves → 40s timeout on every POST/PATCH.
//
//   Fix: eagerly buffer the body with `for await (const chunk of req)`
//   BEFORE constructing the Web API Request. Vercel Node.js streams
//   work fine when iterated directly with async iteration.
//
// WHY not hono/vercel handle():
//   handle() is `(req) => app.fetch(req)` — it passes IncomingMessage
//   directly to Hono which expects a Web Request. Hono's cors middleware
//   calls req.headers.get() which doesn't exist on IncomingMessage → TypeError.
export const runtime = 'nodejs'

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  // Hoisted so the catch below can cancel a body it never got to pump.
  let webRes: Response | undefined
  try {
    // 1. Build URL — Vercel terminates TLS at the edge, use forwarded headers
    const proto =
      (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() ?? 'https'
    const host =
      (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim() ??
      req.headers['host'] ??
      'localhost'
    const url = `${proto}://${host}${req.url ?? '/'}`

    // 2. Build Headers — use rawHeaders to preserve original casing, skip HTTP/2 pseudo-headers
    const headers = new Headers()
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const key = req.rawHeaders[i]!
      const val = req.rawHeaders[i + 1]!
      if (key.charCodeAt(0) !== 58 /* ':' */) {
        headers.append(key, val)
      }
    }

    // 3. Buffer request body (GET/HEAD have no body)
    //    `for await...of req` puts IncomingMessage into flowing mode and
    //    reliably delivers all chunks + signals EOF — the pattern that works
    //    in Vercel Node.js runtime.
    let body: Buffer | null = null
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks: Buffer[] = []
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array))
      }
      const buf = Buffer.concat(chunks)
      if (buf.length > 0) body = buf
    }

    // 4. Create Web API Request and call Hono
    const webReq = new Request(url, {
      method: req.method ?? 'GET',
      headers,
      ...(body !== null ? { body: body as Uint8Array } : {}),
    })
    webRes = await app.fetch(webReq)

    // 5. Write response headers (skip hop-by-hop headers Node.js manages)
    const resHeaders: Record<string, string | string[]> = {}
    webRes.headers.forEach((value, key) => {
      if (key === 'transfer-encoding' || key === 'content-encoding') return
      const existing = resHeaders[key]
      if (existing !== undefined) {
        resHeaders[key] = Array.isArray(existing) ? [...existing, value] : [existing, value]
      } else {
        resHeaders[key] = value
      }
    })
    res.writeHead(webRes.status, resHeaders)

    // 6. Stream response body (works for both streaming SSE and plain JSON)
    if (webRes.body) {
      const reader = webRes.body.getReader()
      // Detect client disconnect. Without this, a client that aborts mid-stream
      // leaves res.write() returning false with no subsequent 'drain' — the loop
      // below would await 'drain' forever, the upstream proxy pump would block on
      // its downstream write, the 290s stream deadline (which only races
      // reader.read(), not the write) would never fire, and the function would
      // hang until Vercel's 300s ceiling: the row is never logged and a
      // full-duration invocation is billed. On 'close' we stop and cancel the
      // upstream stream so the proxy pump unblocks and logs the partial row.
      let clientGone = false
      const onClose = () => {
        clientGone = true
      }
      res.on('close', onClose)
      try {
        for (;;) {
          if (clientGone || res.writableEnded) break
          const { done, value } = await reader.read()
          if (done) break
          if (!res.write(value)) {
            if (clientGone || res.writableEnded) break
            // Backpressure: resume on 'drain', or bail out if the client left.
            await new Promise<void>((resolve) => {
              const finish = () => {
                res.off('drain', onDrain)
                res.off('close', onDisc)
                resolve()
              }
              const onDrain = () => finish()
              const onDisc = () => finish()
              res.once('drain', onDrain)
              res.once('close', onDisc)
            })
          }
        }
      } finally {
        res.off('close', onClose)
        // If the client aborted, cancel the upstream/proxy stream so its pump
        // stops waiting on our (dead) socket and runs its ClickHouse logging.
        if (clientGone) await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
    }
    if (!res.writableEnded) res.end()
  } catch (err) {
    console.error('[handler] unhandled error:', err)
    captureError(err, { url: req.url, method: req.method })
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end('Internal Server Error')
    } else if (!res.writableEnded) {
      // The status line already promised success and part of the body is on
      // the wire. Appending an error string would hand the client a 200 whose
      // body ends in "Internal Server Error", which a browser saves as a
      // complete CSV. Destroying the socket drops the chunked terminator, so
      // the client's body read fails and the download is marked failed.
      res.destroy(err instanceof Error ? err : new Error(String(err)))
    }
    // A body we never finished pumping may still hold resources until it is
    // read or cancelled; an export's holds a database cursor, which occupies
    // the instance's only export connection by default. Cancelling an errored
    // or already-released body is a harmless rejection.
    await webRes?.body?.cancel().catch(() => {})
  }
}
