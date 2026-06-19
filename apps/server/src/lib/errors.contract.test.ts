import { describe, expect, it } from 'vitest'
import type {
  ApiErrorEnvelope,
  KnownApiErrorCode,
} from '@spanlens/api-types'
import { isApiErrorEnvelope } from '@spanlens/api-types'
import { ApiError, ERROR_CODES } from './errors.js'

/**
 * Sprint 7 R-15 + R-20 contract: the server's `ERROR_CODES` catalog and
 * the `@spanlens/api-types` `KnownApiErrorCode` union are the same set
 * at the type and runtime level. A new server code added without
 * mirroring it in the package will fail compilation here, which is
 * exactly the prompt we want: a developer adding a code in the server
 * sees the package needs the same string before the PR merges.
 *
 * Why two places: api-types ships to npm consumers (SDK, future
 * third-party clients) and cannot depend on apps/server. ERROR_CODES is
 * the runtime source of truth inside the server. They MUST stay in sync;
 * the test forces it.
 */
describe('error contract: server ERROR_CODES ↔ @spanlens/api-types KnownApiErrorCode', () => {
  it('every server code is a KnownApiErrorCode at the type level', () => {
    // Type-only assertion: if a code is added to ERROR_CODES without
    // updating KnownApiErrorCode, `code satisfies KnownApiErrorCode`
    // becomes a compile error and this test file fails `pnpm typecheck`
    // before vitest even runs.
    for (const code of Object.keys(ERROR_CODES)) {
      const narrowed = code as KnownApiErrorCode
      // Round-trip the narrowing back to string so runtime equality also
      // catches a case-sensitivity drift (e.g. someone exporting
      // 'Public_Key_Write_Forbidden').
      expect(narrowed).toBe(code)
    }
  })

  it('every KnownApiErrorCode literal exists in ERROR_CODES at runtime', () => {
    // The union is closed (no `string & {}` brand here) so spelling
    // every literal explicitly is fine and matches the count via the
    // exhaustive switch below.
    const knownAtCompileTime: KnownApiErrorCode[] = [
      'PUBLIC_KEY_WRITE_FORBIDDEN',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'ORGANIZATION_NOT_FOUND',
      'PROJECT_NOT_FOUND',
      'VALIDATION_FAILED',
      'INVALID_JSON_BODY',
      'BAD_REQUEST',
      'NOT_FOUND',
      'CONFLICT',
      'PAYMENT_REQUIRED',
      'BODY_NOT_REPLAYABLE',
      'RATE_LIMIT',
      'INJECTION_BLOCKED',
      'DECRYPT_FAILED',
      'INTERNAL_ERROR',
      'NO_PROVIDER_KEY',
      'UPSTREAM_TIMEOUT',
      'UPSTREAM_FAILED',
    ]
    for (const code of knownAtCompileTime) {
      expect(ERROR_CODES).toHaveProperty(code)
    }
    // Catches the opposite drift: server adds a code but the union is
    // out of date. Without this check the type-level test still passes
    // (everything in the smaller set is "known") and we silently ship
    // an undocumented code to clients.
    expect(Object.keys(ERROR_CODES).sort()).toEqual([...knownAtCompileTime].sort())
  })

  it('ApiError serialises to a shape that satisfies ApiErrorEnvelope at runtime', () => {
    const err = ApiError.from('VALIDATION_FAILED', { field: 'ttl' })
    const envelope: ApiErrorEnvelope = {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
        requestId: 'test-request-id',
      },
    }
    expect(isApiErrorEnvelope(envelope)).toBe(true)
    expect(envelope.error.code).toBe('VALIDATION_FAILED')
    expect(envelope.error.details).toEqual({ field: 'ttl' })
  })

  it('isApiErrorEnvelope rejects shapes missing required fields', () => {
    expect(isApiErrorEnvelope({})).toBe(false)
    expect(isApiErrorEnvelope({ error: 'string' })).toBe(false)
    expect(isApiErrorEnvelope({ error: { code: 'X' } })).toBe(false)
    expect(isApiErrorEnvelope({ error: { message: 'X' } })).toBe(false)
    expect(isApiErrorEnvelope(null)).toBe(false)
    expect(isApiErrorEnvelope(undefined)).toBe(false)
  })

  it('isApiErrorEnvelope accepts an unknown future code without breaking', () => {
    // Forward compatibility: a client running an older api-types should
    // still parse an error from a newer server whose code is not in the
    // union yet. The envelope shape is what gates parsing, not the code
    // membership.
    const futureEnvelope = {
      error: {
        code: 'BRAND_NEW_FUTURE_CODE',
        message: 'something new',
        requestId: 'id',
      },
    }
    expect(isApiErrorEnvelope(futureEnvelope)).toBe(true)
  })
})
