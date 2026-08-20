/**
 * Browser-side Sentry initialisation.
 *
 * This file replaces the legacy `sentry.client.config.ts`. @sentry/nextjs
 * 10.56.0 only injects that legacy file through its webpack plugin
 * (build/cjs/config/webpack.js:331-338 `getClientSentryConfigFile`), and it
 * prints a deprecation warning when it finds one:
 *
 *   "[@sentry/nextjs] DEPRECATION WARNING: It is recommended renaming your
 *    `sentry.client.config.ts` file, or moving its content to
 *    `instrumentation-client.ts`. When using Turbopack
 *    `sentry.client.config.ts` will no longer work."
 *
 * Next.js 16 builds with Turbopack by default (next/dist/lib/bundler.js:
 * "The default is turbopack when nothing is configured"), and `next build` is
 * invoked here with no bundler flag — which is exactly why `window.__SENTRY__`
 * was `false` in production: the legacy file was never bundled.
 *
 * `instrumentation-client.(js|ts)` is a Next.js file convention supported by
 * both bundlers, and it is the filename the SDK looks for
 * (build/cjs/config/webpack.js:341-344 and, for Turbopack,
 * build/cjs/config/turbopack/generateValueInjectionRules.js:36
 * `matcher: "**\/instrumentation-client.*"`).
 *
 * Do not add a second Sentry.init() in `sentry.client.config.ts` — the SDK
 * warns about double initialisation (build/cjs/client/index.js:39).
 */
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  // Capture 10% of browser traces for performance monitoring
  tracesSampleRate: 0.1,

  // NOTE: `replaysOnErrorSampleRate` / `replaysSessionSampleRate` used to be
  // set here but no `Sentry.replayIntegration()` was ever registered, so
  // Session Replay was inert — the options did nothing except imply a feature
  // we do not have. They are dropped deliberately rather than wired up:
  // replayIntegration() pulls the replay bundle into the client chunk, which
  // is the opposite of what this pass is for. Re-add both the integration and
  // the sample rates together if Session Replay is ever actually wanted.

  // Strip any credential patterns from breadcrumbs/events before sending
  beforeSend(event) {
    if (event.request?.headers) {
      const h = event.request.headers as Record<string, string>
      if (h['Authorization']) h['Authorization'] = '[REDACTED]'
    }
    return event
  },

  // Silence Sentry in local dev unless explicitly enabled
  enabled: process.env.NODE_ENV === 'production' || !!process.env.NEXT_PUBLIC_SENTRY_DSN,
})

/**
 * App Router navigation instrumentation. Without this export the SDK logs:
 *
 *   "[@sentry/nextjs] ACTION REQUIRED: To instrument navigations, the Sentry
 *    SDK requires you to export an `onRouterTransitionStart` hook from your
 *    `instrumentation-client.(js|ts)` file."
 *
 * (build/cjs/config/withSentryConfig/getFinalConfigObjectUtils.js:134)
 */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
