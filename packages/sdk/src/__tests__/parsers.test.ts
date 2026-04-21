import { describe, it, expect } from 'vitest'
import { parseOpenAIUsage, parseAnthropicUsage, parseGeminiUsage } from '../parsers.js'

describe('parseOpenAIUsage', () => {
  it('parses chat.completions usage', () => {
    const res = {
      model: 'gpt-4o-mini',
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    }
    expect(parseOpenAIUsage(res)).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      metadata: { model: 'gpt-4o-mini' },
    })
  })

  it('parses responses API usage (input/output_tokens)', () => {
    const res = {
      model: 'gpt-4o',
      usage: { input_tokens: 10, output_tokens: 20 },
    }
    const parsed = parseOpenAIUsage(res)
    expect(parsed.promptTokens).toBe(10)
    expect(parsed.completionTokens).toBe(20)
    expect(parsed.totalTokens).toBe(30)
  })

  it('returns empty object when usage is missing (streaming mid-call)', () => {
    expect(parseOpenAIUsage({ model: 'gpt-4o' })).toEqual({})
  })

  it('tolerates null/undefined input', () => {
    expect(parseOpenAIUsage(null)).toEqual({})
    expect(parseOpenAIUsage(undefined)).toEqual({})
  })
})

describe('parseAnthropicUsage', () => {
  it('parses messages.create usage (input/output_tokens)', () => {
    const res = {
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: 42, output_tokens: 128 },
    }
    expect(parseAnthropicUsage(res)).toEqual({
      promptTokens: 42,
      completionTokens: 128,
      totalTokens: 170,
      metadata: { model: 'claude-sonnet-4-6' },
    })
  })

  it('returns empty when usage missing', () => {
    expect(parseAnthropicUsage({})).toEqual({})
  })
})

describe('parseGeminiUsage', () => {
  it('parses generateContent usageMetadata', () => {
    const res = {
      modelVersion: 'gemini-1.5-pro-002',
      usageMetadata: {
        promptTokenCount: 11,
        candidatesTokenCount: 22,
        totalTokenCount: 33,
      },
    }
    expect(parseGeminiUsage(res)).toEqual({
      promptTokens: 11,
      completionTokens: 22,
      totalTokens: 33,
      metadata: { model: 'gemini-1.5-pro-002' },
    })
  })
})
