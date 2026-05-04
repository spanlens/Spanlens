import type { IncomingMessage, ServerResponse } from 'node:http'
import { app } from '../src/app.js'

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
    const webRes = await app.fetch(webReq)

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
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (!res.write(value)) {
            // Backpressure: wait for drain before writing more
            await new Promise<void>(resolve => res.once('drain', resolve))
          }
        }
      } finally {
        reader.releaseLock()
      }
    }
    res.end()
  } catch (err) {
    console.error('[handler] unhandled error:', err)
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'text/plain' })
    }
    res.end('Internal Server Error')
  }
}
