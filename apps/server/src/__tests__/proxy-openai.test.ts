import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Context, MiddlewareHandler, Next } from 'hono'
import { drainPendingTasks, mockUpstream, openAIChatResponse, proxyState, resetProxyMocks } from './helpers/proxy-mocks.js'
import { installOnError } from './helpers/install-on-error.js'

/**
 * End-to-end integration tests for the OpenAI proxy handler. The four proxy
 * files (openai/anthropic/gemini/azure) share the same shape; this file pins
 * the openai-specific contract:
 *   1. Customer's incoming Spanlens key (Authorization header) is REPLACED
 *      with the decrypted provider key before reaching upstream.
 *   2. `x-spanlens-*` internal metadata never leaks upstream (CLAUDE.md rule).
 *   3. Response token usage is parsed and forwarded to logRequestAsync along
 *      with calculated cost — i.e. the dashboard receives the row it needs.
 *   4. Provider key absent → 500 NO_PROVIDER_KEY (not 200, not silent).
 *   5. Upstream non-2xx is passed through, error truncated for the log row.
 *
 * Mocking strategy: middleware are no-op'd / replaced (auth, scope, quota,
 * rate-limit) so the test exercises ONLY the handler body. supabase/clickhouse
 * are mocked via getDecryptedProviderKey + logRequestAsync. Global fetch is
 * spied. fireAndForget queues into proxyState.pendingTasks so the test can
 * await background log writes before asserting.
 */

// === Mocks — must be hoisted (vi.mock is) ==================================

vi.mock('../middleware/authApiKey.js', async () => {
  const actual = await vi.importActual<typeof import('../middleware/authApiKey.js')>(
    '../middleware/authApiKey.js',
  )
  return {
    ...actual,
    authApiKey: (async (c: Context, next: Next) => {
      c.set('apiKeyId', proxyState.apiKeyId)
      c.set('organizationId', proxyState.organizationId)
      c.set('projectId', proxyState.projectId)
      c.set('apiKeyScope', proxyState.scope)
      await next()
    }) as MiddlewareHandler,
  }
})

vi.mock('../middleware/requireFullScope.js', () => ({
  requireFullScope: (async (_c: Context, next: Next) => {
    if (proxyState.scope === 'public') {
      const { ApiError } = await import('../lib/errors.js')
      throw new ApiError('PUBLIC_KEY_WRITE_FORBIDDEN', 'Public API key cannot write')
    }
    await next()
  }) as MiddlewareHandler,
}))

vi.mock('../middleware/rateLimit.js', () => ({
  proxyRateLimit: (async (_c: Context, next: Next) => { await next() }) as MiddlewareHandler,
}))

vi.mock('../middleware/quota.js', () => ({
  enforceQuota: (async (_c: Context, next: Next) => { await next() }) as MiddlewareHandler,
}))

vi.mock('../proxy/utils.js', async () => {
  const actual = await vi.importActual<typeof import('../proxy/utils.js')>(
    '../proxy/utils.js',
  )
  return {
    ...actual,
    getDecryptedProviderKey: vi.fn(async () => {
      if (proxyState.decryptedKey === '') return null
      return {
        plaintext: proxyState.decryptedKey,
        id: proxyState.providerKeyId,
        metadata: proxyState.resourceUrl ? { resource_url: proxyState.resourceUrl } : {},
      }
    }),
    isBlockingEnabled: vi.fn(async () => proxyState.blockingEnabled),
  }
})

vi.mock('../lib/logger.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/logger.js')>(
    '../lib/logger.js',
  )
  return {
    ...actual,
    logRequestAsync: vi.fn(async (data: Record<string, unknown>) => {
      proxyState.loggerCalls.push(data)
    }),
  }
})

vi.mock('../lib/resolve-prompt-version.js', () => ({
  resolvePromptVersion: vi.fn(async () => null),
}))

vi.mock('../lib/wait-until.js', () => ({
  fireAndForget: (_c: Context, promise: Promise<unknown>) => {
    proxyState.pendingTasks.push(promise.catch(() => undefined))
  },
}))

// === App harness ===========================================================

async function buildApp() {
  const { Hono } = await import('hono')
  const { openaiProxy } = await import('../proxy/openai.js')
  const app = new Hono()
  app.route('/proxy/openai', openaiProxy)
  installOnError(app)
  return app
}

// === Tests =================================================================

