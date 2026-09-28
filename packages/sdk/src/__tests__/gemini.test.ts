/**
 * `@spanlens/sdk/gemini` driven through the REAL `@google/generative-ai`
 * client with only `fetch` stubbed, so what is asserted is what would go on
 * the wire.
 *
 * - C17.1: the Gemini SDK reads per-request headers from
 *   `RequestOptions.customHeaders` and silently ignores a `headers` key, so the
 *   OpenAI-style `{ headers }` helpers never reached the proxy.
 * - C17.2: `getGenerativeModelFromCachedContent()` bypassed the proxy wrapper
 *   and sent the Spanlens key to generativelanguage.googleapis.com.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGemini,
  DEFAULT_SPANLENS_GEMINI_PROXY,
  withCache,
  withLogBody,
  withPromptVersion,
  withSession,
  withUser,
} from '../integrations/gemini.js'
import { withUser as withUserOpenAIStyle } from '../integrations/openai.js'

interface WireCall {
  url: string
  headers: Headers
}

let wire: WireCall[] = []

function okResponse(): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] } }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

beforeEach(() => {
  wire = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      wire.push({ url: String(url), headers: new Headers(init.headers) })
      return Promise.resolve(okResponse())
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const MODEL = { model: 'gemini-2.5-flash' }

describe('Gemini header helpers reach the wire', () => {
  it('withUser() from /gemini is sent as a request header', async () => {
    const model = createGemini({ apiKey: 'sl_live_x' }).getGenerativeModel(MODEL)
    await model.generateContent('hi', withUser('u-1'))

    expect(wire[0]?.headers.get('x-spanlens-user')).toBe('u-1')
  })

  it('merged helpers all arrive (customHeaders spread)', async () => {
    const model = createGemini({ apiKey: 'sl_live_x' }).getGenerativeModel(MODEL)
    await model.generateContent('hi', {
      timeout: 5000,
      customHeaders: {
        ...withUser('u-2').customHeaders,
        ...withSession('s-2').customHeaders,
        ...withLogBody('meta').customHeaders,
        ...withPromptVersion('greeter@3').customHeaders,
        ...withCache(600).customHeaders,
      },
    })

    const headers = wire[0]?.headers
    expect(headers?.get('x-spanlens-user')).toBe('u-2')
    expect(headers?.get('x-spanlens-session')).toBe('s-2')
    expect(headers?.get('x-spanlens-log-body')).toBe('meta')
    expect(headers?.get('x-spanlens-prompt-version')).toBe('greeter@3')
    expect(headers?.get('x-spanlens-cache')).toBe('600')
  })

  it('keeps the `.headers` map for code that merges helpers by hand', () => {
    expect(withLogBody('none').headers).toEqual({ 'x-spanlens-log-body': 'none' })
    expect(withLogBody('none').customHeaders).toEqual({ 'x-spanlens-log-body': 'none' })
  })

  it('model-level `{ headers }` options (OpenAI-style helpers) are converted to customHeaders', async () => {
    const model = createGemini({ apiKey: 'sl_live_x' }).getGenerativeModel(
      MODEL,
      withUserOpenAIStyle('u-3') as unknown as Parameters<
        ReturnType<typeof createGemini>['getGenerativeModel']
      >[1],
    )
    await model.generateContent('hi')

    expect(wire[0]?.headers.get('x-spanlens-user')).toBe('u-3')
    expect(wire[0]?.url.startsWith(DEFAULT_SPANLENS_GEMINI_PROXY)).toBe(true)
  })
})

describe('every model factory routes through the proxy', () => {
  it('getGenerativeModel() sends requests to the Spanlens proxy', async () => {
    await createGemini({ apiKey: 'sl_live_x' }).getGenerativeModel(MODEL).generateContent('hi')
    expect(wire[0]?.url.startsWith(`${DEFAULT_SPANLENS_GEMINI_PROXY}/`)).toBe(true)
  })

  it('getGenerativeModelFromCachedContent() never sends the Spanlens key to Google', async () => {
    const genAI = createGemini({ apiKey: 'sl_live_secret' })
    const model = genAI.getGenerativeModelFromCachedContent({
      name: 'cachedContents/abc',
      model: 'models/gemini-2.5-flash',
    })
    await model.generateContent('hi')

    expect(wire).toHaveLength(1)
    expect(wire[0]?.url.startsWith(`${DEFAULT_SPANLENS_GEMINI_PROXY}/`)).toBe(true)
    expect(wire[0]?.url).not.toContain('googleapis.com')
  })

  it('caller-supplied requestOptions still win for the cached-content factory', async () => {
    const model = createGemini({ apiKey: 'sl_live_x' }).getGenerativeModelFromCachedContent(
      { name: 'cachedContents/abc', model: 'models/gemini-2.5-flash' },
      undefined,
      { baseUrl: 'http://self-host.test/proxy/gemini', customHeaders: withUser('u-4').customHeaders },
    )
    await model.generateContent('hi')

    expect(wire[0]?.url.startsWith('http://self-host.test/proxy/gemini/')).toBe(true)
    expect(wire[0]?.headers.get('x-spanlens-user')).toBe('u-4')
  })
})
