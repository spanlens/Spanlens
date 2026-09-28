import { describe, expect, test } from 'vitest'
import { parseRequestFilters } from './request-filters.js'
import { ApiError } from './errors.js'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const KEY = '22222222-2222-4222-8222-222222222222'
const PROMPT_VERSION = '33333333-3333-4333-8333-333333333333'

function reader(query: Record<string, string>): (name: string) => string | undefined {
  return (name) => query[name]
}

function validationError(fn: () => unknown): ApiError {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError)
    return err as ApiError
  }
  throw new Error('expected a validation error')
}

describe('parseRequestFilters', () => {
  test('no filters: no SQL, no params', () => {
    expect(parseRequestFilters(reader({}))).toEqual({ sql: undefined, params: {} })
  })

  test('empty values count as absent, the way the list endpoint always treated them', () => {
    const f = parseRequestFilters(reader({ userId: '', sessionId: '', projectId: '', from: '', status: '' }))
    expect(f).toEqual({ sql: undefined, params: {} })
  })

  test('every filter, in the order the list endpoint has always emitted them', () => {
    const f = parseRequestFilters(
      reader({
        projectId: PROJECT,
        provider: 'openai',
        model: 'mini',
        providerKeyId: KEY,
        promptVersionId: PROMPT_VERSION,
        userId: 'customer-a',
        sessionId: 'sess-1',
        from: '2026-05-01T00:00:00.000Z',
        to: '2026-05-31T23:59:59.000Z',
        status: '4xx',
        truncated: 'true',
      }),
    )
    expect(f.sql).toBe(
      [
        'project_id = {projectId}',
        'provider = {provider}',
        'position(lower({model}) in lower(model)) > 0',
        'provider_key_id = {providerKeyId}',
        'prompt_version_id = {promptVersionId}',
        'user_id = {userId}',
        'session_id = {sessionId}',
        'created_at >= {from}::timestamptz',
        'created_at <= {to}::timestamptz',
        'status_code >= 400 AND status_code < 500',
        'truncated = true',
      ].join(' AND '),
    )
    expect(f.params).toEqual({
      projectId: PROJECT,
      provider: 'openai',
      model: 'mini',
      providerKeyId: KEY,
      promptVersionId: PROMPT_VERSION,
      userId: 'customer-a',
      sessionId: 'sess-1',
      from: '2026-05-01T00:00:00.000Z',
      to: '2026-05-31T23:59:59.000Z',
    })
  })

  test.each([
    ['ok', 'status_code < 400'],
    ['success', 'status_code < 400'],
    ['4xx', 'status_code >= 400 AND status_code < 500'],
    ['5xx', 'status_code >= 500'],
    ['error', 'status_code >= 400'],
  ])('status=%s filters on %s', (status, sql) => {
    expect(parseRequestFilters(reader({ status })).sql).toBe(sql)
  })

  test('status=all and truncated=all are explicit no-ops', () => {
    const strict = parseRequestFilters(reader({ status: 'all', truncated: 'all' }), { strictEnums: true })
    expect(strict.sql).toBeUndefined()
  })

  test.each([
    ['true', 'truncated = true'],
    ['false', 'truncated = false'],
  ])('truncated=%s filters on %s', (truncated, sql) => {
    expect(parseRequestFilters(reader({ truncated })).sql).toBe(sql)
  })

  test.each(['projectId', 'providerKeyId', 'promptVersionId'])(
    'a malformed %s is a 400, not a uuid cast error at query time',
    (field) => {
      const err = validationError(() => parseRequestFilters(reader({ [field]: 'abc' })))
      expect(err.status).toBe(400)
      expect(err.code).toBe('VALIDATION_FAILED')
      expect(err.message).toContain(field)
    },
  )

  test.each(['from', 'to'])('an unparseable %s is a 400', (field) => {
    const err = validationError(() => parseRequestFilters(reader({ [field]: 'garbage' })))
    expect(err.status).toBe(400)
    expect(err.message).toContain(field)
  })

  test('dates reach Postgres as canonical ISO, even when the caller sent a looser form', () => {
    // Date.parse accepts forms timestamptz does not ('1' parses as a year in
    // V8, and Postgres rejects it). Binding the normalised value means a date
    // that passed validation can never fail the cast mid-export.
    const f = parseRequestFilters(reader({ from: '2026-05-01', to: '2026-05-02T10:00:00+09:00' }))
    expect(f.params).toEqual({ from: '2026-05-01T00:00:00.000Z', to: '2026-05-02T01:00:00.000Z' })
  })

  test('a date outside the years timestamptz can take as ISO is a 400', () => {
    const err = validationError(() => parseRequestFilters(reader({ from: '+275760-09-13T00:00:00.000Z' })))
    expect(err.status).toBe(400)
  })

  test('lenient by default: an unknown status or truncated value is ignored (list endpoint contract)', () => {
    expect(parseRequestFilters(reader({ status: 'bogus', truncated: 'maybe' })).sql).toBeUndefined()
  })

  test.each([
    ['status', 'errors'],
    ['truncated', 'yes'],
  ])('strictEnums: an unknown %s=%s is a 400 instead of silently widening', (field, value) => {
    const err = validationError(() =>
      parseRequestFilters(reader({ [field]: value }), { strictEnums: true }),
    )
    expect(err.status).toBe(400)
    expect(err.message).toContain(field)
  })

  test.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'status=%s is an unknown value, not a prototype lookup',
    (status) => {
      expect(parseRequestFilters(reader({ status, truncated: status })).sql).toBeUndefined()
      expect(() => parseRequestFilters(reader({ status }), { strictEnums: true })).toThrow(ApiError)
    },
  )

  test('values are bound, never interpolated', () => {
    const f = parseRequestFilters(reader({ userId: "x' OR '1'='1", sessionId: '{orgId}' }))
    expect(f.sql).toBe('user_id = {userId} AND session_id = {sessionId}')
    expect(f.params).toEqual({ userId: "x' OR '1'='1", sessionId: '{orgId}' })
  })
})
