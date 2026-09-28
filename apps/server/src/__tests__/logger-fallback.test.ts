import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Tests for the logger fallback branch (P2.6). When the INSERT into `requests`
// fails, the row MUST land in `requests_fallback` instead of being silently
// dropped. A regression here means a database outage eats customer billing
// data.
// ─────────────────────────────────────────────────────────────────────────────

const pgExecuteMock = vi.fn()
const fallbackInsertMock = vi.fn()
const fallbackUpdateMock = vi.fn().mockResolvedValue({ data: null })
const supabaseFromMock = vi.fn()
const emitWebhookEventMock = vi.fn()
const deferWebhookEventMock = vi.fn()

vi.mock('../lib/postgres.js', async (importOriginal) => {
  // Partial mock: only the write entry point is stubbed, so the parameter
  // shim the INSERT goes through stays the production one.
  const actual = await importOriginal<typeof import('../lib/postgres.js')>()
  return {
    ...actual,
    pgExecute: (opts: unknown) => pgExecuteMock(opts),
    pgQuery: vi.fn(async () => []),
  }
})

vi.mock('../lib/db.js', () => ({
  supabaseAdmin: {
    from: (table: string) => supabaseFromMock(table),
  },
}))

vi.mock('../lib/webhook-emit.js', () => ({
  emitWebhookEvent: (...args: unknown[]) => emitWebhookEventMock(...args),
  deferWebhookEvent: (...args: unknown[]) => deferWebhookEventMock(...args),
}))

vi.mock('../lib/resend.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({ sent: false }),
  renderSecurityAlertEmail: vi.fn().mockReturnValue({ subject: '', html: '' }),
}))

let logRequestAsync: typeof import('../lib/logger.js').logRequestAsync
let emitRequestCreated: typeof import('../lib/logger.js').emitRequestCreated
let deferRequestCreated: typeof import('../lib/logger.js').deferRequestCreated

beforeEach(async () => {
  vi.resetModules()
  pgExecuteMock.mockReset()
  fallbackInsertMock.mockReset()
  fallbackUpdateMock.mockReset()
  fallbackUpdateMock.mockResolvedValue({ data: null })
  supabaseFromMock.mockReset()
  emitWebhookEventMock.mockReset()
  emitWebhookEventMock.mockResolvedValue(undefined)
  deferWebhookEventMock.mockReset()
  deferWebhookEventMock.mockResolvedValue(undefined)

  // Default chain: insert into requests_fallback succeeds; org-update for
  // security alerts returns no row (so the alert chain bails fast).
  supabaseFromMock.mockImplementation((table: string) => {
    if (table === 'requests_fallback') {
      return { insert: (row: unknown) => fallbackInsertMock(row) }
    }
    // organizations etc — collapse to "alert disabled / no row" so the
    // logger.ts security-alert path doesn't run during unit tests
    return {
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          or: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null }),
            }),
          }),
        }),
      }),
    }
  })
  fallbackInsertMock.mockResolvedValue({ error: null })

  ;({ logRequestAsync, emitRequestCreated, deferRequestCreated } = await import('../lib/logger.js'))
})

afterEach(() => vi.restoreAllMocks())

const baseLog = {
  organizationId: 'org_1',
  projectId: 'proj_1',
  apiKeyId: 'key_1',
  provider: 'openai',
  model: 'gpt-4o-mini',
  promptTokens: 10,
  completionTokens: 5,
  totalTokens: 15,
  costUsd: 0.0001,
  latencyMs: 200,
  statusCode: 200,
  requestBody: { messages: [{ role: 'user', content: 'hi' }] },
  responseBody: { choices: [{ message: { content: 'hello' } }] },
  errorMessage: null,
  traceId: null,
  spanId: null,
}

describe('logRequestAsync — happy path', () => {
  test('requests INSERT succeeds → no fallback INSERT', async () => {
    pgExecuteMock.mockResolvedValue(1)

    await logRequestAsync(baseLog)

    // One statement per logged request: a single INSERT INTO requests.
    expect(pgExecuteMock).toHaveBeenCalledOnce()
    const call = pgExecuteMock.mock.calls[0]?.[0] as { query: string }
    expect(call.query).toContain('INSERT INTO requests')
    expect(fallbackInsertMock).not.toHaveBeenCalled()
  })
})

