import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  // Capture 10% of browser traces for performance monitoring
  tracesSampleRate: 0.1,
  // Only show Sentry dialog on unhandled errors in production
  replaysOnErrorSampleRate: process.env.NODE_ENV === 'production' ? 1.0 : 0,
  replaysSessionSampleRate: 0,

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
