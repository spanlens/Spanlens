import * as Sentry from '@sentry/node'

/**
 * Initialise Sentry for the Hono server.
 *
 * Call this once at the top of api/index.ts before any request handling.
 * When SENTRY_DSN is absent (local dev or CI without secrets) this is a no-op.
 *
 * beforeSend strips Authorization headers and any sl_live_ / sk- key patterns
 * from the event payload so that customer credentials are never sent to Sentry.
 */
export function initSentry(): void {
  const dsn = process.env['SENTRY_DSN']
  if (!dsn) return

  Sentry.init({
    dsn,
    environment: process.env['NODE_ENV'] ?? 'development',
    // Capture 10% of traces for performance monitoring — increase once baseline established
    tracesSampleRate: 0.1,
    // Profile 10% of sampled transactions
    profilesSampleRate: 0.1,

    beforeSend(event) {
      return stripCredentials(event)
    },
  })
}

const CREDENTIAL_PATTERNS = [
  /\bsl_live_[A-Za-z0-9_-]{12,}/g,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{12,}/g,
  /\bAIza[A-Za-z0-9_-]{12,}/g,
]

function redactString(value: string): string {
  let result = value
  for (const pattern of CREDENTIAL_PATTERNS) {
    pattern.lastIndex = 0
    result = result.replace(pattern, '[REDACTED]')
  }
  return result
}

function stripCredentials<T extends Sentry.Event>(event: T): T {
  // Strip Authorization headers from request context
  if (event.request?.headers) {
    const headers = event.request.headers as Record<string, string>
    if (headers['Authorization'] || headers['authorization']) {
      headers['Authorization'] = '[REDACTED]'
      headers['authorization'] = '[REDACTED]'
    }
    if (headers['x-api-key']) headers['x-api-key'] = '[REDACTED]'
    if (headers['x-goog-api-key']) headers['x-goog-api-key'] = '[REDACTED]'
  }

  // Strip credential patterns from request body
  if (event.request?.data && typeof event.request.data === 'string') {
    event.request.data = redactString(event.request.data)
  }

  // Strip from query string
  if (event.request?.query_string && typeof event.request.query_string === 'string') {
    event.request.query_string = redactString(event.request.query_string)
  }

  return event
}

/**
 * Capture an unexpected server error. Use in catch blocks where the error
 * is not a normal client error (4xx) and warrants investigation.
 */
export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (!process.env['SENTRY_DSN']) return
  Sentry.withScope((scope) => {
    if (context) scope.setExtras(context)
    Sentry.captureException(error)
  })
}
