import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'

/**
 * Stamps the moment a proxy request reached this app.
 *
 * Mounted in app.ts as the FIRST middleware for `/proxy/*`, ahead of cors,
 * authApiKey, proxyRateLimit, enforceQuota and customerRateLimit, so the two
 * numbers derived from it cover everything Spanlens does before the upstream
 * call:
 *
 *   - `proxy_overhead_ms` = upstream fetch start − this stamp. Includes the
 *     auth lookup, the rate-limit and quota checks, key decryption, body
 *     parsing, the security scan and the cache lookup. It used to start at
 *     the route handler's first line, after all the middleware had run, so a
 *     cold auth cache or a slow rate-limit backend never showed up in the
 *     published overhead figure.
 *   - the stream deadline (proxy/stream-deadline.ts) counts from here too.
 *     Anchored at the handler, middleware time ran outside the 290s budget
 *     and ate into the 10s grace window under Vercel's 300s ceiling.
 *
 * The stamp is taken when the Hono app sees the request. api/index.ts buffers
 * the request body before handing it over, so upload time is not included.
 */
export type RequestStartContext = {
  Variables: {
    requestStartMs: number
  }
}

export const requestStart = createMiddleware<RequestStartContext>(async (c, next) => {
  c.set('requestStartMs', Date.now())
  await next()
})

/**
 * When the proxy request arrived. Falls back to "now" when the stamp is
 * missing, which only happens when a proxy router is mounted without app.ts
 * (unit tests); the numbers then start at the handler, as they used to.
 */
export function getRequestStartMs(c: Context): number {
  const stamped: unknown = (c as unknown as { get: (key: string) => unknown }).get('requestStartMs')
  return typeof stamped === 'number' ? stamped : Date.now()
}
