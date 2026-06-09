import type { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { isApiError } from '../../lib/errors.js'

/**
 * Sprint 7 R-15 + R-20 test helper.
 *
 * Mirror of the global onError handler in `apps/server/src/app.ts`. Test
 * apps that exercise middleware which now throws ApiError (instead of
 * returning c.json directly) must mount an onError serialiser so the
 * thrown error becomes a proper HTTP response. Without it, Hono surfaces
 * the uncaught throw as a generic 500 and assertions like
 * `expect(res.status).toBe(403)` fail with "expected 500".
 *
 * Kept narrow on purpose: serialises only ApiError. Anything else
 * re-throws so the test still observes the unexpected error as a real
 * test failure rather than swallowing it into a 500 body.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function installOnError(app: Hono<any, any, any>): void {
  app.onError((err, c) => {
    if (isApiError(err)) {
      return c.json(
        { error: { code: err.code, message: err.message, details: err.details } },
        err.status as ContentfulStatusCode,
      )
    }
    throw err
  })
}
