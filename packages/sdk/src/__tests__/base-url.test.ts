/**
 * SPANLENS_BASE_URL: the self-hosted server origin written by
 * `spanlens init --server-url` (and the MCP server's config).
 *
 * Contract, for every proxy factory and for ingest / evals:
 *   explicit option  >  SPANLENS_BASE_URL (+ the hosted route's path)  >  hosted default
 *
 * Before this, every factory ignored the variable, so a self-host user's
 * sl_live key and prompts went to api.spanlens.io.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOpenAI, DEFAULT_SPANLENS_OPENAI_PROXY } from '../integrations/openai.js'
import { createAnthropic, DEFAULT_SPANLENS_ANTHROPIC_PROXY } from '../integrations/anthropic.js'
import { createGemini } from '../integrations/gemini.js'
import { createGroq } from '../integrations/groq.js'
import { createDeepSeek } from '../integrations/deepseek.js'
import { createXai } from '../integrations/xai.js'
import { createCohere } from '../integrations/cohere.js'
import { createMistral } from '../integrations/mistral.js'
import { createOpenRouter } from '../integrations/openrouter.js'
import { createOllama, DEFAULT_OLLAMA_BASE_URL } from '../integrations/ollama.js'
import { SpanlensClient } from '../client.js'
import { resolveApiBaseUrl, resolveProxyBaseUrl } from '../env.js'

const SELF_HOST = 'https://spanlens.example.com'

let saved: string | undefined

beforeEach(() => {
  saved = process.env['SPANLENS_BASE_URL']
  delete process.env['SPANLENS_BASE_URL']
})

afterEach(() => {
  if (saved === undefined) delete process.env['SPANLENS_BASE_URL']
  else process.env['SPANLENS_BASE_URL'] = saved
  vi.unstubAllGlobals()
})

describe('proxy factories honour SPANLENS_BASE_URL', () => {
  it('routes every OpenAI-compatible factory to the self-hosted origin + hosted path', () => {
    process.env['SPANLENS_BASE_URL'] = `${SELF_HOST}/`

    expect(createOpenAI({ apiKey: 'k' }).baseURL).toBe(`${SELF_HOST}/proxy/openai/v1`)
    expect(createGroq({ apiKey: 'k' }).baseURL).toBe(`${SELF_HOST}/proxy/groq/v1`)
    expect(createDeepSeek({ apiKey: 'k' }).baseURL).toBe(`${SELF_HOST}/proxy/deepseek/v1`)
    expect(createXai({ apiKey: 'k' }).baseURL).toBe(`${SELF_HOST}/proxy/xai/v1`)
    expect(createCohere({ apiKey: 'k' }).baseURL).toBe(`${SELF_HOST}/proxy/cohere/v1`)
    expect(createMistral({ apiKey: 'k' }).baseURL).toBe(`${SELF_HOST}/proxy/mistral/v1`)
    expect(createOpenRouter({ apiKey: 'k' }).baseURL).toBe(`${SELF_HOST}/proxy/openrouter/v1`)
  })

  it('routes Anthropic to the self-hosted origin', () => {
    process.env['SPANLENS_BASE_URL'] = SELF_HOST
    expect(createAnthropic({ apiKey: 'k' }).baseURL).toBe(`${SELF_HOST}/proxy/anthropic`)
  })

  it('routes Gemini model requests to the self-hosted origin', async () => {
    process.env['SPANLENS_BASE_URL'] = SELF_HOST
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        urls.push(String(url))
        return Promise.resolve(
          new Response(
            JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] } }] }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        )
      }),
    )

    const model = createGemini({ apiKey: 'sl_live_x' }).getGenerativeModel({ model: 'gemini-2.5-flash' })
    await model.generateContent('hi')

    expect(urls[0]?.startsWith(`${SELF_HOST}/proxy/gemini/`)).toBe(true)
  })

  it('lets an explicit baseURL win over the environment', () => {
    process.env['SPANLENS_BASE_URL'] = SELF_HOST
    expect(createOpenAI({ apiKey: 'k', baseURL: 'http://other/v1' }).baseURL).toBe('http://other/v1')
  })

  it('falls back to the hosted proxy when the variable is unset or blank', () => {
    expect(createOpenAI({ apiKey: 'k' }).baseURL).toBe(DEFAULT_SPANLENS_OPENAI_PROXY)
    process.env['SPANLENS_BASE_URL'] = '   '
    expect(createAnthropic({ apiKey: 'k' }).baseURL).toBe(DEFAULT_SPANLENS_ANTHROPIC_PROXY)
  })

  it('never redirects the local Ollama client', () => {
    process.env['SPANLENS_BASE_URL'] = SELF_HOST
    expect(createOllama().baseURL).toBe(DEFAULT_OLLAMA_BASE_URL)
  })
})

describe('ingest and evals honour SPANLENS_BASE_URL', () => {
  it('sends ingest calls to the self-hosted origin when no baseUrl is configured', async () => {
    process.env['SPANLENS_BASE_URL'] = `${SELF_HOST}//`
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        urls.push(String(url))
        return Promise.resolve(new Response('{}', { status: 200 }))
      }),
    )

    const client = new SpanlensClient({ apiKey: 'sl_live_x' })
    client.startTrace({ name: 't' })
    await client.flush()

    expect(urls).toEqual([`${SELF_HOST}/ingest/traces`])
  })

  it('sends evals calls to the self-hosted origin', async () => {
    process.env['SPANLENS_BASE_URL'] = SELF_HOST
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        urls.push(String(url))
        return Promise.resolve(
          new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }),
        )
      }),
    )

    await new SpanlensClient({ apiKey: 'sl_live_x' }).evals.listRuns()
    expect(urls[0]).toBe(`${SELF_HOST}/api/v1/eval-runs`)
  })

  it('keeps an explicit client baseUrl ahead of the environment', () => {
    process.env['SPANLENS_BASE_URL'] = SELF_HOST
    expect(resolveApiBaseUrl('http://explicit/')).toBe('http://explicit')
  })
})

describe('runtimes without process (browser bundles, some edge workers)', () => {
  it('resolves to the hosted defaults instead of throwing', () => {
    const realProcess = globalThis.process
    let api = ''
    let proxy = ''
    try {
      ;(globalThis as { process?: unknown }).process = undefined
      api = resolveApiBaseUrl()
      proxy = resolveProxyBaseUrl(DEFAULT_SPANLENS_OPENAI_PROXY)
    } finally {
      globalThis.process = realProcess
    }
    expect(api).toBe('https://api.spanlens.io')
    expect(proxy).toBe(DEFAULT_SPANLENS_OPENAI_PROXY)
  })
})
