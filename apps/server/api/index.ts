import { getRequestListener } from '@hono/node-server'
import { app } from '../src/app.js'

// Node.js runtime: 300s timeout, full Node.js API support.
//
// WHY getRequestListener instead of hono/vercel handle():
//   `handle()` from hono/vercel passes the raw request directly to app.fetch,
//   which works on Edge (Web API Request) but fails on Node.js runtime because
//   Vercel passes IncomingMessage — whose .headers is a plain object, not a
//   Headers instance. Calling `.headers.get()` throws TypeError.
//
//   `getRequestListener` from @hono/node-server properly converts
//   IncomingMessage → Web API Request before calling app.fetch.
//
// fireAndForget() still works: @vercel/functions waitUntil() is a global
// call that does not need executionCtx.
export const runtime = 'nodejs'

export default getRequestListener(app.fetch)
