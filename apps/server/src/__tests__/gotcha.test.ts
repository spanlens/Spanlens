/**
 * Known Gotcha 회귀 테스트
 *
 * CLAUDE.md "Known Gotchas" 섹션의 각 항목이 코드에서 올바르게 처리되는지 검증합니다.
 * 기존 테스트에서 커버되지 않은 케이스만 이 파일에 추가합니다.
 *
 * 이미 커버된 항목:
 *  - Gotcha #1 Anthropic message_delta → streaming.test.ts + parsers.test.ts
 *  - Gotcha #2 비용 null (unknown model) → cost.test.ts
 *  - Gotcha #5 복호화 빈 문자열 (wrong key) → crypto.test.ts
 *
 * 이 파일에서 커버하는 항목:
 *  - Gotcha #5 심층: getDecryptedProviderKey()가 빈 문자열 대신 null 반환
 *  - logRequestAsync: Postgres write path + API key masking
 *    (supersedes the Supabase-RLS framing of Gotcha #3)
 *  - Postgres retargets of gotchas #18/#19/#20/#34, which were written
 *    against the store `requests` used to live in
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { aes256Encrypt } from '../lib/crypto.js'

// ── supabaseAdmin 모킹 (DB 연결 없이 테스트) ──────────────────────────────────
//
// vitest는 vi.mock() 호출을 파일 최상단으로 호이스팅하므로
// import 순서와 관계없이 아래 mock이 먼저 적용됩니다.

vi.mock('../lib/db.js', () => {
  const mockChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn(),
    update: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
  }
  return {
    supabaseAdmin: {
      from: vi.fn(() => mockChain),
      auth: { admin: { getUserById: vi.fn().mockResolvedValue({ data: { user: null } }) } },
    },
    supabaseClient: {},
    // mockChain을 외부에서 접근하기 위해 내보냄
    __mockChain: mockChain,
  }
})

// Postgres driver mock — logger.ts writes the `requests` row through
// `pgExecute`. `vi.hoisted` so the mock fns exist before the (hoisted) module
// imports below trigger the factory.
const { mockPgExecute, mockPgQuery } = vi.hoisted(() => ({
  mockPgExecute: vi.fn(),
  mockPgQuery: vi.fn(),
}))

vi.mock('../lib/postgres.js', async (importOriginal) => {
  // Partial mock: the driver entry points are stubbed, the parameter shim
  // (`toPositional`) stays real so the statement the logger builds is bound
  // exactly as it would be in production.
  const actual = await importOriginal<typeof import('../lib/postgres.js')>()
  return {
    ...actual,
    pgExecute: (opts: unknown) => mockPgExecute(opts),
    pgQuery: (opts: unknown) => mockPgQuery(opts),
  }
})

// mock 선언 이후에 import
import { getDecryptedProviderKey } from '../proxy/utils.js'
import { _clearProviderKeyCacheForTests } from '../lib/provider-key-cache.js'
import { supabaseAdmin } from '../lib/db.js'

const CORRECT_KEY_ENV = Buffer.from('a'.repeat(32)).toString('base64')
const WRONG_KEY_ENV = Buffer.from('z'.repeat(32)).toString('base64')

// ── Gotcha #5: getDecryptedProviderKey — 복호화 빈 문자열 처리 ────────────────

describe('getDecryptedProviderKey — Gotcha #5 (decryption empty string → null)', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = CORRECT_KEY_ENV
    vi.clearAllMocks()
    // P3.2: the provider_keys row lookup is cached in-process now, and every
    // case below reuses the same ('api-key-789', 'openai') pair with a
    // different mocked DB result. Without this reset the second test would
    // be served the first test's ciphertext from cache and never reach the
    // decrypt path it is asserting on.
    _clearProviderKeyCacheForTests()
  })

  afterEach(() => {
    // 테스트 격리: 환경변수 복원
    process.env.ENCRYPTION_KEY = CORRECT_KEY_ENV
    _clearProviderKeyCacheForTests()
  })

  // Mock helper — matches the query chain used by getDecryptedProviderKey
  // (project-first lookup ends in .maybeSingle(); org fallback also ends in .maybeSingle()).
  function mockKeyLookup(result: { data: { id: string; encrypted_key: string } | null; error: unknown | null }) {
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(result),
    } as never)
  }

  it('returns { plaintext, id } when ENCRYPTION_KEY matches', async () => {
    const plaintext = 'sk-openai-real-key-abc123'
    const ciphertext = await aes256Encrypt(plaintext)

    // Project-specific key found → returns immediately, no org fallback needed
    mockKeyLookup({ data: { id: 'pk-uuid-123', encrypted_key: ciphertext }, error: null })

    const result = await getDecryptedProviderKey('api-key-789', 'openai')
    expect(result).toEqual({ plaintext, id: 'pk-uuid-123', metadata: {} })
  })

  it('returns null (not empty plaintext) when ENCRYPTION_KEY is wrong [Known Gotcha #5]', async () => {
    process.env.ENCRYPTION_KEY = CORRECT_KEY_ENV
    const ciphertext = await aes256Encrypt('sk-openai-real-key-abc123')
    process.env.ENCRYPTION_KEY = WRONG_KEY_ENV

    // Single lookup under nested-keys model — decryption fails → null.
    mockKeyLookup({ data: { id: 'pk-uuid-123', encrypted_key: ciphertext }, error: null })

    const result = await getDecryptedProviderKey('api-key-789', 'openai')

    // null guarantees the proxy never sends an empty Bearer token to OpenAI
    expect(result).toBeNull()
  })

  it('returns null when no provider key row exists in DB', async () => {
    mockKeyLookup({ data: null, error: null })

    const result = await getDecryptedProviderKey('api-key-789', 'openai')
    expect(result).toBeNull()
  })

  it('returns null when encrypted_key is empty/garbage in DB', async () => {
    // Garbage ciphertext → decryption returns empty string → null.
    mockKeyLookup({ data: { id: 'pk-uuid-123', encrypted_key: 'dG9vc2hvcnQ=' }, error: null })

    const result = await getDecryptedProviderKey('api-key-789', 'openai')
    expect(result).toBeNull()
  })
})

// ── logRequestAsync: Postgres write path + API key masking ──────────────────
//
// Gotcha #3 was framed as "logger must use supabaseAdmin so RLS doesn't block
// the insert". The insert now goes through the `pgExecute` driver helper
// rather than PostgREST, so RLS is not what stands in the way; the contract
// asserted here is:
//   1. logger writes one bound INSERT INTO requests via pgExecute(...)
//   2. body columns are mask-scrubbed before insert (no leaked API keys)
//   3. > 64KB bodies are truncated to keep rows bounded
//   4. insert failures don't throw (fire-and-forget contract)
//
// The masking policy is recorded in docs/plans/clickhouse-migration.md §3.4.

describe('logRequestAsync — Postgres write path', () => {
  beforeEach(() => {
    mockPgExecute.mockClear()
    mockPgExecute.mockResolvedValue(1)
    mockPgQuery.mockClear()
    mockPgQuery.mockResolvedValue([])
  })

  /**
   * The logger binds one parameter per column, named for the column, so the
   * params object IS the row. Also asserts the statement shape while we are
   * here: a value that reached the SQL text instead of a placeholder would be
   * customer prompt text pasted into a statement.
   */
  function getInsertedRow(): Record<string, unknown> {
    const call = mockPgExecute.mock.calls[0]?.[0] as
      | { query: string; params: Record<string, unknown> }
      | undefined
    if (!call) throw new Error('pgExecute was not called')
    expect(call.query).toContain('INSERT INTO requests (')
    // jsonb columns carry an explicit cast; everything else is a bare bind.
    expect(call.query).toContain('{flags}::jsonb')
    expect(call.query).toContain('{response_flags}::jsonb')
    return call.params
  }

  it('inserts a row into the Postgres requests table', async () => {
    const { logRequestAsync } = await import('../lib/logger.js')

    await logRequestAsync({
      organizationId: 'org-1',
      projectId: 'proj-1',
      apiKeyId: 'key-1',
      provider: 'openai',
      model: 'gpt-4o',
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      costUsd: 0.001,
      latencyMs: 150,
      statusCode: 200,
      requestBody: null,
      responseBody: null,
      errorMessage: null,
      traceId: null,
      spanId: null,
    })

    // One statement per logged request.
    expect(mockPgExecute).toHaveBeenCalledOnce()
    const row = getInsertedRow()
    expect(row.organization_id).toBe('org-1')
    expect(row.provider).toBe('openai')
    expect(row.model).toBe('gpt-4o')
    expect(row.total_tokens).toBe(30)
    expect(typeof row.id).toBe('string')        // generated client-side
    expect(typeof row.created_at).toBe('string') // ISO8601

    // Real booleans, not 0/1. Binding a number to a `boolean` column is an
    // error the driver raises, so this is the shape the write path has to
    // keep.
    expect(row.truncated).toBe(false)
    expect(row.cache_hit).toBe(false)
    expect(row.has_security_flags).toBe(false)
  })

  it('truncates request_body > 64KB before insert', async () => {
    const { logRequestAsync } = await import('../lib/logger.js')

    const bigContent = 'x'.repeat(80 * 1024)
    await logRequestAsync({
      organizationId: 'org-1', projectId: 'p-1', apiKeyId: 'k-1',
      provider: 'openai', model: 'gpt-4o',
      promptTokens: 0, completionTokens: 0, totalTokens: 0,
      costUsd: null, latencyMs: 100, statusCode: 200,
      requestBody: { messages: [{ role: 'user', content: bigContent }] },
      responseBody: null,
      errorMessage: null, traceId: null, spanId: null,
    })

    // request_body is stored as text, not jsonb — bodies are opaque payloads
    // we never query into. After truncation it carries the envelope keys
    // produced by maybeTruncateBody.
    const row = getInsertedRow()
    const body = JSON.parse(row.request_body as string) as Record<string, unknown>
    expect(body._truncated).toBe(true)
    expect(body._original_size_bytes).toBeGreaterThan(80 * 1024)
    expect((body._preview as string).length).toBeLessThanOrEqual(2 * 1024)
  })

  it('passes small body through unchanged (< 64KB)', async () => {
    const { logRequestAsync } = await import('../lib/logger.js')

    const smallBody = { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }
    await logRequestAsync({
      organizationId: 'org-1', projectId: 'p-1', apiKeyId: 'k-1',
      provider: 'openai', model: 'gpt-4o',
      promptTokens: 0, completionTokens: 0, totalTokens: 0,
      costUsd: null, latencyMs: 100, statusCode: 200,
      requestBody: smallBody, responseBody: null,
      errorMessage: null, traceId: null, spanId: null,
    })

    const row = getInsertedRow()
    expect(JSON.parse(row.request_body as string)).toEqual(smallBody)
  })

  it('masks provider API keys leaked into the body before insert', async () => {
    const { logRequestAsync } = await import('../lib/logger.js')

    await logRequestAsync({
      organizationId: 'org-1', projectId: 'p-1', apiKeyId: 'k-1',
      provider: 'openai', model: 'gpt-4o',
      promptTokens: 0, completionTokens: 0, totalTokens: 0,
      costUsd: null, latencyMs: 100, statusCode: 200,
      requestBody: {
        messages: [{ role: 'system', content: 'use sk-abc123DEF456ghi789jkl for auth' }],
      },
      responseBody: { error: 'invalid AIzaSyABC123def456GHI789jkl' },
      errorMessage: 'token sk-ant-abcdef123456789xyz expired',
      traceId: null, spanId: null,
    })

    const row = getInsertedRow()
    expect(row.request_body).toContain('sk-***')
    expect(row.request_body).not.toContain('sk-abc123')
    expect(row.response_body).toContain('AIza***')
    expect(row.response_body).not.toContain('AIzaSyABC123')
    expect(row.error_message).toBe('token sk-ant-*** expired')
  })

  it('does not throw when the requests insert fails', async () => {
    // Fire-and-forget contract: a logging failure must never bubble up to the
    // proxy critical path. CLAUDE.md gotcha #8.
    mockPgExecute.mockRejectedValueOnce(new Error('connection refused'))

    const { logRequestAsync } = await import('../lib/logger.js')

    await expect(
      logRequestAsync({
        organizationId: 'org-1', projectId: 'proj-1', apiKeyId: 'key-1',
        provider: 'openai', model: 'gpt-4o',
        promptTokens: 0, completionTokens: 0, totalTokens: 0,
        costUsd: null, latencyMs: 100, statusCode: 200,
        requestBody: null, responseBody: null, errorMessage: null,
        traceId: null, spanId: null,
      })
    ).resolves.toBeUndefined()
  })

  // ── logBody opt-out (x-spanlens-log-body header) ────────────────────────
  // The customer-facing data-minimization knob. Tested here so the
  // insert-payload contract stays explicit; the proxy layer is only
  // responsible for parsing the header into logBodyMode.

  it("logBodyMode='meta' drops bodies but keeps identifiers and tokens", async () => {
    const { logRequestAsync } = await import('../lib/logger.js')

    await logRequestAsync({
      organizationId: 'org-1', projectId: 'p-1', apiKeyId: 'k-1',
      provider: 'openai', model: 'gpt-4o',
      promptTokens: 100, completionTokens: 50, totalTokens: 150,
      costUsd: 0.001, latencyMs: 200, statusCode: 200,
      requestBody: { messages: [{ role: 'user', content: 'sensitive prompt' }] },
      responseBody: { choices: [{ message: { content: 'sensitive response' } }] },
      errorMessage: null,
      traceId: 'trace-x', spanId: 'span-y',
      userId: 'user-z', sessionId: 'sess-w',
      logBodyMode: 'meta',
    })

    const row = getInsertedRow()
    expect(row.request_body).toBe('')
    expect(row.response_body).toBe('')
    // meta keeps everything else
    expect(row.user_id).toBe('user-z')
    expect(row.session_id).toBe('sess-w')
    expect(row.total_tokens).toBe(150)
    expect(row.model).toBe('gpt-4o')
    expect(row.cost_usd).toBe(0.001)
    expect(row.trace_id).toBe('trace-x')
  })

  it("logBodyMode='none' additionally drops user_id and session_id", async () => {
    const { logRequestAsync } = await import('../lib/logger.js')

    await logRequestAsync({
      organizationId: 'org-1', projectId: 'p-1', apiKeyId: 'k-1',
      provider: 'openai', model: 'gpt-4o',
      promptTokens: 10, completionTokens: 5, totalTokens: 15,
      costUsd: 0.0001, latencyMs: 50, statusCode: 200,
      requestBody: { messages: [{ role: 'user', content: 'pii prompt' }] },
      responseBody: { choices: [] },
      errorMessage: null,
      traceId: 't', spanId: 's',
      userId: 'identifying-user', sessionId: 'identifying-session',
      logBodyMode: 'none',
    })

    const row = getInsertedRow()
    expect(row.request_body).toBe('')
    expect(row.response_body).toBe('')
    expect(row.user_id).toBeNull()
    expect(row.session_id).toBeNull()
    // Other metadata still flows through
    expect(row.total_tokens).toBe(15)
    expect(row.trace_id).toBe('t')
  })

  it("logBodyMode default is 'full' — bodies stored with masking", async () => {
    const { logRequestAsync } = await import('../lib/logger.js')

    await logRequestAsync({
      organizationId: 'org-1', projectId: 'p-1', apiKeyId: 'k-1',
      provider: 'openai', model: 'gpt-4o',
      promptTokens: 0, completionTokens: 0, totalTokens: 0,
      costUsd: null, latencyMs: 100, statusCode: 200,
      requestBody: { messages: [{ role: 'user', content: 'hello' }] },
      responseBody: { ok: true },
      errorMessage: null,
      traceId: null, spanId: null,
      // logBodyMode intentionally omitted
    })

    const row = getInsertedRow()
    expect(row.request_body).not.toBe('')
    expect(JSON.parse(row.request_body as string)).toEqual({
      messages: [{ role: 'user', content: 'hello' }],
    })
    expect(JSON.parse(row.response_body as string)).toEqual({ ok: true })
  })
})

