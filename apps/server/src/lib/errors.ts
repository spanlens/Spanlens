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
  // BAD_REQUEST is the generic 400 fallback the Sprint 8 codemod emits
  // when the legacy `c.json({ error: '...' }, 400)` message doesn't
  // match a more specific shape (VALIDATION_FAILED for "x is required"
  // / "must be" / etc., INVALID_JSON_BODY for parse failures,
  // NO_PROVIDER_KEY for the proxy misconfiguration). Prefer one of the
  // specific codes when adding new throw sites by hand.
  BAD_REQUEST: { status: 400, message: 'Bad request' },

  // Resource lifecycle.
  NOT_FOUND: { status: 404, message: 'Resource not found' },
  CONFLICT: { status: 409, message: 'Resource conflict' },

  // Rate limiting. The legacy 429 paths in rateLimit.ts and quota.ts
  // currently return their own envelope; Sprint 8 will route them through
  // this code so the SDK can switch on err.code === 'RATE_LIMIT'.
  RATE_LIMIT: { status: 429, message: 'Rate limit exceeded' },

  // Security policy block. Proxy endpoints (proxy/openai|anthropic|azure|
  // gemini) raise this when scanAll() detects a prompt-injection attempt
  // in the request body AND the project has Spanlens security blocking
  // enabled. Different from VALIDATION_FAILED (schema issue) and
  // UNAUTHORIZED (auth issue) — the request is well-formed but the
  // policy refuses to forward it upstream. 422 mirrors what most LLM
  // proxies use for "well-formed but rejected" content.
  INJECTION_BLOCKED: {
    status: 422,
    message: 'Request blocked by Spanlens security policy: prompt injection detected',
  },

  // Upstream / infrastructure failures.
  DECRYPT_FAILED: {
    status: 503,
    message: 'Provider key decryption failed; check ENCRYPTION_KEY configuration',
  },
  INTERNAL_ERROR: { status: 500, message: 'Internal server error' },

  // Proxy-specific. Sprint 7 PR 3 migration: proxy/* handlers throw these
  // instead of returning ad-hoc { error: '...' } shapes. NO_PROVIDER_KEY
  // is the most common operator misconfiguration so it gets its own code
  // even though it overlaps with NOT_FOUND semantically.
  NO_PROVIDER_KEY: {
    status: 400,
    message: 'No active provider key registered for this Spanlens key',
  },
  UPSTREAM_TIMEOUT: { status: 504, message: 'Upstream request timed out' },
  UPSTREAM_FAILED: { status: 502, message: 'Upstream request failed' },
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

/**
 * Serialise an error as the standard envelope. Called from app.ts's
 * global `app.onError` handler and from any standalone router whose
 * tests exercise it directly (paddleWebhookRouter is the current example
 * — its unit tests invoke `paddleWebhookRouter.request(...)` rather than
 * the full app, so a thrown ApiError must be caught at the router level
 * instead of bubbling up to app.onError).
 *
 * Keep the shape identical to app.ts so the SDK contract stays one
 * shape regardless of which onError handler caught the throw.
 *
 * `requestId` is plucked from context if the requestId middleware ran;
 * tests that mount the router without that middleware pass through as
 * null.
 */
export function serializeErrorEnvelope(
  err: unknown,
  requestId: string | null,
): { status: number; body: { error: { code: string; message: string; details?: Record<string, unknown>; requestId: string | null } } } {
  if (isApiError(err)) {
    return {
      status: err.status,
      body: {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
          requestId,
        },
      },
    }
  }
  return {
    status: 500,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Unexpected error',
        requestId,
      },
    },
  }
}
