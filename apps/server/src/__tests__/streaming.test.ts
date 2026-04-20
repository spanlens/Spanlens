import { describe, it, expect } from 'vitest'
import { parseOpenAIStreamChunk } from '../parsers/openai.js'
import { parseAnthropicStreamStart, parseAnthropicStreamChunk } from '../parsers/anthropic.js'

describe('OpenAI streaming parser', () => {
  it('parses usage from the last chunk', () => {
    const line =
      'data: {"id":"x","object":"chat.completion.chunk","model":"gpt-4o","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}'
    const parsed = parseOpenAIStreamChunk(line)
    expect(parsed).not.toBeNull()
    expect(parsed?.promptTokens).toBe(10)
    expect(parsed?.completionTokens).toBe(5)
    expect(parsed?.totalTokens).toBe(15)
  })

  it('returns null for [DONE] sentinel', () => {
    expect(parseOpenAIStreamChunk('data: [DONE]')).toBeNull()
  })

  it('returns null for lines without usage', () => {
    const line =
      'data: {"id":"x","object":"chat.completion.chunk","choices":[{"delta":{"content":"hello"}}]}'
    const parsed = parseOpenAIStreamChunk(line)
    expect(parsed).toBeNull()
  })
})

describe('Anthropic streaming parser', () => {
  it('parses prompt tokens from message_start', () => {
    const line =
      'data: {"type":"message_start","message":{"id":"x","model":"claude-sonnet-4-6","usage":{"input_tokens":20,"output_tokens":0}}}'
    const parsed = parseAnthropicStreamStart(line)
    expect(parsed?.promptTokens).toBe(20)
    expect(parsed?.model).toBe('claude-sonnet-4-6')
  })

  it('parses completion tokens from message_delta', () => {
    const line = 'data: {"type":"message_delta","delta":{},"usage":{"output_tokens":30}}'
    const parsed = parseAnthropicStreamChunk(line)
    expect(parsed?.completionTokens).toBe(30)
  })

  it('returns null for non-matching event types', () => {
    const line = 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}'
    expect(parseAnthropicStreamChunk(line)).toBeNull()
    expect(parseAnthropicStreamStart(line)).toBeNull()
  })
})