// ── Postgres-era retargets of the ClickHouse-specific gotchas ───────────────
//
// CLAUDE.md carried five gotchas that existed only because `requests` lived in
// ClickHouse. Four of them have a Postgres counterpart worth pinning; each is
// retargeted below rather than dropped, because in every case the *reason* the
// gotcha existed still points at a live failure mode.
//
//   #18  DateTime64 rejected a trailing `Z`, so every write had to go through
//        toClickhouseTimestamp(). Postgres takes ISO-8601 directly, the
//        helper is gone, and re-introducing a reformat is the regression.
//   #19  JSONEachRow returned every number as a string. STILL TRUE, for a
//        different reason: node-postgres hands back `numeric` and `int8` as
//        strings so precision past 2^53 is not silently lost.
//   #20  ClickHouse had no `ilike`, so searches used positionCaseInsensitive.
//        Postgres has ILIKE, and using it here would be a real bug, because
//        `%` and `_` inside a caller's search term become wildcards.
//   #34  trace_id was Nullable(UUID); a non-UUID value made ClickHouse reject
//        the whole row silently. The column is `text` now, so arbitrary
//        client-supplied trace ids must survive verbatim.
//
// #37 (an aggregate alias shadowing a column name broke the WHERE clause) has
// no Postgres counterpart: an output alias never resolves in WHERE there, so
// no invariant is left for application code to hold. Deliberately not
// retargeted.

