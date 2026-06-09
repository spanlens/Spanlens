/**
 * Standard API error type for the Hono server (Sprint 7 R-15 + R-20).
 *
 * The 47 router files in `apps/server/src/api/` each invent their own
 * `c.json({ error: '...' }, 4xx)` shape. The SDK and the dashboard both
 * have to special-case which field carries the human message, what the
 * machine-readable code is, and whether a `details` object is present.
 * `ApiError` collapses that into one shape so the `onError` handler in
 * `app.ts` can serialise every thrown error the same way, and the SDK
 * can branch on a single stable `error.code` field.
 *
 * Throwing model:
 *
 *   throw new ApiError('PUBLIC_KEY_WRITE_FORBIDDEN', 'Public key cannot proxy')
 *   throw ApiError.from('DECRYPT_FAILED', { provider: 'openai' })
 *
 * Both reach the global `onError` and serialise to:
 *
 *   { error: { code, message, details?, requestId } }
 *
 * Code catalog: every code lives in `ERROR_CODES` below. Adding a new
 * code is a one-line PR; the type `ErrorCode` re-derives automatically
 * so a typo at the throw site is a compile error rather than a silent
 * 500.
 */

export const ERROR_CODES = {
  // Auth and access control. These are the most operator-visible errors
  // since they surface on every misconfigured customer integration.
  PUBLIC_KEY_WRITE_FORBIDDEN: {
    status: 403,
    message: 'Public scope keys cannot use proxy, ingest, or OTLP endpoints',
  },
  UNAUTHORIZED: { status: 401, message: 'Unauthorized' },
  FORBIDDEN: { status: 403, message: 'Forbidden' },

  // Tenant / scoping.
  ORGANIZATION_NOT_FOUND: { status: 404, message: 'Organization not found' },
  PROJECT_NOT_FOUND: { status: 404, message: 'Project not found' },

  // Validation. Generic catch-all; details should always carry the field
  // names that failed.
  VALIDATION_FAILED: { status: 400, message: 'Request validation failed' },
  INVALID_JSON_BODY: { status: 400, message: 'Invalid JSON body' },

  // Resource lifecycle.
  NOT_FOUND: { status: 404, message: 'Resource not found' },
  CONFLICT: { status: 409, message: 'Resource conflict' },

  // Upstream / infrastructure failures.
  DECRYPT_FAILED: {
    status: 503,
    message: 'Provider key decryption failed; check ENCRYPTION_KEY configuration',
  },
  INTERNAL_ERROR: { status: 500, message: 'Internal server error' },
} as const

export type ErrorCode = keyof typeof ERROR_CODES

/**
 * `ApiError` carries a code from the `ERROR_CODES` catalog plus an
 * optional details object. Status code and default human message come
 * from the catalog so the throw site stays a one-liner.
 *
 * The custom message overload is for the common case where the catalog
 * default needs a contextualised suffix (e.g. add the field name to a
 * `VALIDATION_FAILED`). Pass `undefined` to fall back to the catalog.
 */
export class ApiError extends Error {
  public readonly code: ErrorCode
  public readonly status: number
  public readonly details: Record<string, unknown> | undefined

  constructor(
    code: ErrorCode,
    customMessage?: string | undefined,
    details?: Record<string, unknown>,
  ) {
    const entry = ERROR_CODES[code]
    super(customMessage ?? entry.message)
    this.name = 'ApiError'
    this.code = code
    this.status = entry.status
    this.details = details
  }

  /**
   * Convenience constructor for the common case where you only want to
   * attach details without overriding the message: `ApiError.from('X', { ... })`.
   */
  static from(code: ErrorCode, details: Record<string, unknown>): ApiError {
    return new ApiError(code, undefined, details)
  }
}

/**
 * Type guard: useful in middleware or tests where the caught value is
 * `unknown` but we want to narrow without `instanceof` (which can fail
 * across module boundaries when the same class is loaded twice).
 */
export function isApiError(value: unknown): value is ApiError {
  return (
    value instanceof Error &&
    (value as ApiError).name === 'ApiError' &&
    typeof (value as ApiError).code === 'string'
  )
}
