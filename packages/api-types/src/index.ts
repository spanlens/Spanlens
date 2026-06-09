/**
 * @spanlens/api-types — error envelope contract shared between server
 * and every typed client (apps/web, packages/sdk).
 *
 * Why a separate package: the dashboard, the SDK, and any third-party
 * consumer (Hono RPC, a generated OpenAPI client) all need to agree on
 * the shape of an error response. Defining that shape in
 * `apps/server/src/lib/errors.ts` works for the server, but the CLAUDE.md
 * dependency rule forbids `packages/` from importing `apps/`. The
 * envelope therefore lives here as the source of truth; the server's
 * `ApiError` class implements it (test verifies they stay in sync).
 *
 * Intentionally NOT exported here:
 *   - The Hono `AppType`. That type is generated from the live router
 *     tree in `apps/server/src/app.ts` and would force a server-to-
 *     package import. Consumers wanting Hono RPC do
 *     `import type { AppType } from 'server/src/app'` directly from
 *     within `apps/web`, where the dependency direction is allowed.
 *   - The `ApiError` class. Class identity does not survive a network
 *     boundary; clients should branch on `error.code` string instead.
 */

/**
 * Stable shape every API error response uses. Echoed back as:
 *
 *   HTTP/1.1 4xx Status
 *   X-Request-ID: <uuid>
 *   {
 *     "error": {
 *       "code": "PUBLIC_KEY_WRITE_FORBIDDEN",
 *       "message": "Public scope keys cannot use proxy, ingest, or OTLP endpoints",
 *       "details": { ... } | undefined,
 *       "requestId": "<uuid>"
 *     }
 *   }
 *
 * Clients should branch on `code` (stable identifier), surface `message`
 * to the user, log `requestId` for support tickets, and treat `details`
 * as a free-form bag of debugging context.
 */
export interface ApiErrorEnvelope {
  error: {
    /** Stable identifier from the server's ERROR_CODES catalog. */
    code: string
    /** Human-readable message; safe to display to end users. */
    message: string
    /** Free-form debugging context. Only present when the server attached one. */
    details?: Record<string, unknown>
    /**
     * UUID stamped by the requestId middleware. Always present in production
     * responses; nullable so test harnesses without the middleware mounted
     * can still serialise.
     */
    requestId: string | null
  }
}

/**
 * Type guard for the envelope. Useful in fetch wrappers that have to
 * narrow `unknown` into a typed error before throwing a domain-specific
 * exception. Does not validate the `code` against any enum because the
 * client and server may ship at different versions; an unknown code is a
 * valid envelope, just one the client cannot interpret structurally.
 */
export function isApiErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (value == null || typeof value !== 'object') return false
  const maybe = value as { error?: unknown }
  if (maybe.error == null || typeof maybe.error !== 'object') return false
  const err = maybe.error as { code?: unknown; message?: unknown }
  return typeof err.code === 'string' && typeof err.message === 'string'
}

/**
 * Initial code catalog mirror. The server's `ERROR_CODES` in
 * `apps/server/src/lib/errors.ts` is the source of truth at runtime; the
 * union below exists only so SDK / dashboard code can write
 * `if (error.code === 'PUBLIC_KEY_WRITE_FORBIDDEN')` without a string
 * literal that the compiler cannot help with.
 *
 * Stay loose intentionally: new server codes ship without coordination,
 * and a `KnownApiErrorCode | (string & {})` union lets clients keep
 * narrowing on the known set while still accepting any string at runtime.
 */
export type KnownApiErrorCode =
  | 'PUBLIC_KEY_WRITE_FORBIDDEN'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'ORGANIZATION_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'INVALID_JSON_BODY'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DECRYPT_FAILED'
  | 'INTERNAL_ERROR'
  | 'NO_PROVIDER_KEY'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_FAILED'

/**
 * Branded string type: a code is known if it matches the literal union,
 * otherwise it stays a plain string at the type level. Lets switch
 * statements stay exhaustive for known cases while still accepting
 * forward-compatible unknown codes from a newer server.
 */
export type ApiErrorCode = KnownApiErrorCode | (string & { _brand?: 'forward-compatible' })
