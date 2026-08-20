// Loaded explicitly by `register()` in instrumentation.ts when
// NEXT_RUNTIME === 'nodejs'. @sentry/nextjs 10.x does not discover this
// filename on its own (it appears nowhere in the SDK's build output), so
// nothing here runs unless instrumentation.ts imports it.
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  enabled: process.env.NODE_ENV === 'production' || !!process.env.NEXT_PUBLIC_SENTRY_DSN,
})