beforeEach(() => {
  resetProxyMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('openai proxy — auth header rewrite (security critical)', () => {
  test('upstream Authorization carries DECRYPTED provider key, not the customer Spanlens key', async () => {
    proxyState.decryptedKey = 'sk-real-openai-abc123'
    mockUpstream(openAIChatResponse())
    const app = await buildApp()

    const res = await app.request('/proxy/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer sl_live_customerkey_THIS_MUST_NOT_LEAK',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] }),
    })
    await drainPendingTasks()

    expect(res.status).toBe(200)
    expect(proxyState.fetchCalls).toHaveLength(1)
    const sent = proxyState.fetchCalls[0]!
    expect(sent.headers.get('authorization')).toBe('Bearer sk-real-openai-abc123')
    // Defense in depth: the customer key MUST NOT appear anywhere in upstream headers
    sent.headers.forEach((value) => {
      expect(value).not.toContain('sl_live_')
    })
  })

  test('every x-spanlens-* header is stripped before reaching upstream (CLAUDE.md rule)', async () => {
    mockUpstream(openAIChatResponse())
    const app = await buildApp()

    await app.request('/proxy/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer sl_live_irrelevant',
        'Content-Type': 'application/json',
        'x-spanlens-user': 'usr_customer_internal',
        'x-spanlens-session': 'sess_customer',
        'x-spanlens-prompt-version': 'greeter@1',
        'x-spanlens-log-body': 'meta',
      },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [] }),
    })
    await drainPendingTasks()

    const sent = proxyState.fetchCalls[0]!
    const leaked: string[] = []
    sent.headers.forEach((_v, k) => {
      if (k.toLowerCase().startsWith('x-spanlens-')) leaked.push(k)
    })
    expect(leaked).toEqual([])
  })

  test('upstream URL strips the /proxy/openai prefix correctly', async () => {
    mockUpstream(openAIChatResponse())
    const app = await buildApp()

    await app.request('/proxy/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [] }),
    })
    await drainPendingTasks()

    expect(proxyState.fetchCalls[0]!.url).toBe('https://api.openai.com/v1/chat/completions')
  })
})

describe('openai proxy — provider key resolution', () => {
  test('NO_PROVIDER_KEY 400 when no active OpenAI key exists for this Spanlens key', async () => {
    proxyState.decryptedKey = '' // signal: getDecryptedProviderKey returns null
    const app = await buildApp()

    const res = await app.request('/proxy/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [] }),
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string; details: { provider: string } } }
    expect(body.error.code).toBe('NO_PROVIDER_KEY')
    expect(body.error.details.provider).toBe('openai')
    // Upstream MUST NOT be called when no provider key is available
    expect(proxyState.fetchCalls).toHaveLength(0)
  })

  test('public-scope Spanlens key is rejected with 403 PUBLIC_KEY_WRITE_FORBIDDEN', async () => {
    proxyState.scope = 'public'
    const app = await buildApp()

    const res = await app.request('/proxy/openai/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [] }),
    })

    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('PUBLIC_KEY_WRITE_FORBIDDEN')
    expect(proxyState.fetchCalls).toHaveLength(0)
  })
})

