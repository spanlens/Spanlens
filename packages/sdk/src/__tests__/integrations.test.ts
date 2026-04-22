import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createOpenAI, DEFAULT_SPANLENS_OPENAI_PROXY } from '../integrations/openai.js'
import { createAnthropic, DEFAULT_SPANLENS_ANTHROPIC_PROXY } from '../integrations/anthropic.js'
import { createGemini, DEFAULT_SPANLENS_GEMINI_PROXY } from '../integrations/gemini.js'

describe('integration helpers', () => {
  const originalEnv = process.env.SPANLENS_API_KEY
  beforeEach(() => {
    delete process.env.SPANLENS_API_KEY
  })
  afterEach(() => {
    if (originalEnv !== undefined) process.env.SPANLENS_API_KEY = originalEnv
  })

  describe('createOpenAI', () => {
    it('throws when neither env nor option provides apiKey', () => {
      expect(() => createOpenAI()).toThrow(/SPANLENS_API_KEY/)
    })

    it('picks up SPANLENS_API_KEY from env', () => {
      process.env.SPANLENS_API_KEY = 'sl_live_test_key'
      const client = createOpenAI()
      expect(client.apiKey).toBe('sl_live_test_key')
      expect(client.baseURL).toBe(DEFAULT_SPANLENS_OPENAI_PROXY)
    })

    it('accepts explicit apiKey override', () => {
      const client = createOpenAI({ apiKey: 'explicit_key' })
      expect(client.apiKey).toBe('explicit_key')
    })

    it('accepts baseURL override for self-hosted', () => {
      const client = createOpenAI({
        apiKey: 'k',
        baseURL: 'https://my-spanlens.local/proxy/openai/v1',
      })
      expect(client.baseURL).toBe('https://my-spanlens.local/proxy/openai/v1')
    })

    it('forwards arbitrary options (timeout, headers, etc.)', () => {
      const client = createOpenAI({
        apiKey: 'k',
        timeout: 30_000,
        defaultHeaders: { 'x-custom': 'v' },
      })
      expect(client.timeout).toBe(30_000)
    })
  })

  describe('createAnthropic', () => {
    it('throws when apiKey missing', () => {
      expect(() => createAnthropic()).toThrow(/SPANLENS_API_KEY/)
    })

    it('uses env var and default proxy', () => {
      process.env.SPANLENS_API_KEY = 'sl_live_test_key'
      const client = createAnthropic()
      expect(client.apiKey).toBe('sl_live_test_key')
      expect(client.baseURL).toBe(DEFAULT_SPANLENS_ANTHROPIC_PROXY)
    })

    it('accepts options override', () => {
      const client = createAnthropic({
        apiKey: 'k',
        baseURL: 'https://custom/',
      })
      expect(client.baseURL).toBe('https://custom/')
    })
  })

  describe('createGemini', () => {
    it('throws when apiKey missing', () => {
      expect(() => createGemini()).toThrow(/SPANLENS_API_KEY/)
    })

    it('constructs GoogleGenerativeAI with Spanlens proxy baseUrl', () => {
      process.env.SPANLENS_API_KEY = 'sl_live_test_key'
      const client = createGemini()
      expect(client).toBeDefined()
      // No public baseUrl accessor on the Google SDK — test via constructor accepting without throw
    })

    it('accepts baseUrl override', () => {
      const client = createGemini({ apiKey: 'k', baseUrl: 'https://custom/' })
      expect(client).toBeDefined()
    })
  })
})
