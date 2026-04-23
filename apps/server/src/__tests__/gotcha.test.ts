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
 *  - Gotcha #3 RLS: logRequestAsync가 supabaseAdmin 사용 (구조적 검증)
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
  }
  return {
    supabaseAdmin: {
      from: vi.fn(() => mockChain),
    },
    supabaseClient: {},
    // mockChain을 외부에서 접근하기 위해 내보냄
    __mockChain: mockChain,
  }
})

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

  it('returns { plaintext, id } when ENCRYPTION_KEY matches', async () => {
    const plaintext = 'sk-openai-real-key-abc123'
    const ciphertext = await aes256Encrypt(plaintext)

    vi.mocked(supabaseAdmin.from).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'pk-uuid-123', encrypted_key: ciphertext },
        error: null,
      }),
    } as never)

    const result = await getDecryptedProviderKey('org-123', 'openai')
    expect(result).toEqual({ plaintext, id: 'pk-uuid-123' })
  })

  it('returns null (not empty plaintext) when ENCRYPTION_KEY is wrong [Known Gotcha #5]', async () => {
    process.env.ENCRYPTION_KEY = CORRECT_KEY_ENV
    const ciphertext = await aes256Encrypt('sk-openai-real-key-abc123')
    process.env.ENCRYPTION_KEY = WRONG_KEY_ENV

    vi.mocked(supabaseAdmin.from).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'pk-uuid-123', encrypted_key: ciphertext },
        error: null,
      }),
    } as never)

    const result = await getDecryptedProviderKey('org-123', 'openai')

    // null guarantees the proxy never sends an empty Bearer token to OpenAI
    expect(result).toBeNull()
  })

  it('returns null when no provider key row exists in DB', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as never)

    const result = await getDecryptedProviderKey('org-123', 'openai')
    expect(result).toBeNull()
  })

  it('returns null when encrypted_key is empty/garbage in DB', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'pk-uuid-123', encrypted_key: 'dG9vc2hvcnQ=' },
        error: null,
      }),
    } as never)

    const result = await getDecryptedProviderKey('org-123', 'openai')
    expect(result).toBeNull()
  })
})

// ── Gotcha #3: RLS — supabaseAdmin 사용 구조적 검증 ──────────────────────────

describe('Gotcha #3 — logRequestAsync uses supabaseAdmin for requests INSERT', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('logRequestAsync calls supabaseAdmin.from("requests") — not the anon client', async () => {
    // RLS 때문에 anon client로 INSERT 시 403 에러 발생.
    // logRequestAsync는 반드시 supabaseAdmin(service_role)을 사용해야 함.
    // 이 테스트는 supabaseAdmin.from이 'requests'로 호출되는지 검증합니다.

    const mockInsert = vi.fn().mockResolvedValue({ error: null })

    vi.mocked(supabaseAdmin.from).mockReturnValueOnce({
      insert: mockInsert,
    } as never)

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

    // supabaseAdmin.from이 'requests' 테이블로 호출되었는지 확인
    expect(vi.mocked(supabaseAdmin.from)).toHaveBeenCalledWith('requests')
    // insert도 실제 데이터와 함께 호출되었는지 확인
    expect(mockInsert).toHaveBeenCalledOnce()
    const insertArg = mockInsert.mock.calls[0]?.[0] as Record<string, unknown>
    expect(insertArg.organization_id).toBe('org-1')
    expect(insertArg.provider).toBe('openai')
  })

  it('truncates request_body > 10KB before INSERT (prevents JSONB bloat)', async () => {
    const mockInsert = vi.fn().mockResolvedValue({ error: null })
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce({ insert: mockInsert } as never)

    const { logRequestAsync } = await import('../lib/logger.js')

    // 20KB 페이로드 — 10KB 임계치 초과
    const bigContent = 'x'.repeat(20 * 1024)
    await logRequestAsync({
      organizationId: 'org-1', projectId: 'p-1', apiKeyId: 'k-1',
      provider: 'openai', model: 'gpt-4o',
      promptTokens: 0, completionTokens: 0, totalTokens: 0,
      costUsd: null, latencyMs: 100, statusCode: 200,
      requestBody: { messages: [{ role: 'user', content: bigContent }] },
      responseBody: null,
      errorMessage: null, traceId: null, spanId: null,
    })

    const arg = mockInsert.mock.calls[0]?.[0] as Record<string, unknown>
    const body = arg.request_body as Record<string, unknown>
    expect(body._truncated).toBe(true)
    expect(body._original_size_bytes).toBeGreaterThan(20 * 1024)
    expect((body._preview as string).length).toBeLessThanOrEqual(2 * 1024)
  })

  it('passes small body through unchanged (< 10KB)', async () => {
    const mockInsert = vi.fn().mockResolvedValue({ error: null })
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce({ insert: mockInsert } as never)

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

    const arg = mockInsert.mock.calls[0]?.[0] as Record<string, unknown>
    expect(arg.request_body).toEqual(smallBody)
  })

  it('logRequestAsync does not throw when DB returns an error', async () => {
    // DB 에러 시 throw하지 않고 console.error만 해야 함 (fire-and-forget 패턴)
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce({
      insert: vi.fn().mockResolvedValue({ error: { message: 'DB connection failed' } }),
    } as never)

    const { logRequestAsync } = await import('../lib/logger.js')

    // DB 에러가 있어도 예외가 전파되면 안 됨
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
})
