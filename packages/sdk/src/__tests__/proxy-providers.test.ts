import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createGroq, DEFAULT_SPANLENS_GROQ_PROXY, observeGroq } from '../integrations/groq.js'
import { createDeepSeek, DEFAULT_SPANLENS_DEEPSEEK_PROXY, observeDeepSeek } from '../integrations/deepseek.js'
import { createXai, DEFAULT_SPANLENS_XAI_PROXY, observeXai } from '../integrations/xai.js'
import { createCohere, DEFAULT_SPANLENS_COHERE_PROXY, observeCohere } from '../integrations/cohere.js'
import { createMistral, DEFAULT_SPANLENS_MISTRAL_PROXY, observeMistral } from '../integrations/mistral.js'
import { createOpenRouter, DEFAULT_SPANLENS_OPENROUTER_PROXY, observeOpenRouter } from '../integrations/openrouter.js'

/**
 * The OpenAI-compatible provider factories all route through the hosted
 * Spanlens proxy (unlike createOllama, which is local). They share the
 * makeSpanlensProxyClient helper, so these tests pin the per-provider default
 * URL, the SPANLENS_API_KEY requirement, and the observe re-export.
 */

const CASES = [
  { name: 'Groq', create: createGroq, url: DEFAULT_SPANLENS_GROQ_PROXY, observe: observeGroq, slug: 'groq' },
  { name: 'DeepSeek', create: createDeepSeek, url: DEFAULT_SPANLENS_DEEPSEEK_PROXY, observe: observeDeepSeek, slug: 'deepseek' },
  { name: 'xAI', create: createXai, url: DEFAULT_SPANLENS_XAI_PROXY, observe: observeXai, slug: 'xai' },
  { name: 'Cohere', create: createCohere, url: DEFAULT_SPANLENS_COHERE_PROXY, observe: observeCohere, slug: 'cohere' },
  { name: 'Mistral', create: createMistral, url: DEFAULT_SPANLENS_MISTRAL_PROXY, observe: observeMistral, slug: 'mistral' },
  { name: 'OpenRouter', create: createOpenRouter, url: DEFAULT_SPANLENS_OPENROUTER_PROXY, observe: observeOpenRouter, slug: 'openrouter' },
] as const

describe('OpenAI-compatible proxy client factories', () => {
  let original: string | undefined

  beforeEach(() => {
    original = process.env.SPANLENS_API_KEY
    process.env.SPANLENS_API_KEY = 'sl_live_test_key'
  })

  afterEach(() => {
    if (original === undefined) delete process.env.SPANLENS_API_KEY
    else process.env.SPANLENS_API_KEY = original
  })

  for (const { name, create, url, observe, slug } of CASES) {
    describe(name, () => {
      it(`defaults baseURL to the Spanlens ${slug} proxy route`, () => {
        expect(create().baseURL).toBe(url)
        expect(url).toContain(`/proxy/${slug}/v1`)
      })

      it('picks up SPANLENS_API_KEY from the environment', () => {
        expect(create().apiKey).toBe('sl_live_test_key')
      })

      it('throws a helpful error when SPANLENS_API_KEY is missing', () => {
        delete process.env.SPANLENS_API_KEY
        expect(() => create()).toThrow(/SPANLENS_API_KEY/)
      })

      it('accepts explicit apiKey + baseURL overrides', () => {
        const client = create({ apiKey: 'override', baseURL: 'https://self-hosted.example/proxy' })
        expect(client.apiKey).toBe('override')
        expect(client.baseURL).toBe('https://self-hosted.example/proxy')
      })

      it('re-exports its observe helper for single-import ergonomics', () => {
        expect(typeof observe).toBe('function')
      })
    })
  }
})
