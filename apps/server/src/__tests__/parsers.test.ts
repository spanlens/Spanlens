import { describe, it, expect } from 'vitest'
import { parseOpenAIResponse, parseOpenAIStreamChunk } from '../parsers/openai.js'
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
    })
  })

  it('returns null when usage missing', () => {
    expect(parseOpenAIResponse({ model: 'gpt-4o' })).toBeNull()
  })

  it('parses last stream chunk with usage', () => {
    const line = `data: ${JSON.stringify({ model: 'gpt-4o', usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 } })}`
    expect(parseOpenAIStreamChunk(line)?.promptTokens).toBe(5)
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
    })
  })

  it('extracts prompt tokens from message_start event', () => {
    const line = `data: ${JSON.stringify({ type: 'message_start', message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 42 } } })}`
    expect(parseAnthropicStreamStart(line)?.promptTokens).toBe(42)
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
    })
  })
})
