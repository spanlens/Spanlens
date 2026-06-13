import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Context, MiddlewareHandler, Next } from 'hono'
import { drainPendingTasks, mockUpstream, openAIChatResponse, proxyState, resetProxyMocks } from './helpers/proxy-mocks.js'
import { installOnError } from './helpers/install-on-error.js'

/**
 * Integration tests for the OpenRouter proxy.
 *
 * OpenRouter is a meta-provider: one API key, 100+ models from 30+
 * providers. The wire protocol is OpenAI-compatible, so the proxy reuses
 * the OpenAI parser and stream logger. The two genuinely
 * OpenRouter-specific contracts this file pins:
 *
 *   1. Cost preference order: when the response carries `usage.cost` (USD,
 *      OpenRouter's own billed figure), that wins over our local price
 *      lookup. Our calculator only runs when usage.cost is missing.
 *
 *   2. Model id vendor-prefix stripping for the lookup fallback:
 *      `openai/gpt-4o` → `gpt-4o` matches our `model_prices` row;
 *      otherwise the proxy would log a non-NULL token count but a NULL cost
 *      for every OpenRouter call (RAG-cost-tracking regression of #325 shape).
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
  const { openrouterProxy } = await import('../proxy/openrouter.js')
  const app = new Hono()
  app.route('/proxy/openrouter', openrouterProxy)
  installOnError(app)
  return app
}

/**
 * Build an OpenRouter-shaped chat completion response. Extends the OpenAI
 * shape with an optional `usage.cost` field — present when the caller
 * passes `cost`. OpenRouter sometimes returns the model with the vendor
 * prefix attached (which we then strip for the cost lookup).
 */
