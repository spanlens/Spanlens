import { describe, it, expect } from 'vitest'
import { extractOpenAIStreamText } from '../parsers/openai.js'
import { extractAnthropicStreamText } from '../parsers/anthropic.js'
import { extractGeminiStreamText } from '../parsers/gemini.js'

/**
 * Regression tests for streaming-response body capture.
 *
 * Why these exist: the dashboard relies on these parsers to reconstruct the
 * assistant-visible text from streamed responses so request_detail and
 * span_output can render. A provider format drift here would silently null
 * out response_body for all streaming requests. These tests pin the wire
 * formats so any change has to update both the parser and the fixture.
 */

describe('OpenAI stream text extraction', () => {
  it('joins delta.content from chat.completion.chunk events', () => {
    const lines = [
      `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: ', ' } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'world.' } }] })}`,
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } })}`,
      'data: [DONE]',
    ]
    expect(extractOpenAIStreamText(lines)).toBe('Hello, world.')
  })

  it('stops at [DONE] sentinel without throwing', () => {
    const lines = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hi' } }] })}`,
      'data: [DONE]',
      // anything after [DONE] is provider noise — ignore
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'leaked' } }] })}`,
    ]
    expect(extractOpenAIStreamText(lines)).toBe('Hi')
  })

  it('returns "" for empty / malformed input (no throw)', () => {
    expect(extractOpenAIStreamText([])).toBe('')
    expect(extractOpenAIStreamText(['', 'event: ping', ': comment'])).toBe('')
    expect(extractOpenAIStreamText(['data: this is not json'])).toBe('')
  })

  it('captures partial text even when stream is aborted mid-flight', () => {
    // Real-world scenario: connection dies after some chunks. Should still
    // return what was already received instead of erroring out.
    const lines = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'Partial ' } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'response' } }] })}`,
      // upstream cuts here — no [DONE], no final usage chunk
    ]
    expect(extractOpenAIStreamText(lines)).toBe('Partial response')
  })
})

describe('Anthropic stream text extraction', () => {
  it('joins text_delta events from content_block_delta', () => {
    const lines = [
      `data: ${JSON.stringify({ type: 'message_start', message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 10 } } })}`,
      `data: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}`,
      `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } })}`,
      `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ', world.' } })}`,
      `data: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}`,
      `data: ${JSON.stringify({ type: 'message_delta', delta: {}, usage: { output_tokens: 5 } })}`,
      `data: ${JSON.stringify({ type: 'message_stop' })}`,
    ]
    expect(extractAnthropicStreamText(lines)).toBe('Hello, world.')
  })

  it('ignores non-text_delta deltas (tool_use, etc.)', () => {
    const lines = [
      `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'pre' } })}`,
      `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"a":1}' } })}`,
      `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'post' } })}`,
    ]
    expect(extractAnthropicStreamText(lines)).toBe('prepost')
  })

  it('returns "" for malformed input without throwing', () => {
    expect(extractAnthropicStreamText([])).toBe('')
    expect(extractAnthropicStreamText(['data: garbage', 'event: ping'])).toBe('')
  })

  it('captures partial text on aborted stream', () => {
    const lines = [
      `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Cut ' } })}`,
      `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'off' } })}`,
      // no message_stop — stream interrupted
    ]
    expect(extractAnthropicStreamText(lines)).toBe('Cut off')
  })
})

describe('Gemini stream text extraction', () => {
  it('parses SSE form (alt=sse)', () => {
    const lines = [
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Hello' }] } }] })}`,
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: ', Gemini.' }] } }] })}`,
    ]
    expect(extractGeminiStreamText(lines)).toBe('Hello, Gemini.')
  })

  it('parses default JSON-array form', () => {
    const arr = [
      { candidates: [{ content: { parts: [{ text: 'First ' }] } }] },
      { candidates: [{ content: { parts: [{ text: 'second.' }] } }] },
    ]
    expect(extractGeminiStreamText(JSON.stringify(arr).split('\n'))).toBe('First second.')
  })

  it('falls back to per-line scan for partial/truncated streams', () => {
    // A Gemini stream cut off mid-array — opening bracket present, closing
    // missing. Per-line scan should still recover what it can.
    const truncated = [
      '[',
      `${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Partial' }] } }] })},`,
      // closing bracket never arrived
    ]
    expect(extractGeminiStreamText(truncated)).toBe('Partial')
  })

  it('returns "" for empty or non-Gemini input', () => {
    expect(extractGeminiStreamText([])).toBe('')
    expect(extractGeminiStreamText(['random text'])).toBe('')
  })

  it('accepts a single string buffer instead of lines array', () => {
    const buffer = JSON.stringify([
      { candidates: [{ content: { parts: [{ text: 'Buffer form' }] } }] },
    ])
    expect(extractGeminiStreamText(buffer)).toBe('Buffer form')
  })
})
