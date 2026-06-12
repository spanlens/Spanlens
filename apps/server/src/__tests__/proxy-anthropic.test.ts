import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Context, MiddlewareHandler, Next } from 'hono'
import { anthropicMessagesResponse, drainPendingTasks, mockUpstream, proxyState, resetProxyMocks } from './helpers/proxy-mocks.js'
import { installOnError } from './helpers/install-on-error.js'

/**
 * End-to-end integration tests for the Anthropic proxy. The shape mirrors
 * proxy-openai.test.ts but pins the Anthropic-specific contract:
 *   1. Auth uses `x-api-key` (NOT Authorization Bearer). Any incoming
 *      Authorization MUST be deleted (defense in depth for SDK quirks).
 *   2. `anthropic-version` header defaults to '2023-06-01' if caller omits it
 *      and passes through verbatim if supplied.
 *   3. Response usage shape differs from OpenAI: input_tokens/output_tokens
 *      live in `usage` — the proxy maps them to prompt/completion tokens
 *      before logging.
 */

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
        metadata: {},
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

async function buildApp() {
  const { Hono } = await import('hono')
  const { anthropicProxy } = await import('../proxy/anthropic.js')
  const app = new Hono()
  app.route('/proxy/anthropic', anthropicProxy)
  installOnError(app)
  return app
}

beforeEach(() => {
  resetProxyMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('anthropic proxy — auth header shape', () => {
  test('upstream receives x-api-key (NOT Authorization Bearer) with decrypted key', async () => {
    proxyState.decryptedKey = 'sk-ant-real-anthropic-xyz'
    mockUpstream(anthropicMessagesResponse())
    const app = await buildApp()

    await app.request('/proxy/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer sl_live_customer_key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 100, messages: [] }),
    })
    await drainPendingTasks()

    const sent = proxyState.fetchCalls[0]!
    expect(sent.headers.get('x-api-key')).toBe('sk-ant-real-anthropic-xyz')
    // Authorization explicitly deleted by the handler even though
    // buildUpstreamHeaders already strips it — defense in depth.
    expect(sent.headers.get('authorization')).toBeNull()
  })

  test('anthropic-version defaults to 2023-06-01 when caller omits it', async () => {
    mockUpstream(anthropicMessagesResponse())
    const app = await buildApp()

    await app.request('/proxy/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 100, messages: [] }),
    })
    await drainPendingTasks()

    expect(proxyState.fetchCalls[0]!.headers.get('anthropic-version')).toBe('2023-06-01')
  })

  test('anthropic-version passes through verbatim when caller supplies it', async () => {
    mockUpstream(anthropicMessagesResponse())
    const app = await buildApp()

    await app.request('/proxy/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2024-10-22',
      },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 100, messages: [] }),
    })
    await drainPendingTasks()

    expect(proxyState.fetchCalls[0]!.headers.get('anthropic-version')).toBe('2024-10-22')
  })

  test('x-spanlens-* headers stripped before reaching upstream', async () => {
    mockUpstream(anthropicMessagesResponse())
    const app = await buildApp()

    await app.request('/proxy/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-spanlens-user': 'usr_internal',
        'x-spanlens-session': 'sess_internal',
      },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 100, messages: [] }),
    })
    await drainPendingTasks()

    proxyState.fetchCalls[0]!.headers.forEach((_v, k) => {
      expect(k.toLowerCase().startsWith('x-spanlens-')).toBe(false)
    })
  })

  test('upstream URL strips the /proxy/anthropic prefix correctly', async () => {
    mockUpstream(anthropicMessagesResponse())
    const app = await buildApp()

    await app.request('/proxy/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 100, messages: [] }),
    })
    await drainPendingTasks()

    expect(proxyState.fetchCalls[0]!.url).toBe('https://api.anthropic.com/v1/messages')
  })
})

describe('anthropic proxy — provider key + scope guards', () => {
  test('NO_PROVIDER_KEY 400 with provider:"anthropic" detail when no key registered', async () => {
    proxyState.decryptedKey = ''
    const app = await buildApp()

    const res = await app.request('/proxy/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 100, messages: [] }),
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string; details: { provider: string } } }
    expect(body.error.code).toBe('NO_PROVIDER_KEY')
    expect(body.error.details.provider).toBe('anthropic')
    expect(proxyState.fetchCalls).toHaveLength(0)
  })

  test('public-scope key returns 403 PUBLIC_KEY_WRITE_FORBIDDEN', async () => {
    proxyState.scope = 'public'
    const app = await buildApp()

    const res = await app.request('/proxy/anthropic/v1/messages', {
      method: 'POST',
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 100, messages: [] }),
    })

    expect(res.status).toBe(403)
    expect(proxyState.fetchCalls).toHaveLength(0)
  })
})

describe('anthropic proxy — logging + token mapping', () => {
  test('input_tokens / output_tokens are mapped to promptTokens / completionTokens in the log row', async () => {
    mockUpstream(anthropicMessagesResponse({
      model: 'claude-sonnet-4-6',
      inputTokens: 1_000_000,
      outputTokens: 500_000,
    }))
    const app = await buildApp()

    const res = await app.request('/proxy/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 100, messages: [] }),
    })
    await drainPendingTasks()

    expect(res.status).toBe(200)
    expect(proxyState.loggerCalls).toHaveLength(1)
    const row = proxyState.loggerCalls[0]!
    expect(row['provider']).toBe('anthropic')
    expect(row['model']).toBe('claude-sonnet-4-6')
    expect(row['promptTokens']).toBe(1_000_000)
    expect(row['completionTokens']).toBe(500_000)
    expect(row['totalTokens']).toBe(1_500_000)
    expect(row['providerKeyId']).toBe(proxyState.providerKeyId)
    // claude-sonnet-4-6: $3/M prompt + $15/M completion → 3 + 7.5 = 10.5
    expect(row['costUsd']).toBeCloseTo(10.5, 4)
  })

  test('upstream 401 status passes through and is recorded with errorMessage', async () => {
    mockUpstream(new Response(
      JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'Invalid API key' } }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    ))
    const app = await buildApp()

    const res = await app.request('/proxy/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 100, messages: [] }),
    })
    await drainPendingTasks()

    expect(res.status).toBe(401)
    const row = proxyState.loggerCalls[0]!
    expect(row['statusCode']).toBe(401)
    expect(row['errorMessage']).toContain('Invalid API key')
  })

  test('response body is forwarded to caller verbatim', async () => {
    const upstreamBody = JSON.stringify({
      id: 'msg_passthrough',
      type: 'message',
      model: 'claude-sonnet-4-6',
      content: [{ type: 'text', text: 'verbatim' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    mockUpstream(new Response(upstreamBody, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const app = await buildApp()

    const res = await app.request('/proxy/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 100, messages: [] }),
    })
    await drainPendingTasks()

    expect(await res.text()).toBe(upstreamBody)
  })
})
