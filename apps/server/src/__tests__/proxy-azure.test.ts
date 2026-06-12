import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Context, MiddlewareHandler, Next } from 'hono'
import { drainPendingTasks, mockUpstream, openAIChatResponse, proxyState, resetProxyMocks } from './helpers/proxy-mocks.js'
import { installOnError } from './helpers/install-on-error.js'

/**
 * End-to-end integration tests for the Azure OpenAI proxy. Azure is the only
 * provider where the upstream BASE URL is per-key (the customer's Azure
 * resource) rather than a fixed constant. The handler-specific contract:
 *   1. Upstream URL is built from provider_metadata.resource_url + /openai/v1.
 *   2. resource_url MUST be present — missing → 500 INTERNAL_ERROR with a
 *      clear "re-register it" message (Azure rows have a DB CHECK forcing it,
 *      this is defense in depth if a future migration drops the constraint).
 *   3. Auth header is `api-key`, NOT Authorization Bearer. Any incoming
 *      Authorization is deleted.
 *   4. Response shape is OpenAI-compatible so the OpenAI parser is reused
 *      and `calculateCost('openai', ...)` is invoked even though the
 *      logged provider is 'azure'.
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

async function buildApp() {
  const { Hono } = await import('hono')
  const { azureProxy } = await import('../proxy/azure.js')
  const app = new Hono()
  app.route('/proxy/azure', azureProxy)
  installOnError(app)
  return app
}

const TEST_RESOURCE_URL = 'https://my-resource.openai.azure.com'

beforeEach(() => {
  resetProxyMocks()
  proxyState.resourceUrl = TEST_RESOURCE_URL
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('azure proxy — resource_url URL building', () => {
  test('upstream URL = {resource_url}/openai/v1{path}', async () => {
    mockUpstream(openAIChatResponse())
    const app = await buildApp()

    await app.request('/proxy/azure/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [] }),
    })
    await drainPendingTasks()

    expect(proxyState.fetchCalls[0]!.url).toBe(
      `${TEST_RESOURCE_URL}/openai/v1/chat/completions`,
    )
  })

  test('different resource_url values produce different upstream origins (per-key routing)', async () => {
    mockUpstream(openAIChatResponse())
    proxyState.resourceUrl = 'https://customer-a.openai.azure.com'
    const app = await buildApp()

    await app.request('/proxy/azure/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [] }),
    })
    await drainPendingTasks()

    expect(proxyState.fetchCalls[0]!.url).toContain('customer-a.openai.azure.com')
  })

  test('missing resource_url → 500 INTERNAL_ERROR with actionable message', async () => {
    proxyState.resourceUrl = '' // metadata returned will be {} so resource_url is falsy
    const app = await buildApp()

    const res = await app.request('/proxy/azure/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [] }),
    })

    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('INTERNAL_ERROR')
    expect(body.error.message.toLowerCase()).toContain('resource_url')
    // Upstream MUST NOT be reached when the URL would be malformed
    expect(proxyState.fetchCalls).toHaveLength(0)
  })
})

describe('azure proxy — auth header (api-key) shape', () => {
  test('upstream receives api-key header (NOT Authorization) with decrypted key', async () => {
    proxyState.decryptedKey = 'azure-api-key-real-xyz'
    mockUpstream(openAIChatResponse())
    const app = await buildApp()

    await app.request('/proxy/azure/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer sl_live_customer_should_not_leak',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [] }),
    })
    await drainPendingTasks()

    const sent = proxyState.fetchCalls[0]!
    expect(sent.headers.get('api-key')).toBe('azure-api-key-real-xyz')
    expect(sent.headers.get('authorization')).toBeNull()
  })

  test('x-spanlens-* headers stripped before reaching upstream', async () => {
    mockUpstream(openAIChatResponse())
    const app = await buildApp()

    await app.request('/proxy/azure/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-spanlens-user': 'usr_internal',
      },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [] }),
    })
    await drainPendingTasks()

    proxyState.fetchCalls[0]!.headers.forEach((_v, k) => {
      expect(k.toLowerCase().startsWith('x-spanlens-')).toBe(false)
    })
  })
})

describe('azure proxy — provider key + scope guards', () => {
  test('NO_PROVIDER_KEY 400 when no active Azure key exists', async () => {
    proxyState.decryptedKey = ''
    const app = await buildApp()

    const res = await app.request('/proxy/azure/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [] }),
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('NO_PROVIDER_KEY')
    expect(proxyState.fetchCalls).toHaveLength(0)
  })

  test('public-scope key returns 403 PUBLIC_KEY_WRITE_FORBIDDEN', async () => {
    proxyState.scope = 'public'
    const app = await buildApp()

    const res = await app.request('/proxy/azure/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [] }),
    })

    expect(res.status).toBe(403)
    expect(proxyState.fetchCalls).toHaveLength(0)
  })
})

describe('azure proxy — logging records provider:"azure" with OpenAI-priced cost', () => {
  test('log row has provider="azure" but cost uses OpenAI price table (azure exposes openai models)', async () => {
    mockUpstream(openAIChatResponse({
      model: 'gpt-4o-mini-2024-07-18',
      promptTokens: 1_000_000,
      completionTokens: 500_000,
    }))
    const app = await buildApp()

    const res = await app.request('/proxy/azure/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [] }),
    })
    await drainPendingTasks()

    expect(res.status).toBe(200)
    expect(proxyState.loggerCalls).toHaveLength(1)
    const row = proxyState.loggerCalls[0]!
    expect(row['provider']).toBe('azure') // tag distinguishes upstream
    expect(row['model']).toBe('gpt-4o-mini-2024-07-18')
    // Same OpenAI prices as in proxy-openai.test.ts: 0.15 + 0.30 = 0.45
    expect(row['costUsd']).toBeCloseTo(0.45, 4)
  })

  test('upstream non-2xx is passed through and recorded with errorMessage', async () => {
    mockUpstream(new Response(
      JSON.stringify({ error: { code: 'DeploymentNotFound', message: 'Deployment xyz not found' } }),
      { status: 404, headers: { 'content-type': 'application/json' } },
    ))
    const app = await buildApp()

    const res = await app.request('/proxy/azure/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [] }),
    })
    await drainPendingTasks()

    expect(res.status).toBe(404)
    expect(proxyState.loggerCalls[0]!['statusCode']).toBe(404)
    expect((proxyState.loggerCalls[0]!['errorMessage'] as string)).toContain('Deployment xyz not found')
  })
})
