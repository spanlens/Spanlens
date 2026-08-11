/**
 * Next.js instrumentation hook — server + edge Sentry initialisation.
 *
 * @sentry/nextjs 10.56.0 contains NO reference to `sentry.server.config` or
 * `sentry.edge.config` anywhere in its build output (verified with a full grep
 * over node_modules/@sentry/nextjs/build: zero hits, versus 12 hits for
 * `instrumentation-client`). The SDK never picks those files up on its own —
 * they are plain modules that this `register()` hook has to import, which is
 * why Sentry was dead on the server and edge runtimes as well as the client.
 *
 * `register()` and `onRequestError` are Next.js file-convention exports, so
 * this file works under both Turbopack and webpack.
 */
import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

/**
 * Forwards errors from Next.js' `onRequestError` hook (nested React Server
 * Component errors, route handler failures) to Sentry. The SDK ships
 * `captureRequestError` for exactly this purpose:
 * "Reports errors passed to the the Next.js `onRequestError` instrumentation
 * hook." (build/types/common/captureRequestError.d.ts)
 */
export const onRequestError = Sentry.captureRequestError