function openrouterChatResponse(opts: {
  model: string
  promptTokens?: number
  completionTokens?: number
  /** When set, attached as `usage.cost` (USD) — authoritative for billing. */
  cost?: number
}): Response {
  const pt = opts.promptTokens ?? 100
  const ct = opts.completionTokens ?? 200
  const usage: Record<string, unknown> = {
    prompt_tokens: pt,
    completion_tokens: ct,
    total_tokens: pt + ct,
  }
  if (opts.cost !== undefined) usage['cost'] = opts.cost
  return new Response(
    JSON.stringify({
      id: 'gen-test',
      object: 'chat.completion',
      model: opts.model,
      choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
      usage,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

beforeEach(() => {
  resetProxyMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('openrouter proxy — auth + URL building', () => {
  test('upstream URL = openrouter.ai/api + path with /proxy/openrouter stripped', async () => {
    mockUpstream(openAIChatResponse({ model: 'openai/gpt-4o' }))
    const app = await buildApp()

    await app.request('/proxy/openrouter/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'openai/gpt-4o', messages: [] }),
    })
    await drainPendingTasks()

    expect(proxyState.fetchCalls[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions')
  })

  test('upstream Authorization carries decrypted OpenRouter key (not customer sl_live_*)', async () => {
    proxyState.decryptedKey = 'sk-or-v1-real-key'
    mockUpstream(openAIChatResponse({ model: 'openai/gpt-4o' }))
    const app = await buildApp()

    await app.request('/proxy/openrouter/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer sl_live_customer_should_not_leak',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'openai/gpt-4o', messages: [] }),
    })
    await drainPendingTasks()

    const sent = proxyState.fetchCalls[0]!
    expect(sent.headers.get('authorization')).toBe('Bearer sk-or-v1-real-key')
    sent.headers.forEach((v) => expect(v).not.toContain('sl_live_'))
  })
})

describe('openrouter proxy — guards', () => {
  test('NO_PROVIDER_KEY 400 with provider:"openrouter" detail', async () => {
    proxyState.decryptedKey = ''
    const app = await buildApp()

    const res = await app.request('/proxy/openrouter/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'openai/gpt-4o', messages: [] }),
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string; details: { provider: string } } }
    expect(body.error.code).toBe('NO_PROVIDER_KEY')
    expect(body.error.details.provider).toBe('openrouter')
  })

  test('public-scope key returns 403 PUBLIC_KEY_WRITE_FORBIDDEN', async () => {
    proxyState.scope = 'public'
    const app = await buildApp()

    const res = await app.request('/proxy/openrouter/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'openai/gpt-4o', messages: [] }),
    })

    expect(res.status).toBe(403)
    expect(proxyState.fetchCalls).toHaveLength(0)
  })
})

describe('openrouter proxy — cost preference (authoritative cost wins)', () => {
  test('usage.cost from upstream is used verbatim, our local lookup is ignored', async () => {
    // 1.5M prompt × $2.50 + 0.5M completion × $10 would be $8.75 by our
    // local gpt-4o seed. OpenRouter reports $7.123 with their margin /
    // discount — we trust their number and skip ours.
    mockUpstream(openrouterChatResponse({
      model: 'openai/gpt-4o',
      promptTokens: 1_500_000,
      completionTokens: 500_000,
      cost: 7.123,
    }))
    const app = await buildApp()

    await app.request('/proxy/openrouter/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'openai/gpt-4o', messages: [] }),
    })
    await drainPendingTasks()

    expect(proxyState.loggerCalls).toHaveLength(1)
    const row = proxyState.loggerCalls[0]!
    expect(row['provider']).toBe('openrouter')
    expect(row['model']).toBe('openai/gpt-4o') // vendor prefix preserved on the row
    expect(row['costUsd']).toBe(7.123)
  })

  test('fallback to local lookup with vendor prefix stripped (openai/gpt-4o → gpt-4o)', async () => {
    // No usage.cost field present — proxy strips the vendor prefix and
    // looks the model up in our normal model_prices table. gpt-4o priced
    // at $2.50 / 1M prompt + $10 / 1M completion. With 1M prompt + 0.5M
    // completion: 2.50 + 5.00 = 7.50.
    mockUpstream(openrouterChatResponse({
      model: 'openai/gpt-4o',
      promptTokens: 1_000_000,
      completionTokens: 500_000,
    }))
    const app = await buildApp()

    await app.request('/proxy/openrouter/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'openai/gpt-4o', messages: [] }),
    })
    await drainPendingTasks()

    const row = proxyState.loggerCalls[0]!
    expect(row['model']).toBe('openai/gpt-4o')
    expect(row['costUsd']).toBeCloseTo(7.5, 4)
  })

  test('unknown model and no usage.cost → cost_usd lands NULL (no fake number)', async () => {
    mockUpstream(openrouterChatResponse({
      model: 'someprovider/model-we-dont-know',
      promptTokens: 100,
      completionTokens: 50,
    }))
    const app = await buildApp()

    await app.request('/proxy/openrouter/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'someprovider/model-we-dont-know', messages: [] }),
    })
    await drainPendingTasks()

    const row = proxyState.loggerCalls[0]!
    expect(row['costUsd']).toBeNull()
    expect(row['model']).toBe('someprovider/model-we-dont-know') // still logged
    expect(row['promptTokens']).toBe(100)
  })
})

describe('openrouter proxy — error passthrough', () => {
  test('upstream non-2xx is forwarded and recorded with errorMessage', async () => {
    mockUpstream(new Response(
      JSON.stringify({ error: { message: 'No allowance left for this model' } }),
      { status: 402, headers: { 'content-type': 'application/json' } },
    ))
    const app = await buildApp()

    const res = await app.request('/proxy/openrouter/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'openai/gpt-4o', messages: [] }),
    })
    await drainPendingTasks()

    expect(res.status).toBe(402)
    expect(proxyState.loggerCalls[0]!['statusCode']).toBe(402)
    expect((proxyState.loggerCalls[0]!['errorMessage'] as string)).toContain('No allowance left')
  })
})