describe('logRequestAsync — fallback branch (P2.6)', () => {
  test('requests INSERT throws → row preserved in requests_fallback', async () => {
    pgExecuteMock.mockRejectedValue(new Error('pooler unreachable: ECONNREFUSED'))

    await logRequestAsync(baseLog)

    expect(fallbackInsertMock).toHaveBeenCalledOnce()
    const args = fallbackInsertMock.mock.calls[0]?.[0] as {
      payload: Record<string, unknown>
      organization_id: string
      last_error: string
    }
    expect(args.organization_id).toBe('org_1')
    // The payload mirrors the `requests` row shape — verify a few key fields
    expect(args.payload['provider']).toBe('openai')
    expect(args.payload['model']).toBe('gpt-4o-mini')
    expect(args.payload['organization_id']).toBe('org_1')
    expect(args.payload['cost_usd']).toBe(0.0001)
    // Error message captured for triage (truncated to 500)
    expect(args.last_error).toContain('ECONNREFUSED')
    expect(args.last_error.length).toBeLessThanOrEqual(500)
  })

  test('Both Postgres AND the fallback queue fail → no throw (observability never crashes user)', async () => {
    pgExecuteMock.mockRejectedValue(new Error('requests table unreachable'))
    fallbackInsertMock.mockRejectedValue(new Error('Supabase also down'))

    // Should not throw — logger is fire-and-forget and must absorb every error
    await expect(logRequestAsync(baseLog)).resolves.toBeUndefined()
  })

  test('fallback payload omits sensitive identifiers when logBodyMode=none', async () => {
    pgExecuteMock.mockRejectedValue(new Error('requests table unreachable'))

    await logRequestAsync({
      ...baseLog,
      userId: 'usr_secret',
      sessionId: 'sess_secret',
      logBodyMode: 'none',
    })

    const args = fallbackInsertMock.mock.calls[0]?.[0] as { payload: Record<string, unknown> }
    expect(args.payload['user_id']).toBeNull()
    expect(args.payload['session_id']).toBeNull()
    // Bodies also dropped in 'none' mode
    expect(args.payload['request_body']).toBe('')
    expect(args.payload['response_body']).toBe('')
  })

  test('fallback last_error is truncated to 500 chars', async () => {
    const longMsg = 'x'.repeat(2000)
    pgExecuteMock.mockRejectedValue(new Error(longMsg))

    await logRequestAsync(baseLog)

    const args = fallbackInsertMock.mock.calls[0]?.[0] as { last_error: string }
    expect(args.last_error.length).toBeLessThanOrEqual(500)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// supabase-js does not reject on a failed write. Without `throwOnError`, a
// PostgREST 4xx/5xx AND a network failure both RESOLVE with `{ error }`
// (postgrest-js catches the fetch exception itself). So the `catch` around
// the fallback insert only ever fired on a client bug, and a real double
// failure lost the row without the row_lost signal. These tests mock the
// library the way it actually behaves.
// ─────────────────────────────────────────────────────────────────────────────

type ConsoleSpy = { mock: { calls: unknown[][] } }

/** Structured-log codes written through console.error during the call. */
function errorCodesLogged(spy: ConsoleSpy): string[] {
  return spy.mock.calls
    .map((args) => /^ERROR\[([A-Z_]+)\]/.exec(String(args[0]))?.[1] ?? '')
    .filter((code) => code !== '')
}

function rowLostLogged(spy: ConsoleSpy): boolean {
  return spy.mock.calls.some((args) => {
    const line = String(args[0])
    return line.startsWith('ERROR[FALLBACK_INSERT_FAILED]') && line.includes('"kind":"row_lost"')
  })
}

describe('logRequestAsync — fallback insert resolves with { error } (C8.1)', () => {
  test('a resolved { error } from the fallback insert is a lost row: FALLBACK_INSERT_FAILED row_lost', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    pgExecuteMock.mockRejectedValue(new Error('pooler unreachable'))
    fallbackInsertMock.mockResolvedValue({
      data: null,
      error: { message: 'TypeError: fetch failed', code: '' },
      status: 0,
    })

    await expect(logRequestAsync(baseLog)).resolves.toBeUndefined()

    expect(errorCodesLogged(errorSpy)).toContain('REQUEST_LOG_INSERT_FAILED')
    expect(rowLostLogged(errorSpy)).toBe(true)
  })

  test('a rejected fallback insert is still reported as row_lost', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    pgExecuteMock.mockRejectedValue(new Error('requests table unreachable'))
    fallbackInsertMock.mockRejectedValue(new Error('Supabase also down'))

    await logRequestAsync(baseLog)

    expect(rowLostLogged(errorSpy)).toBe(true)
  })

  test('a fallback insert that lands is NOT reported as row_lost', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    pgExecuteMock.mockRejectedValue(new Error('pooler unreachable'))

    await logRequestAsync(baseLog)

    expect(errorCodesLogged(errorSpy)).toContain('REQUEST_LOG_INSERT_FAILED')
    expect(rowLostLogged(errorSpy)).toBe(false)
  })
})

describe('logRequestAsync — request.created only for a row that exists (C8.1)', () => {
  test('live insert lands → request.created carries the stored id and created_at', async () => {
    pgExecuteMock.mockResolvedValue(1)

    await logRequestAsync(baseLog)

    expect(emitWebhookEventMock).toHaveBeenCalledOnce()
    const [orgId, eventType, payload] = emitWebhookEventMock.mock.calls[0] as [
      string,
      string,
      { request: Record<string, unknown> },
    ]
    expect(orgId).toBe('org_1')
    expect(eventType).toBe('request.created')
    const params = (pgExecuteMock.mock.calls[0]?.[0] as { params: Record<string, unknown> }).params
    expect(payload.request['id']).toBe(params['id'])
    expect(payload.request['created_at']).toBe(params['created_at'])
    expect(payload.request['cost_usd']).toBe(0.0001)
    expect(payload.request['status_code']).toBe(200)
  })

  test('both write paths fail → no request.created (the id will never exist)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    pgExecuteMock.mockRejectedValue(new Error('pooler unreachable'))
    fallbackInsertMock.mockResolvedValue({ data: null, error: { message: 'down' } })

    await logRequestAsync(baseLog)

    expect(emitWebhookEventMock).not.toHaveBeenCalled()
  })

  test('row queued to requests_fallback → request.created is deferred to the replay', async () => {
    // The id is not in `requests` yet, and a row the database rejected for
    // its data (an org deleted mid-flight) never will be. The replay emits
    // the event for the rows it actually inserts (lib/fallback-replay.ts).
    vi.spyOn(console, 'error').mockImplementation(() => {})
    pgExecuteMock.mockRejectedValue(new Error('pooler unreachable'))

    await logRequestAsync(baseLog)

    expect(fallbackInsertMock).toHaveBeenCalledOnce()
    expect(emitWebhookEventMock).not.toHaveBeenCalled()
  })
})

