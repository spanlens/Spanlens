import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Tests for the logger fallback branch (P2.6). When ClickHouse INSERT fails,
// the row MUST land in `requests_fallback` instead of being silently dropped.
// A regression here means CH outages eat customer billing data.
// ─────────────────────────────────────────────────────────────────────────────

const clickhouseInsertMock = vi.fn()
const fallbackInsertMock = vi.fn()
const fallbackUpdateMock = vi.fn().mockResolvedValue({ data: null })
const supabaseFromMock = vi.fn()

vi.mock('../lib/clickhouse.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/clickhouse.js')>(
    '../lib/clickhouse.js',
  )
  return {
    ...actual,
    getClickhouse: () => ({
      insert: (opts: unknown) => clickhouseInsertMock(opts),
    }),
  }
})

vi.mock('../lib/db.js', () => ({
  supabaseAdmin: {
    from: (table: string) => supabaseFromMock(table),
  },
}))

vi.mock('../lib/resend.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({ sent: false }),
  renderSecurityAlertEmail: vi.fn().mockReturnValue({ subject: '', html: '' }),
}))

let logRequestAsync: typeof import('../lib/logger.js').logRequestAsync

beforeEach(async () => {
  vi.resetModules()
  clickhouseInsertMock.mockReset()
  fallbackInsertMock.mockReset()
  fallbackUpdateMock.mockReset()
  fallbackUpdateMock.mockResolvedValue({ data: null })
  supabaseFromMock.mockReset()

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

  ;({ logRequestAsync } = await import('../lib/logger.js'))
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
  test('CH INSERT succeeds → no fallback INSERT', async () => {
    clickhouseInsertMock.mockResolvedValue(undefined)

    await logRequestAsync(baseLog)

    // Phase 5.1 dual-write: requests + events shadow insert = 2 calls.
    expect(clickhouseInsertMock).toHaveBeenCalledTimes(2)
    expect(fallbackInsertMock).not.toHaveBeenCalled()
  })
})

describe('logRequestAsync — fallback branch (P2.6)', () => {
  test('CH INSERT throws → row preserved in requests_fallback', async () => {
    clickhouseInsertMock.mockRejectedValue(new Error('CH unreachable: ECONNREFUSED'))

    await logRequestAsync(baseLog)

    expect(fallbackInsertMock).toHaveBeenCalledOnce()
    const args = fallbackInsertMock.mock.calls[0]?.[0] as {
      payload: Record<string, unknown>
      organization_id: string
      last_error: string
    }
    expect(args.organization_id).toBe('org_1')
    // The payload mirrors the CH row shape — verify a few key fields
    expect(args.payload['provider']).toBe('openai')
    expect(args.payload['model']).toBe('gpt-4o-mini')
    expect(args.payload['organization_id']).toBe('org_1')
    expect(args.payload['cost_usd']).toBe(0.0001)
    // Error message captured for triage (truncated to 500)
    expect(args.last_error).toContain('ECONNREFUSED')
    expect(args.last_error.length).toBeLessThanOrEqual(500)
  })

  test('Both CH AND fallback fail → no throw (observability never crashes user)', async () => {
    clickhouseInsertMock.mockRejectedValue(new Error('CH down'))
    fallbackInsertMock.mockRejectedValue(new Error('Supabase also down'))

    // Should not throw — logger is fire-and-forget and must absorb every error
    await expect(logRequestAsync(baseLog)).resolves.toBeUndefined()
  })

  test('fallback payload omits sensitive identifiers when logBodyMode=none', async () => {
    clickhouseInsertMock.mockRejectedValue(new Error('CH down'))

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
    clickhouseInsertMock.mockRejectedValue(new Error(longMsg))

    await logRequestAsync(baseLog)

    const args = fallbackInsertMock.mock.calls[0]?.[0] as { last_error: string }
    expect(args.last_error.length).toBeLessThanOrEqual(500)
  })
})
