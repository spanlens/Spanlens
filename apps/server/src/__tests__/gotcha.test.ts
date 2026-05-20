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
 *  - logRequestAsync — ClickHouse write path + API key masking
 *    (replaces the old Supabase-RLS Gotcha #3 after the ClickHouse migration)
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

// ClickHouse client mock — logger.ts now writes here instead of Supabase.
const mockClickhouseInsert = vi.fn().mockResolvedValue({ executed: true })
vi.mock('../lib/clickhouse.js', () => ({
  getClickhouse: () => ({ insert: mockClickhouseInsert }),
  // logger.ts also imports toClickhouseTimestamp — return a deterministic
  // value so test assertions on row contents stay stable.
  toClickhouseTimestamp: () => '2026-05-16 11:49:23.749',
}))

// mock 선언 이후에 import
import { getDecryptedProviderKey } from '../proxy/utils.js'
import { supabaseAdmin } from '../lib/db.js'

const CORRECT_KEY_ENV = Buffer.from('a'.repeat(32)).toString('base64')
const WRONG_KEY_ENV = Buffer.from('z'.repeat(32)).toString('base64')

// ── Gotcha #5: getDecryptedProviderKey — 복호화 빈 문자열 처리 ────────────────

describe('getDecryptedProviderKey — Gotcha #5 (decryption empty string → null)', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = CORRECT_KEY_ENV
    vi.clearAllMocks()
  })

  afterEach(() => {
    // 테스트 격리: 환경변수 복원
    process.env.ENCRYPTION_KEY = CORRECT_KEY_ENV
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

// ── logRequestAsync — ClickHouse write path + API key masking ───────────────
//
// Original Gotcha #3 covered "logger must use supabaseAdmin so RLS doesn't
// block the insert". After the ClickHouse migration the requests table no
// longer lives in Supabase, so the test asserts the new contract:
//   1. logger writes to ClickHouse via getClickhouse().insert(...)
//   2. body columns are mask-scrubbed before insert (no leaked API keys)
//   3. > 64KB bodies are truncated to keep rows bounded
//   4. ClickHouse failures don't throw (fire-and-forget contract)
//
// See docs/plans/clickhouse-migration.md §3.4 for the masking policy.

describe('logRequestAsync — ClickHouse write path', () => {
  beforeEach(() => {
    mockClickhouseInsert.mockClear()
    mockClickhouseInsert.mockResolvedValue({ executed: true })
  })

  function getInsertedRow(): Record<string, unknown> {
    const call = mockClickhouseInsert.mock.calls[0]?.[0] as
      | { table: string; values: Array<Record<string, unknown>> }
      | undefined
    if (!call) throw new Error('ClickHouse insert was not called')
    expect(call.table).toBe('requests')
    return call.values[0]!
  }

  it('inserts a row into the ClickHouse requests table', async () => {
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

    expect(mockClickhouseInsert).toHaveBeenCalledOnce()
    const row = getInsertedRow()
    expect(row.organization_id).toBe('org-1')
    expect(row.provider).toBe('openai')
    expect(row.model).toBe('gpt-4o')
    expect(row.total_tokens).toBe(30)
    expect(typeof row.id).toBe('string')        // generated client-side
    expect(typeof row.created_at).toBe('string') // ISO8601
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

    // request_body is a JSON string in ClickHouse (String column, not JSONB).
    // After truncation it contains the envelope keys produced by maybeTruncateBody.
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

  it('does not throw when ClickHouse insert fails', async () => {
    // Fire-and-forget contract: a logging failure must never bubble up to the
    // proxy critical path. CLAUDE.md gotcha #8.
    mockClickhouseInsert.mockRejectedValueOnce(new Error('CH connection refused'))

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
