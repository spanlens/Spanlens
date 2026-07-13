import { afterEach, describe, expect, it } from 'vitest'
import {
  REPLAY_RUN_SUPPORTED_PROVIDERS,
  buildReplayProxyPath,
  buildReplayUpstream,
  isOpenAiCompatReplayProvider,
  parseReplayUsage,
} from '../lib/replay-providers.js'

// 2026-07-13 audit: POST /:id/replay/run rejected everything but
// openai/anthropic/gemini even though the server proxies 10 providers, and
// the curl-snippet builder emitted a bogus `/proxy/<p>` path for the
// OpenAI-compatible ones. These tests pin the provider→path/upstream mapping.

describe('buildReplayProxyPath', () => {
  it('maps every proxied provider to its documented proxy base path', () => {
    expect(buildReplayProxyPath('openai', 'gpt-4o')).toBe('/proxy/openai/v1/chat/completions')
    expect(buildReplayProxyPath('anthropic', 'claude-3-5-sonnet')).toBe('/proxy/anthropic/v1/messages')
    expect(buildReplayProxyPath('mistral', 'mistral-large-latest')).toBe('/proxy/mistral/v1/chat/completions')
    expect(buildReplayProxyPath('openrouter', 'meta-llama/llama-3-8b')).toBe('/proxy/openrouter/v1/chat/completions')
    expect(buildReplayProxyPath('groq', 'llama-3.3-70b')).toBe('/proxy/groq/v1/chat/completions')
    expect(buildReplayProxyPath('deepseek', 'deepseek-chat')).toBe('/proxy/deepseek/v1/chat/completions')
    expect(buildReplayProxyPath('xai', 'grok-3')).toBe('/proxy/xai/v1/chat/completions')
    expect(buildReplayProxyPath('cohere', 'command-a-03-2025')).toBe('/proxy/cohere/v1/chat/completions')
  })

  it('azure mounts at /proxy/azure (docs base_url has no /v1 — the SDK appends /chat/completions)', () => {
    expect(buildReplayProxyPath('azure', 'gpt-4o')).toBe('/proxy/azure/chat/completions')
  })

  it('gemini encodes the model into the URL, tolerating a models/ prefix', () => {
    expect(buildReplayProxyPath('gemini', 'gemini-2.0-flash')).toBe(
      '/proxy/gemini/v1beta/models/gemini-2.0-flash:generateContent',
    )
    expect(buildReplayProxyPath('gemini', 'models/gemini-2.0-flash')).toBe(
      '/proxy/gemini/v1beta/models/gemini-2.0-flash:generateContent',
    )
  })

  it('falls back to the bare proxy mount for unknown providers', () => {
    expect(buildReplayProxyPath('someday-provider', 'x')).toBe('/proxy/someday-provider')
  })
})

describe('buildReplayUpstream', () => {
  const savedMistralBase = process.env['MISTRAL_API_BASE']

  afterEach(() => {
    if (savedMistralBase === undefined) delete process.env['MISTRAL_API_BASE']
    else process.env['MISTRAL_API_BASE'] = savedMistralBase
  })

  it('routes OpenAI-compatible providers to their chat-completions endpoint with Bearer auth', () => {
    const cases: Record<string, string> = {
      openai: 'https://api.openai.com/v1/chat/completions',
      mistral: 'https://api.mistral.ai/v1/chat/completions',
      openrouter: 'https://openrouter.ai/api/v1/chat/completions',
      groq: 'https://api.groq.com/openai/v1/chat/completions',
      deepseek: 'https://api.deepseek.com/v1/chat/completions',
      xai: 'https://api.x.ai/v1/chat/completions',
      cohere: 'https://api.cohere.ai/compatibility/v1/chat/completions',
    }
    for (const [provider, url] of Object.entries(cases)) {
      const upstream = buildReplayUpstream(provider, 'some-model', 'sk-test')
      expect(upstream, provider).not.toBeNull()
      expect(upstream?.url, provider).toBe(url)
      expect(upstream?.headers['Authorization'], provider).toBe('Bearer sk-test')
      expect(upstream?.headers['Content-Type'], provider).toBe('application/json')
    }
  })

  it('honours the same env base override as the proxy modules (trailing /v1 stripped)', () => {
    process.env['MISTRAL_API_BASE'] = 'https://mistral.example.com/v1/'
    const upstream = buildReplayUpstream('mistral', 'mistral-small', 'sk-x')
    expect(upstream?.url).toBe('https://mistral.example.com/v1/chat/completions')
  })

  it('anthropic uses x-api-key + anthropic-version headers', () => {
    const upstream = buildReplayUpstream('anthropic', 'claude-3-5-sonnet', 'sk-ant-test')
    expect(upstream?.url).toBe('https://api.anthropic.com/v1/messages')
    expect(upstream?.headers['x-api-key']).toBe('sk-ant-test')
    expect(upstream?.headers['anthropic-version']).toBe('2023-06-01')
    expect(upstream?.headers['Authorization']).toBeUndefined()
  })

  it('gemini authenticates via the key query param and encodes the model in the URL', () => {
    const upstream = buildReplayUpstream('gemini', 'gemini-2.0-flash', 'AIza-test')
    expect(upstream?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=AIza-test',
    )
  })

  it('returns null for azure (per-key resource URL) and unknown providers', () => {
    expect(buildReplayUpstream('azure', 'gpt-4o', 'azure-key')).toBeNull()
    expect(buildReplayUpstream('someday-provider', 'x', 'k')).toBeNull()
  })

  it('the supported list matches what buildReplayUpstream actually supports', () => {
    for (const provider of REPLAY_RUN_SUPPORTED_PROVIDERS) {
      expect(buildReplayUpstream(provider, 'm', 'k'), provider).not.toBeNull()
    }
    expect(REPLAY_RUN_SUPPORTED_PROVIDERS).not.toContain('azure')
    expect(isOpenAiCompatReplayProvider('azure')).toBe(false)
  })
})

describe('parseReplayUsage', () => {
  it('parses the OpenAI usage shape for openai and every compat provider', () => {
    const body = { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }
    for (const provider of ['openai', 'mistral', 'openrouter', 'groq', 'deepseek', 'xai', 'cohere']) {
      expect(parseReplayUsage(provider, body), provider).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      })
    }
  })

  it('parses anthropic input/output tokens and derives the total', () => {
    expect(parseReplayUsage('anthropic', { usage: { input_tokens: 7, output_tokens: 3 } })).toEqual({
      promptTokens: 7,
      completionTokens: 3,
      totalTokens: 10,
    })
  })

  it('folds gemini thoughtsTokenCount into completion tokens (billed at output rate)', () => {
    const body = {
      usageMetadata: {
        promptTokenCount: 20,
        candidatesTokenCount: 8,
        thoughtsTokenCount: 12,
        totalTokenCount: 40,
      },
    }
    expect(parseReplayUsage('gemini', body)).toEqual({
      promptTokens: 20,
      completionTokens: 20,
      totalTokens: 40,
    })
  })

  it('returns zeros when usage is absent or the provider is unknown', () => {
    expect(parseReplayUsage('openai', {})).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 })
    expect(parseReplayUsage('someday-provider', { usage: { prompt_tokens: 9 } })).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    })
  })
})