describe('openai proxy — logging + cost calculation', () => {
  test('parsed tokens, model, and cost are forwarded to logRequestAsync', async () => {
    mockUpstream(openAIChatResponse({
      model: 'gpt-4o-mini-2024-07-18', // dated variant — exercises gotcha #2 prefix fallback
      promptTokens: 1_000_000,
      completionTokens: 500_000,
    }))
    const app = await buildApp()

    const res = await app.request('/proxy/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] }),
    })
    await drainPendingTasks()

    expect(res.status).toBe(200)
    expect(proxyState.loggerCalls).toHaveLength(1)
    const row = proxyState.loggerCalls[0]!
    expect(row['organizationId']).toBe(proxyState.organizationId)
    expect(row['projectId']).toBe(proxyState.projectId)
    expect(row['provider']).toBe('openai')
    expect(row['model']).toBe('gpt-4o-mini-2024-07-18')
    expect(row['promptTokens']).toBe(1_000_000)
    expect(row['completionTokens']).toBe(500_000)
    expect(row['totalTokens']).toBe(1_500_000)
    expect(row['providerKeyId']).toBe(proxyState.providerKeyId)
    // gpt-4o-mini priced at $0.15/M prompt + $0.60/M completion = 0.15 + 0.30 = 0.45
    expect(row['costUsd']).toBeCloseTo(0.45, 4)
    expect(row['statusCode']).toBe(200)
    expect(row['errorMessage']).toBeNull()
  })

  test('upstream 401 is passed through to caller and recorded in log with errorMessage', async () => {
    mockUpstream(
      new Response(JSON.stringify({ error: { message: 'Incorrect API key provided' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const app = await buildApp()

    const res = await app.request('/proxy/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [] }),
    })
    await drainPendingTasks()

    // Status must pass through transparently — the proxy is not a CORS wall
    expect(res.status).toBe(401)
    expect(proxyState.loggerCalls).toHaveLength(1)
    const row = proxyState.loggerCalls[0]!
    expect(row['statusCode']).toBe(401)
    expect(typeof row['errorMessage']).toBe('string')
    expect((row['errorMessage'] as string).length).toBeLessThanOrEqual(1000)
    expect(row['errorMessage']).toContain('Incorrect API key')
  })

  test('logBodyMode parsed from x-spanlens-log-body header (defaults to "full" for unknown)', async () => {
    mockUpstream(openAIChatResponse())
    const app = await buildApp()

    await app.request('/proxy/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-spanlens-log-body': 'meta',
      },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [] }),
    })
    await drainPendingTasks()

    expect(proxyState.loggerCalls[0]!['logBodyMode']).toBe('meta')
  })

  test('trace/span/user/session identifiers from request headers flow into the log row', async () => {
    mockUpstream(openAIChatResponse())
    const app = await buildApp()

    // The SDK generates trace/span ids with crypto.randomUUID(); requests.trace_id
    // and span_id are ClickHouse Nullable(UUID), so valid UUIDs flow through.
    const traceId = '11111111-1111-4111-8111-111111111111'
    const spanId = '22222222-2222-4222-8222-222222222222'
    await app.request('/proxy/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-trace-id': traceId,
        'x-span-id': spanId,
        'x-spanlens-user': 'usr_end_customer',
        'x-spanlens-session': 'sess_abc',
      },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [] }),
    })
    await drainPendingTasks()

    const row = proxyState.loggerCalls[0]!
    expect(row['traceId']).toBe(traceId)
    expect(row['spanId']).toBe(spanId)
    expect(row['userId']).toBe('usr_end_customer')
    expect(row['sessionId']).toBe('sess_abc')
  })

  test('non-UUID trace/span ids are nulled so the Nullable(UUID) insert never drops the row', async () => {
    mockUpstream(openAIChatResponse())
    const app = await buildApp()

    await app.request('/proxy/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-trace-id': 'trace_test_123',
        'x-span-id': 'span_test_456',
        'x-spanlens-user': 'usr_end_customer',
      },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [] }),
    })
    await drainPendingTasks()

    const row = proxyState.loggerCalls[0]!
    // Invalid UUIDs must coerce to null — otherwise they poison the ClickHouse
    // Nullable(UUID) column and the whole row is silently dropped at flush time.
    expect(row['traceId']).toBeNull()
    expect(row['spanId']).toBeNull()
    // Customer identifiers are Strings, so non-UUID values still flow.
    expect(row['userId']).toBe('usr_end_customer')
  })
})

describe('openai proxy — embeddings (RAG cost tracking)', () => {
  test('embeddings response is tracked end-to-end (tokens parsed, cost calculated)', async () => {
    // Embeddings have a different response shape than chat completions —
    // `data: [{embedding}]` instead of `choices`, and `usage.completion_tokens`
    // is absent because the model returns vectors, not generated text. The
    // proxy + parser + cost calculator must all handle this without changes
    // beyond the model_prices seed (added in the same PR). This test pins
    // that contract — if a future refactor special-cases `choices`, embedding
    // cost tracking regresses to NULL and RAG customers lose ~30-50% of
    // their LLM spend from the dashboard.
    const embeddingsResponse = new Response(
      JSON.stringify({
        object: 'list',
        model: 'text-embedding-3-small',
        data: [
          { object: 'embedding', index: 0, embedding: [0.01, 0.02, 0.03] },
          { object: 'embedding', index: 1, embedding: [0.04, 0.05, 0.06] },
        ],
        usage: { prompt_tokens: 1_000_000, total_tokens: 1_000_000 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
    mockUpstream(embeddingsResponse)
    const app = await buildApp()

    const res = await app.request('/proxy/openai/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: ['hello', 'world'],
      }),
    })
    await drainPendingTasks()

    expect(res.status).toBe(200)
    expect(proxyState.fetchCalls[0]!.url).toBe('https://api.openai.com/v1/embeddings')

    expect(proxyState.loggerCalls).toHaveLength(1)
    const row = proxyState.loggerCalls[0]!
    expect(row['model']).toBe('text-embedding-3-small')
    expect(row['promptTokens']).toBe(1_000_000)
    expect(row['completionTokens']).toBe(0) // embeddings have no completion side
    expect(row['totalTokens']).toBe(1_000_000)
    // text-embedding-3-small priced at $0.02 / 1M (input-only).
    expect(row['costUsd']).toBeCloseTo(0.02, 4)
  })
})

describe('openai proxy — response passthrough', () => {
  test('response body bytes are returned verbatim to caller', async () => {
    const upstreamBody = JSON.stringify({
      id: 'chatcmpl-passthrough-test',
      object: 'chat.completion',
      model: 'gpt-4o',
      choices: [{ message: { role: 'assistant', content: 'verbatim' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })
    mockUpstream(new Response(upstreamBody, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const app = await buildApp()

    const res = await app.request('/proxy/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', messages: [] }),
    })
    await drainPendingTasks()

    expect(await res.text()).toBe(upstreamBody)
  })
})