describe('Postgres write path — gotcha #18 (timestamps) and #34 (trace ids)', () => {
  beforeEach(() => {
    mockPgExecute.mockClear()
    mockPgExecute.mockResolvedValue(1)
    mockPgQuery.mockClear()
    mockPgQuery.mockResolvedValue([])
  })

  function boundRow(): Record<string, unknown> {
    const call = mockPgExecute.mock.calls[0]?.[0] as
      | { query: string; params: Record<string, unknown> }
      | undefined
    if (!call) throw new Error('pgExecute was not called')
    return call.params
  }

  it('[#18] stamps created_at as plain ISO-8601 with Z, with no reformatting', async () => {
    const { logRequestAsync } = await import('../lib/logger.js')

    await logRequestAsync({
      organizationId: 'org-1', projectId: 'p-1', apiKeyId: 'k-1',
      provider: 'openai', model: 'gpt-4o',
      promptTokens: 0, completionTokens: 0, totalTokens: 0,
      costUsd: null, latencyMs: 10, statusCode: 200,
      requestBody: null, responseBody: null, errorMessage: null,
      traceId: null, spanId: null,
    })

    const createdAt = boundRow()['created_at'] as string
    // Pin the exact shape: a reformat sneaking back in would push a
    // timezone-less, local-looking timestamp into a timestamptz column, where
    // it would be read in the session timezone instead of UTC.
    expect(createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(createdAt).not.toMatch(/^\d{4}-\d{2}-\d{2} /)
    expect(Number.isNaN(new Date(createdAt).getTime())).toBe(false)
  })

  it('[#34] a non-UUID trace_id round-trips instead of destroying the row', async () => {
    const { logRequestAsync } = await import('../lib/logger.js')

    // OTLP hex ids, customer-generated correlation keys, anything at all: the
    // column is `text`, and this layer stores what it is handed. Filtering by
    // shape belongs at the proxy boundary (proxy/shared/log-base.ts), not
    // here, where dropping a value would take the whole row with it.
    await logRequestAsync({
      organizationId: 'org-1', projectId: 'p-1', apiKeyId: 'k-1',
      provider: 'openai', model: 'gpt-4o',
      promptTokens: 0, completionTokens: 0, totalTokens: 0,
      costUsd: null, latencyMs: 10, statusCode: 200,
      requestBody: null, responseBody: null, errorMessage: null,
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: 'not-a-uuid-either',
    })

    expect(mockPgExecute).toHaveBeenCalledOnce()
    const row = boundRow()
    expect(row['trace_id']).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
    expect(row['span_id']).toBe('not-a-uuid-either')
  })
})

describe('[#19] driver returns numeric / int8 as strings', () => {
  const SCOPE = {
    whereScope:
      'organization_id = {orgId} AND created_at >= now() - make_interval(days => {retentionDays})',
    scopeParams: { orgId: 'org-1', retentionDays: 14 },
    plan: 'free',
  } as const

  beforeEach(() => {
    mockPgQuery.mockReset()
  })

  it('countRequests coerces a string-encoded count(*) to a number', async () => {
    const { countRequests } = await import('../lib/requests-query.js')
    // `count(*)` is int8. node-postgres deliberately leaves it a string rather
    // than risk losing precision past 2^53, exactly as JSONEachRow did.
    mockPgQuery.mockResolvedValue([{ n: '4200' }])

    const n = await countRequests({ scope: SCOPE })
    expect(n).toBe(4200)
    expect(typeof n).toBe('number')
  })

  it('the hazard is real: arithmetic on the raw value concatenates', () => {
    // Pins WHY the coercion has to happen at the boundary. `"4200" + 1` is
    // "42001", and nothing downstream would notice.
    const raw: unknown = '4200'
    expect((raw as string) + 1).toBe('42001')
    expect(Number(raw) + 1).toBe(4201)
  })

  it('an empty result set counts as 0 rather than NaN', async () => {
    const { countRequests } = await import('../lib/requests-query.js')
    mockPgQuery.mockResolvedValue([])
    expect(await countRequests({ scope: SCOPE })).toBe(0)
  })
})

describe('[#20] literal substring search, never ILIKE', () => {
  // Source guard. The behaviour it protects only shows up against a real
  // database (ILIKE and position() differ solely on `%` / `_` in the caller's
  // term), and a mocked query would happily accept either — so the assertion
  // is on the SQL the request handlers assemble.
  //
  // Why it matters: `/requests?model=gpt_4o` under ILIKE matches `gpt-4o`,
  // `gpt.4o`, `gptX4o`. `/users?search=100%` under ILIKE matches every user id
  // beginning with "100". Both are silent wrong-result bugs, not errors.
  const FILES = [
    '../api/requests.ts',
    '../api/exports.ts',
    '../lib/stats-queries.ts',
  ] as const

  async function readSource(rel: string): Promise<string> {
    const { readFile } = await import('node:fs/promises')
    const { fileURLToPath } = await import('node:url')
    return readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
  }

  it('the requests-table filters use position(lower(…) in lower(…))', async () => {
    const requests = await readSource('../api/requests.ts')
    const exportsSrc = await readSource('../api/exports.ts')
    const stats = await readSource('../lib/stats-queries.ts')

    expect(requests).toContain('position(lower({model}) in lower(model)) > 0')
    expect(exportsSrc).toContain('position(lower({model}) in lower(model)) > 0')
    expect(stats).toContain('position(lower({search}) in lower(user_id)) > 0')
    expect(stats).toContain('position(lower({search}) in lower(session_id)) > 0')
  })

  it('no requests-table filter fragment is built with ILIKE', async () => {
    for (const rel of FILES) {
      const src = await readSource(rel)
      const offenders = src
        .split('\n')
        .filter((line) => /filters\.push\(/.test(line) && /ilike/i.test(line))
      expect(offenders).toEqual([])
    }
  })

  it('a search term containing % or _ is a bound value, not a pattern', async () => {
    const { toPositional } = await import('../lib/postgres.js')
    // The wildcard characters never reach the statement, so nothing can
    // interpret them.
    const { text, values } = toPositional(
      'SELECT id FROM requests WHERE position(lower({model}) in lower(model)) > 0',
      { model: 'gpt_4o%' },
    )
    expect(text).toContain('position(lower($1) in lower(model)) > 0')
    expect(text).not.toContain('%')
    expect(values).toEqual(['gpt_4o%'])
  })
})

describe('parseLogBodyMode', () => {
  it('accepts the three documented values', async () => {
    const { parseLogBodyMode } = await import('../lib/logger.js')
    expect(parseLogBodyMode('full')).toBe('full')
    expect(parseLogBodyMode('meta')).toBe('meta')
    expect(parseLogBodyMode('none')).toBe('none')
  })

  it('falls back to full for missing or invalid headers', async () => {
    const { parseLogBodyMode } = await import('../lib/logger.js')
    expect(parseLogBodyMode(null)).toBe('full')
    expect(parseLogBodyMode(undefined)).toBe('full')
    expect(parseLogBodyMode('garbage')).toBe('full')
    expect(parseLogBodyMode('')).toBe('full')
  })
})