describe('deferRequestCreated', () => {
  test('hands the same payload emitRequestCreated sends to the undelivered-delivery path', async () => {
    const row = { id: 'r1', organization_id: 'org_1', provider: 'openai', cost_usd: 0.5, created_at: 't' }

    await emitRequestCreated(row)
    await deferRequestCreated(row, 'ran out of time')

    const [, , sent] = emitWebhookEventMock.mock.calls[0] as [string, string, unknown]
    const [orgId, eventType, deferred, reason] = deferWebhookEventMock.mock.calls[0] as [
      string,
      string,
      unknown,
      string,
    ]
    expect(orgId).toBe('org_1')
    expect(eventType).toBe('request.created')
    expect(deferred).toEqual(sent)
    expect(reason).toBe('ran out of time')
  })

  test('never throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    deferWebhookEventMock.mockRejectedValue(new Error('boom'))

    await expect(deferRequestCreated({ id: 'r1', organization_id: 'org_1' }, 'x')).resolves.toBeUndefined()
  })
})

describe('logRequestAsync — end-user and session ids fit their indexes', () => {
  // requests has partial btree indexes on (organization_id, user_id,
  // created_at) and (organization_id, session_id, created_at). A btree entry
  // tops out near 2.7KB, so a longer x-spanlens-user value failed the live
  // insert with 54000 and then the replay of the queued row.
  function insertedParams(): Record<string, unknown> {
    return (pgExecuteMock.mock.calls[0]?.[0] as { params: Record<string, unknown> }).params
  }

  test('an oversized id is cut to a length the index always accepts', async () => {
    pgExecuteMock.mockResolvedValue(1)

    await logRequestAsync({ ...baseLog, userId: 'u'.repeat(6000), sessionId: 's'.repeat(6000) })

    const params = insertedParams()
    expect(String(params['user_id'])).toBe('u'.repeat(512))
    expect(String(params['session_id'])).toBe('s'.repeat(512))
  })

  test('an ordinary id is stored as is', async () => {
    pgExecuteMock.mockResolvedValue(1)

    await logRequestAsync({ ...baseLog, userId: 'user_42', sessionId: 'sess_7' })

    expect(insertedParams()['user_id']).toBe('user_42')
    expect(insertedParams()['session_id']).toBe('sess_7')
  })

  test('the cut never leaves half of a surrogate pair behind', async () => {
    pgExecuteMock.mockResolvedValue(1)

    await logRequestAsync({ ...baseLog, userId: 'a' + '\u{1F600}'.repeat(400) })

    const stored = String(insertedParams()['user_id'])
    expect(stored.length).toBeLessThanOrEqual(512)
    expect(/[\uD800-\uDBFF]$/.test(stored)).toBe(false)
  })
})
