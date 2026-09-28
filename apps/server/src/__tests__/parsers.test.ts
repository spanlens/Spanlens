import { describe, it, expect } from 'vitest'
import {
  isOpenAIUsageUnknown,
  openAIUsageSchemaForPath,
  parseOpenAIResponse,
  parseOpenAIStreamChunk,
} from '../parsers/openai.js'
import {
  parseAnthropicResponse,
  parseAnthropicStreamChunk,
  parseAnthropicStreamStart,
} from '../parsers/anthropic.js'
import { parseGeminiResponse } from '../parsers/gemini.js'

describe('OpenAI parser', () => {
  it('parses non-streaming response', () => {
    const body = {
      model: 'gpt-4o',
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    }
    expect(parseOpenAIResponse(body)).toEqual({
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      model: 'gpt-4o',
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
  })

  it('parses embeddings response (data array, prompt_tokens only)', () => {
    // OpenAI's /v1/embeddings returns `data: [{embedding: [...]}]` instead of
    // `choices`, and the usage shape carries only prompt_tokens (no completion
    // side because embedding is input-only). The parser reads `usage` blindly
    // so embeddings work without a separate code path — this test pins that
    // contract so a future refactor that special-cases `choices` doesn't
    // silently regress RAG cost tracking.
    const body = {
      object: 'list',
      model: 'text-embedding-3-small',
      data: [{ object: 'embedding', index: 0, embedding: [0.01, 0.02, 0.03] }],
      usage: { prompt_tokens: 8, total_tokens: 8 },
    }
    expect(parseOpenAIResponse(body)).toEqual({
      promptTokens: 8,
      completionTokens: 0,
      totalTokens: 8,
      model: 'text-embedding-3-small',
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
  })

  it('extracts cached_tokens from prompt_tokens_details', () => {
    const body = {
      model: 'gpt-4o',
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        prompt_tokens_details: { cached_tokens: 60 },
      },
    }
    const parsed = parseOpenAIResponse(body)
    expect(parsed?.promptTokens).toBe(100)
    expect(parsed?.cacheReadTokens).toBe(60)
  })

  it('returns null when usage missing', () => {
    expect(parseOpenAIResponse({ model: 'gpt-4o' })).toBeNull()
  })

  it('parses last stream chunk with usage', () => {
    const line = `data: ${JSON.stringify({ model: 'gpt-4o', usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 } })}`
    expect(parseOpenAIStreamChunk(line)?.promptTokens).toBe(5)
  })

  it('extracts service_tier when provided (priority, flex, default)', () => {
    for (const tier of ['priority', 'flex', 'default', 'auto', 'scale'] as const) {
      const body = {
        model: 'gpt-5.5',
        service_tier: tier,
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }
      expect(parseOpenAIResponse(body)?.serviceTier).toBe(tier)
    }
  })

  it('drops unknown service_tier values', () => {
    const body = {
      model: 'gpt-5.5',
      service_tier: 'experimental-unknown',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }
    expect(parseOpenAIResponse(body)?.serviceTier).toBeUndefined()
  })

  it('leaves serviceTier undefined when response omits the field', () => {
    const body = { model: 'gpt-4o', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }
    expect(parseOpenAIResponse(body)?.serviceTier).toBeUndefined()
  })

  it('extracts service_tier from streaming chunk usage', () => {
    const line = `data: ${JSON.stringify({ model: 'gpt-5.5', service_tier: 'flex', usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 } })}`
    expect(parseOpenAIStreamChunk(line)?.serviceTier).toBe('flex')
  })
})

describe('OpenAI Responses API usage', () => {
  // POST /v1/responses reports usage as input_tokens / output_tokens. Reading
  // it with the Chat Completions field names produced 0 / 0 tokens and a $0
  // cost next to total_tokens = 1200 (XVERIFY C7.3).
  const responsesBody = {
    id: 'resp_1',
    object: 'response',
    model: 'gpt-4o-2024-08-06',
    service_tier: 'flex',
    usage: {
      input_tokens: 1000,
      input_tokens_details: { cached_tokens: 300 },
      output_tokens: 200,
      output_tokens_details: { reasoning_tokens: 50 },
      total_tokens: 1200,
    },
  }

  it('maps each endpoint path to the usage schema it returns', () => {
    expect(openAIUsageSchemaForPath('/v1/responses')).toBe('responses')
    expect(openAIUsageSchemaForPath('/v1/responses/')).toBe('responses')
    expect(openAIUsageSchemaForPath('/v1/chat/completions')).toBe('chat')
    expect(openAIUsageSchemaForPath('/v1/embeddings')).toBe('chat')
    // Retrieving a stored response is not a new generation: its usage was
    // already recorded by the create call, so it must not be read as spend.
    expect(openAIUsageSchemaForPath('/v1/responses/resp_1')).toBe('chat')
  })

  it('parses input/output tokens, the cached subset, model, and tier', () => {
    expect(parseOpenAIResponse(responsesBody, 'responses')).toEqual({
      promptTokens: 1000,
      // reasoning tokens are already included in output_tokens
      completionTokens: 200,
      totalTokens: 1200,
      model: 'gpt-4o-2024-08-06',
      cacheReadTokens: 300,
      cacheWriteTokens: 0,
      serviceTier: 'flex',
    })
  })

  it('returns null (usage unknown), not zero tokens, when the schema does not match', () => {
    expect(parseOpenAIResponse(responsesBody)).toBeNull()
    expect(parseOpenAIResponse(
      { model: 'gpt-4o', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
      'responses',
    )).toBeNull()
  })

  it('flags usage as unknown when a usage object is present but unreadable', () => {
    expect(isOpenAIUsageUnknown(responsesBody, 'chat')).toBe(true)
    expect(isOpenAIUsageUnknown(responsesBody, 'responses')).toBe(false)
    // Chat-style endpoints with no usage at all (moderations, model lists)
    // keep the previous behavior: nothing to read, nothing unknown.
    expect(isOpenAIUsageUnknown({ results: [] }, 'chat')).toBe(false)
    // A Responses create call without usage (background mode answers
    // `usage: null` while the response is still queued) has an unknown cost.
    expect(isOpenAIUsageUnknown({ object: 'response', status: 'queued', usage: null }, 'responses')).toBe(true)
  })

  it('parses usage from the terminal response.completed stream event', () => {
    const line = `data: ${JSON.stringify({
      type: 'response.completed',
      sequence_number: 9,
      response: responsesBody,
    })}`
    const parsed = parseOpenAIStreamChunk(line)
    expect(parsed?.promptTokens).toBe(1000)
    expect(parsed?.completionTokens).toBe(200)
    expect(parsed?.totalTokens).toBe(1200)
    expect(parsed?.cacheReadTokens).toBe(300)
    expect(parsed?.model).toBe('gpt-4o-2024-08-06')
    expect(parsed?.serviceTier).toBe('flex')
  })

  it('parses usage from response.incomplete (max_output_tokens reached, still billed)', () => {
    const line = `data: ${JSON.stringify({
      type: 'response.incomplete',
      response: { ...responsesBody, status: 'incomplete' },
    })}`
    expect(parseOpenAIStreamChunk(line)?.completionTokens).toBe(200)
  })

  it('ignores the non-terminal response.created event, whose usage is still null', () => {
    const line = `data: ${JSON.stringify({
      type: 'response.created',
      response: { ...responsesBody, status: 'in_progress', usage: null },
    })}`
    expect(parseOpenAIStreamChunk(line)).toBeNull()
  })
})

describe('Anthropic parser', () => {
  it('parses non-streaming response', () => {
    const body = { model: 'claude-sonnet-4-6', usage: { input_tokens: 10, output_tokens: 20 } }
    expect(parseAnthropicResponse(body)).toEqual({
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      model: 'claude-sonnet-4-6',
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
  })

  it('sums input + cache_read + cache_creation into promptTokens', () => {
    const body = {
      model: 'claude-sonnet-4-6',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 800,
        cache_creation_input_tokens: 200,
      },
    }
    const parsed = parseAnthropicResponse(body)
    // promptTokens is the GROSS input (cache included), so existing aggregates
    // continue to see "total input sent" rather than "non-cached input".
    expect(parsed?.promptTokens).toBe(1100)
    expect(parsed?.cacheReadTokens).toBe(800)
    expect(parsed?.cacheWriteTokens).toBe(200)
  })

  it('extracts prompt tokens from message_start event', () => {
    const line = `data: ${JSON.stringify({ type: 'message_start', message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 42 } } })}`
    expect(parseAnthropicStreamStart(line)?.promptTokens).toBe(42)
  })

  it('extracts cache breakdown from message_start event', () => {
    const line = `data: ${JSON.stringify({
      type: 'message_start',
      message: {
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 50, cache_read_input_tokens: 400, cache_creation_input_tokens: 100 },
      },
    })}`
    const parsed = parseAnthropicStreamStart(line)
    expect(parsed?.promptTokens).toBe(550)
    expect(parsed?.cacheReadTokens).toBe(400)
    expect(parsed?.cacheWriteTokens).toBe(100)
  })

  it('extracts completion tokens from message_delta event', () => {
    const line = `data: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: 99 } })}`
    expect(parseAnthropicStreamChunk(line)?.completionTokens).toBe(99)
  })

  it('ignores non message_delta events', () => {
    const line = `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } })}`
    expect(parseAnthropicStreamChunk(line)).toBeNull()
  })
})

describe('Gemini parser', () => {
  it('parses response', () => {
    const body = {
      modelVersion: 'gemini-1.5-pro',
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 10, totalTokenCount: 15 },
    }
    expect(parseGeminiResponse(body)).toEqual({
      promptTokens: 5,
      completionTokens: 10,
      totalTokens: 15,
      model: 'gemini-1.5-pro',
      cacheReadTokens: 0,
    })
  })

  it('reports cachedContentTokenCount as cacheReadTokens, a subset of promptTokens', () => {
    // Gemini 2.5+ caches implicitly, and promptTokenCount INCLUDES the cached
    // portion (same convention as OpenAI prompt_tokens). The cached subset
    // has to surface separately or calculateCost bills it at the full rate.
    const body = {
      modelVersion: 'gemini-2.5-flash',
      usageMetadata: {
        promptTokenCount: 1000,
        cachedContentTokenCount: 900,
        candidatesTokenCount: 60,
        thoughtsTokenCount: 40,
        totalTokenCount: 1100,
      },
    }
    const parsed = parseGeminiResponse(body)
    expect(parsed?.promptTokens).toBe(1000)
    expect(parsed?.cacheReadTokens).toBe(900)
    // Reasoning tokens stay folded into completion tokens (gotcha #1).
    expect(parsed?.completionTokens).toBe(100)
  })

  it('extracts serviceTier from usageMetadata (lowercase + SCREAMING_SNAKE)', () => {
    const cases = [
      { input: 'priority', expected: 'priority' },
      { input: 'PRIORITY', expected: 'priority' },
      { input: 'flex', expected: 'flex' },
      { input: 'GENERATE_CONTENT_PROCESSING_TIER_FLEX', expected: 'flex' },
      { input: 'default', expected: 'default' },
    ]
    for (const { input, expected } of cases) {
      const body = {
        modelVersion: 'gemini-2.5-pro',
        usageMetadata: {
          promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15,
          serviceTier: input,
        },
      }
      expect(parseGeminiResponse(body)?.serviceTier).toBe(expected)
    }
  })

  it('returns undefined serviceTier when missing or unrecognized', () => {
    const body = {
      modelVersion: 'gemini-2.5-pro',
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
    }
    expect(parseGeminiResponse(body)?.serviceTier).toBeUndefined()
  })
})
