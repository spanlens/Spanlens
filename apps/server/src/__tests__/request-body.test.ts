import { describe, expect, it } from 'vitest'
import { acceptsIncludeUsage } from '../proxy/shared/request-body.js'

// XVERIFY C7.3: `stream_options.include_usage` was injected into every
// streaming request on the OpenAI-compatible proxies, including the Responses
// API, which has no such parameter. Injection is now limited to the endpoints
// that document it.

describe('acceptsIncludeUsage', () => {
  it('accepts chat-completions paths across every OpenAI-compatible proxy mount', () => {
    for (const path of [
      '/proxy/openai/v1/chat/completions',
      '/proxy/azure/chat/completions',
      '/proxy/azure/openai/deployments/gpt-4o/chat/completions',
      '/proxy/azure/openai/v1/chat/completions',
      '/proxy/groq/openai/v1/chat/completions',
      '/proxy/deepseek/chat/completions',
      '/proxy/xai/v1/chat/completions',
    ]) {
      expect(acceptsIncludeUsage(path), path).toBe(true)
    }
  })

  it('accepts the legacy completions endpoint (DeepSeek FIM included)', () => {
    expect(acceptsIncludeUsage('/proxy/openai/v1/completions')).toBe(true)
    expect(acceptsIncludeUsage('/proxy/deepseek/beta/completions')).toBe(true)
  })

  it('rejects the Responses API and other streaming endpoints', () => {
    for (const path of [
      '/proxy/openai/v1/responses',
      '/proxy/azure/openai/v1/responses',
      '/proxy/groq/openai/v1/responses',
      '/proxy/xai/v1/responses',
      '/proxy/openai/v1/threads/thread_1/runs',
      '/proxy/openai/v1/audio/speech',
      '/proxy/openai/v1/chat/completions/chatcmpl_1/messages',
    ]) {
      expect(acceptsIncludeUsage(path), path).toBe(false)
    }
  })
})
