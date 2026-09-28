import { beforeEach, describe, expect, test, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// lib/body-retention.ts is the single body-retention policy shared by the
// `requests` row (lib/logger.ts), the proxy's span copy (proxy/stream-logger.ts)
// and SDK span ingest (api/ingest.ts). These tests pin the policy itself and
// the logger's use of a caller-resolved decision.
// ─────────────────────────────────────────────────────────────────────────────

const state = vi.hoisted(() => ({
  sampleRate: 1 as number,
  orgLookups: 0,
  pgExecute: vi.fn(async (_opts: unknown) => undefined),
}))

vi.mock('../lib/db.js', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'organizations') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                state.orgLookups += 1
                return { data: { body_sample_rate: state.sampleRate }, error: null }
              },
            }),
          }),
          // security-alert claim path in logger.ts: "no row" = alert disabled
          update: () => ({
            eq: () => ({ eq: () => ({ or: () => ({ select: () => ({ single: async () => ({ data: null }) }) }) }) }),
          }),
        }
      }
      // org_activity watermark + requests_fallback: accept silently
      return {
        insert: async () => ({ error: null }),
        upsert: async () => ({ error: null }),
      }
    },
  },
}))

vi.mock('../lib/postgres.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/postgres.js')>()
  return {
    ...actual,
    pgExecute: (opts: unknown) => state.pgExecute(opts),
    pgQuery: vi.fn(async () => []),
  }
})

vi.mock('../lib/resend.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({ sent: false }),
  renderSecurityAlertEmail: vi.fn().mockReturnValue({ subject: '', html: '' }),
}))

vi.mock('../lib/webhook-emit.js', () => ({ emitWebhookEvent: vi.fn(async () => undefined) }))

type BodyRetention = typeof import('../lib/body-retention.js')
let resolveBodyRetention: BodyRetention['resolveBodyRetention']
let sanitizeJsonForStorage: BodyRetention['sanitizeJsonForStorage']
let logRequestAsync: typeof import('../lib/logger.js')['logRequestAsync']

beforeEach(async () => {
  vi.resetModules()
  state.sampleRate = 1
  state.orgLookups = 0
  state.pgExecute.mockClear()
  ;({ resolveBodyRetention, sanitizeJsonForStorage } = await import('../lib/body-retention.js'))
  ;({ logRequestAsync } = await import('../lib/logger.js'))
})

describe('resolveBodyRetention', () => {
  test("'meta' and 'none' never keep bodies and skip the sample-rate lookup", async () => {
    expect(await resolveBodyRetention('org-1', 'meta', 0)).toBe(false)
    expect(await resolveBodyRetention('org-1', 'none', 0)).toBe(false)
    expect(state.orgLookups).toBe(0)
  })

  test("'full' (and an absent mode) follow the org sample rate", async () => {
    expect(await resolveBodyRetention('org-1', 'full', 0.99)).toBe(true)
    expect(await resolveBodyRetention('org-2', undefined, 0.99)).toBe(true)

    state.sampleRate = 0
    expect(await resolveBodyRetention('org-3', 'full', 0)).toBe(false)

    state.sampleRate = 0.5
    expect(await resolveBodyRetention('org-4', 'full', 0.49)).toBe(true)
    expect(await resolveBodyRetention('org-4', 'full', 0.51)).toBe(false)
  })
})

describe('sanitizeJsonForStorage', () => {
  const KEY = 'sk-ant-api03-ABCDEFGHIJKLMNOP'

  test('null and undefined store as null', () => {
    expect(sanitizeJsonForStorage(null)).toBeNull()
    expect(sanitizeJsonForStorage(undefined)).toBeNull()
  })

  test('strings stay strings, objects stay objects, keys masked', () => {
    expect(sanitizeJsonForStorage(`x ${KEY}`)).toBe('x sk-ant-***')
    expect(sanitizeJsonForStorage({ a: [KEY, 1, true], b: { c: KEY } })).toEqual({
      a: ['sk-ant-***', 1, true],
      b: { c: 'sk-ant-***' },
    })
  })

  test('small values pass through untouched', () => {
    const value = { messages: [{ role: 'user', content: 'hi "quoted" \\ backslash' }] }
    expect(sanitizeJsonForStorage(value)).toEqual(value)
  })

  test('values above 64 KiB become the truncation envelope', () => {
    const out = sanitizeJsonForStorage({ blob: 'q'.repeat(70_000) }) as Record<string, unknown>
    expect(out['_truncated']).toBe(true)
    expect(String(out['_preview']).length).toBe(2048)
  })

  test('a value that cannot be serialized is replaced, not thrown', () => {
    const circular: Record<string, unknown> = {}
    circular['self'] = circular
    expect(sanitizeJsonForStorage(circular)).toEqual({ _error: 'body not JSON-serializable' })
  })
})

describe('logRequestAsync with a caller-resolved storeBody', () => {
  const base = {
    organizationId: 'org-1',
    projectId: 'proj-1',
    apiKeyId: 'key-1',
    provider: 'openai',
    model: 'gpt-4o',
    promptTokens: 1,
    completionTokens: 1,
    totalTokens: 2,
    costUsd: null,
    latencyMs: 10,
    statusCode: 200,
    requestBody: { messages: [{ role: 'user', content: 'prompt' }] },
    responseBody: { ok: true },
    errorMessage: null,
    traceId: null,
    spanId: null,
  }

  function insertedRow(): Record<string, unknown> {
    const call = state.pgExecute.mock.calls[0]?.[0] as { params: Record<string, unknown> }
    return call.params
  }

  test('storeBody=false drops bodies in full mode without a second draw', async () => {
    await logRequestAsync({ ...base, storeBody: false })

    expect(insertedRow()['request_body']).toBe('')
    expect(insertedRow()['response_body']).toBe('')
    expect(state.orgLookups).toBe(0)
  })

  test('storeBody=true keeps bodies in full mode', async () => {
    await logRequestAsync({ ...base, storeBody: true })

    expect(JSON.parse(insertedRow()['request_body'] as string)).toEqual(base.requestBody)
  })

  test('storeBody=true cannot override a meta opt-out', async () => {
    await logRequestAsync({ ...base, logBodyMode: 'meta', storeBody: true })

    expect(insertedRow()['request_body']).toBe('')
    expect(insertedRow()['response_body']).toBe('')
  })
})
