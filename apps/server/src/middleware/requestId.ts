import { createMiddleware } from 'hono/factory'
import { randomUUID } from 'node:crypto'

/**
 * Sprint 7 R-15 + R-20: per-request trace id middleware.
 *
 * Stamps a UUIDv4 onto every incoming request before any other route or
 * middleware runs. Two consumers:
 *
 *   1. The global `onError` handler in `app.ts` echoes this id back to
 *      the client inside the standard `{ error: { requestId } }` shape,
 *      so a customer reporting a 500 can quote a single value that the
 *      operator can grep in Vercel logs.
 *   2. Sentry events tag this id via `captureException(err, { tags: ... })`,
 *      linking a captured exception to the corresponding response.
 *
 * If the client already supplied an `X-Request-ID` header (e.g. from a
 * gateway upstream of Spanlens), we honour it instead of generating a
 * fresh one. This keeps the request id stable across a multi-hop path
 * so log correlation works end to end.
 *
 * Mount order: must come AFTER `cors` (so preflight responses are not
 * tagged) and BEFORE every router and the `onError` handler.
 *
 * Env contract: middleware augments Hono variables with `requestId: string`.
 * Other middleware and handlers that read `c.get('requestId')` should type
 * themselves with `Hono<RequestIdContext>` (or a wider Env that merges it).
 */
export type RequestIdContext = {
  Variables: {
    requestId: string
  }
}

export const requestId = createMiddleware<RequestIdContext>(async (c, next) => {
  const incoming = c.req.header('X-Request-ID')
  const id = isLikelyUuid(incoming) ? incoming : randomUUID()
  c.set('requestId', id)
  c.header('X-Request-ID', id)
  await next()
})

/**
 * Accept any well-formed UUID v1-v8. We do not require strictly v4 here
 * because upstream gateways often emit v7 (time-ordered). The length and
 * shape check is enough; a hostile client cannot forge a request id into
 * something that breaks log correlation downstream.
 */
function isLikelyUuid(value: string | undefined): value is string {
  if (!value) return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
