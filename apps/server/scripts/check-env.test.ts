import { describe, expect, test } from 'vitest'
import {
  validateRequiredString,
  validateUrl,
  validateBase64Bytes,
  validateSupabaseRole,
  validatePort,
  validateWebUrl,
} from './check-env.js'

/**
 * Each validator is the user-facing edge of `pnpm check:env`. A regression here
 * means a self-host operator gets a confusing or wrong message at the worst
 * possible moment (during first install). Cases mirror the actual gotchas we
 * have hit in the wild — see CLAUDE.md gotchas 5, 6, 17.
 */

describe('validateRequiredString', () => {
  test('rejects undefined', () => {
    expect(validateRequiredString(undefined, 'FOO')).toEqual({
      status: 'error',
      detail: 'FOO is required but not set',
    })
  })
  test('rejects empty string', () => {
    expect(validateRequiredString('', 'FOO').status).toBe('error')
  })
  test('rejects whitespace-only', () => {
    expect(validateRequiredString('   ', 'FOO').status).toBe('error')
  })
  test('accepts non-empty', () => {
    expect(validateRequiredString('hello', 'FOO')).toEqual({
      status: 'ok',
      detail: '5 chars',
    })
  })
})

describe('validateUrl', () => {
  test('rejects undefined', () => {
    expect(validateUrl(undefined, 'X').status).toBe('error')
  })
  test('rejects malformed', () => {
    expect(validateUrl('not a url', 'X').status).toBe('error')
  })
  test('rejects ftp scheme', () => {
    const r = validateUrl('ftp://example.com', 'X')
    expect(r.status).toBe('error')
    expect(r.detail).toContain('http://')
  })
  test('accepts http://', () => {
    expect(validateUrl('http://localhost:8123', 'X').status).toBe('ok')
  })
  test('accepts https://', () => {
    expect(validateUrl('https://example.com/path', 'X').status).toBe('ok')
  })
})

describe('validateBase64Bytes', () => {
  test('rejects unset', () => {
    const r = validateBase64Bytes(undefined, 'ENCRYPTION_KEY', 32)
    expect(r.status).toBe('error')
    expect('fix' in r && r.fix).toContain('openssl')
  })
  test('rejects 16-byte key (would silently fail provider key decrypt)', () => {
    // gotcha #5 in CLAUDE.md — wrong length silently broke decryption
    const wrong = Buffer.alloc(16, 0xab).toString('base64')
    const r = validateBase64Bytes(wrong, 'ENCRYPTION_KEY', 32)
    expect(r.status).toBe('error')
    expect(r.detail).toContain('16 bytes')
    expect('fix' in r && r.fix).toContain('openssl rand -base64 32')
  })
  test('accepts exactly 32-byte key', () => {
    const ok = Buffer.alloc(32, 0x7f).toString('base64')
    expect(validateBase64Bytes(ok, 'ENCRYPTION_KEY', 32).status).toBe('ok')
  })
  test('accepts both standard and url-safe base64 variants', () => {
    // Node's Buffer.from(value, 'base64') is lenient with both variants.
    const standard = Buffer.alloc(32, 0).toString('base64')
    expect(validateBase64Bytes(standard, 'X', 32).status).toBe('ok')
  })
})

/**
 * Tiny helper: forge a JWT with the role claim we want to test against.
 * Real Supabase JWTs are signed but we only inspect the payload here, so an
 * unsigned token is enough for these tests.
 */
function forgeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.signature`
}

describe('validateSupabaseRole', () => {
  test('rejects unset', () => {
    expect(validateSupabaseRole(undefined, 'service_role').status).toBe('error')
  })
  test('rejects non-JWT', () => {
    const r = validateSupabaseRole('not-a-jwt', 'service_role')
    expect(r.status).toBe('error')
    expect(r.detail).toContain('3 dot-separated parts')
  })
  test('rejects anon key in the service_role slot (common mix-up)', () => {
    const anon = forgeJwt({ role: 'anon', iss: 'supabase' })
    const r = validateSupabaseRole(anon, 'service_role')
    expect(r.status).toBe('error')
    expect(r.detail).toContain('anon')
    expect(r.detail).toContain('service_role')
  })
  test('rejects service_role in the anon slot', () => {
    const svc = forgeJwt({ role: 'service_role', iss: 'supabase' })
    const r = validateSupabaseRole(svc, 'anon')
    expect(r.status).toBe('error')
  })
  test('accepts correct role match', () => {
    const ok = forgeJwt({ role: 'service_role', iss: 'supabase' })
    expect(validateSupabaseRole(ok, 'service_role').status).toBe('ok')
  })
  test('rejects malformed payload (not JSON)', () => {
    const bad = `aaa.${Buffer.from('not json').toString('base64url')}.sig`
    expect(validateSupabaseRole(bad, 'anon').status).toBe('error')
  })
})

describe('validatePort', () => {
  test('accepts unset (defaults to 3001)', () => {
    expect(validatePort(undefined).status).toBe('ok')
  })
  test('rejects non-integer', () => {
    expect(validatePort('abc').status).toBe('error')
  })
  test('rejects negative', () => {
    expect(validatePort('-1').status).toBe('error')
  })
  test('rejects 0', () => {
    expect(validatePort('0').status).toBe('error')
  })
  test('rejects 65536', () => {
    expect(validatePort('65536').status).toBe('error')
  })
  test('accepts 3001', () => {
    expect(validatePort('3001')).toEqual({ status: 'ok', detail: '3001' })
  })
  test('accepts 65535', () => {
    expect(validatePort('65535').status).toBe('ok')
  })
})

describe('validateWebUrl', () => {
  test('warns (not errors) when unset — local dev still works', () => {
    expect(validateWebUrl(undefined).status).toBe('warn')
  })
  test('warns when malformed', () => {
    // gotcha #17 — invite emails break silently with localhost in production
    expect(validateWebUrl('not a url').status).toBe('error')
  })
  test('accepts http://localhost (dev OK)', () => {
    expect(validateWebUrl('http://localhost:3000').status).toBe('ok')
  })
  test('accepts https://canonical', () => {
    expect(validateWebUrl('https://www.spanlens.io').status).toBe('ok')
  })
  test('warns when localhost combined with NODE_ENV=production', () => {
    const prev = process.env['NODE_ENV']
    process.env['NODE_ENV'] = 'production'
    try {
      const r = validateWebUrl('http://localhost:3000')
      expect(r.status).toBe('warn')
      expect(r.detail).toContain('production')
    } finally {
      if (prev === undefined) delete process.env['NODE_ENV']
      else process.env['NODE_ENV'] = prev
    }
  })
})
