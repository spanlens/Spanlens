import { afterEach, describe, expect, it } from 'vitest'
import {
  EMPTY_REPLAY_USAGE,
  REPLAY_RUN_SUPPORTED_PROVIDERS,
  buildReplayProxyPath,
  buildReplayUpstream,
  isOpenAiCompatReplayProvider,
  parseReplayUsage,
  replayCostUsd,
  replayTimeoutMs,
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
      expect(parseReplayUsage(provider, body), provider).toMatchObject({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      })
    }
  })

  it('keeps the OpenAI cached subset and the served tier (XVERIFY C11.1)', () => {
    const usage = parseReplayUsage('openai', {
      model: 'gpt-4o-mini-2024-07-18',
      service_tier: 'flex',
      usage: {
        prompt_tokens: 100,
        completion_tokens: 5,
        total_tokens: 105,
        prompt_tokens_details: { cached_tokens: 80 },
      },
    })
    expect(usage).toMatchObject({
      promptTokens: 100,
      cacheReadTokens: 80,
      serviceTier: 'flex',
      model: 'gpt-4o-mini-2024-07-18',
      reportedCostUsd: null,
    })
  })

  it('parses anthropic input/output tokens and derives the total', () => {
    expect(parseReplayUsage('anthropic', { usage: { input_tokens: 7, output_tokens: 3 } })).toMatchObject({
      promptTokens: 7,
      completionTokens: 3,
      totalTokens: 10,
    })
  })

  it('counts anthropic cache reads and writes into promptTokens, like the proxy', () => {
    // input_tokens EXCLUDES the cached portions on Anthropic, so reading it
    // alone dropped 100k of the 100,050 input tokens from the replay row.
    const usage = parseReplayUsage('anthropic', {
      usage: {
        input_tokens: 50,
        cache_read_input_tokens: 90_000,
        cache_creation_input_tokens: 10_000,
        output_tokens: 500,
      },
    })
    expect(usage).toMatchObject({
      promptTokens: 100_050,
      cacheReadTokens: 90_000,
      cacheWriteTokens: 10_000,
      totalTokens: 100_550,
    })
  })

  it('folds gemini thoughtsTokenCount into completion tokens (billed at output rate)', () => {
    const body = {
      usageMetadata: {
        promptTokenCount: 20,
        cachedContentTokenCount: 15,
        candidatesTokenCount: 8,
        thoughtsTokenCount: 12,
        totalTokenCount: 40,
      },
    }
    expect(parseReplayUsage('gemini', body)).toMatchObject({
      promptTokens: 20,
      completionTokens: 20,
      totalTokens: 40,
      cacheReadTokens: 15,
    })
  })

  it('carries OpenRouter usage.cost as the reported cost', () => {
    const body = { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.0042 } }
    expect(parseReplayUsage('openrouter', body)?.reportedCostUsd).toBe(0.0042)
    // Only OpenRouter reports billed USD; the same field elsewhere is ignored.
    expect(parseReplayUsage('openai', body)?.reportedCostUsd).toBeNull()
  })

  it('returns null (usage unknown) when usage is absent, unreadable, or the provider is unknown', () => {
    expect(parseReplayUsage('openai', {})).toBeNull()
    expect(parseReplayUsage('openai', { usage: { some_future_field: 1 } })).toBeNull()
    expect(parseReplayUsage('someday-provider', { usage: { prompt_tokens: 9 } })).toBeNull()
  })
})

describe('replayCostUsd', () => {
  it('prefers the provider-reported cost over the local price table', () => {
    expect(replayCostUsd('openrouter', 'openai/gpt-4o', { ...EMPTY_REPLAY_USAGE, promptTokens: 1_000_000, reportedCostUsd: 0.5 }))
      .toBe(0.5)
  })

  it('falls back to the vendor-stripped id for OpenRouter models missing from its own rows', () => {
    // No openrouter rows are loaded in tests; the stripped id resolves
    // against FALLBACK_PRICES exactly as proxy/openrouter.ts does.
    const cost = replayCostUsd('openrouter', 'openai/gpt-4o-mini', {
      ...EMPTY_REPLAY_USAGE,
      promptTokens: 1_000_000,
    })
    expect(cost).toBeCloseTo(0.15, 9)
  })

  it('returns null for an unpriced model', () => {
    expect(replayCostUsd('openai', 'no-such-model-anywhere', EMPTY_REPLAY_USAGE)).toBeNull()
  })
})

describe('replayTimeoutMs', () => {
  const saved = process.env['UPSTREAM_TIMEOUT_MS']
  afterEach(() => {
    if (saved === undefined) delete process.env['UPSTREAM_TIMEOUT_MS']
    else process.env['UPSTREAM_TIMEOUT_MS'] = saved
  })

  it('uses the proxy UPSTREAM_TIMEOUT_MS setting, defaulting to 35s', () => {
    delete process.env['UPSTREAM_TIMEOUT_MS']
    expect(replayTimeoutMs()).toBe(35_000)
    process.env['UPSTREAM_TIMEOUT_MS'] = '12000'
    expect(replayTimeoutMs()).toBe(12_000)
    process.env['UPSTREAM_TIMEOUT_MS'] = 'not-a-number'
    expect(replayTimeoutMs()).toBe(35_000)
  })
})
