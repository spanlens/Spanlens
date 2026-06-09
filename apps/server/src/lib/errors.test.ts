import { describe, expect, it } from 'vitest'
import { ApiError, ERROR_CODES, isApiError } from './errors.js'

describe('ApiError', () => {
  it('reads status and default message from the catalog when constructed by code only', () => {
    const err = new ApiError('PUBLIC_KEY_WRITE_FORBIDDEN')
    expect(err.code).toBe('PUBLIC_KEY_WRITE_FORBIDDEN')
    expect(err.status).toBe(403)
    expect(err.message).toBe(ERROR_CODES.PUBLIC_KEY_WRITE_FORBIDDEN.message)
    expect(err.details).toBeUndefined()
    expect(err.name).toBe('ApiError')
  })

  it('honours a custom message override while keeping the catalog status', () => {
    const err = new ApiError('VALIDATION_FAILED', 'field "ttl" must be one of 7d, 30d, never')
    expect(err.status).toBe(400)
    expect(err.message).toBe('field "ttl" must be one of 7d, 30d, never')
  })

  it('attaches details via from() without overriding the message', () => {
    const err = ApiError.from('DECRYPT_FAILED', { provider: 'openai', apiKeyId: 'abc' })
    expect(err.status).toBe(503)
    expect(err.message).toBe(ERROR_CODES.DECRYPT_FAILED.message)
    expect(err.details).toEqual({ provider: 'openai', apiKeyId: 'abc' })
  })

  it('is recognised by isApiError type guard', () => {
    const err = new ApiError('NOT_FOUND')
    expect(isApiError(err)).toBe(true)
  })

  it('rejects vanilla Error in isApiError', () => {
    expect(isApiError(new Error('plain'))).toBe(false)
    expect(isApiError({ name: 'ApiError', code: 'fake' })).toBe(false)
    expect(isApiError(null)).toBe(false)
    expect(isApiError(undefined)).toBe(false)
  })

  it('inherits from Error so existing instanceof Error checks still match', () => {
    const err = new ApiError('CONFLICT')
    expect(err instanceof Error).toBe(true)
  })

  it('ERROR_CODES catalog has stable shape for every entry', () => {
    for (const [code, entry] of Object.entries(ERROR_CODES)) {
      expect(typeof code).toBe('string')
      expect(code.length).toBeGreaterThan(0)
      expect(typeof entry.status).toBe('number')
      expect(entry.status).toBeGreaterThanOrEqual(400)
      expect(entry.status).toBeLessThan(600)
      expect(typeof entry.message).toBe('string')
      expect(entry.message.length).toBeGreaterThan(0)
    }
  })
})
