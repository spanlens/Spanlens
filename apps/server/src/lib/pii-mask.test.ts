import { describe, expect, test } from 'vitest'
import { maskApiKeys, maskApiKeysInBody } from './pii-mask.js'

describe('maskApiKeys — provider key patterns', () => {
  test('OpenAI sk- keys are masked', () => {
    const input = 'Authorization: Bearer sk-abc123DEF456ghi789jkl'
    expect(maskApiKeys(input)).toBe('Authorization: Bearer sk-***')
  })

  test('OpenAI sk-proj- keys keep the project prefix', () => {
    const input = 'token=sk-proj-abc123DEF456ghi789'
    expect(maskApiKeys(input)).toBe('token=sk-proj-***')
  })

  test('Anthropic sk-ant- keys keep the ant prefix', () => {
    const input = 'x-api-key: sk-ant-api03-abc123DEF456ghi'
    expect(maskApiKeys(input)).toBe('x-api-key: sk-ant-***')
  })

  test('Anthropic is matched before generic sk- (order matters)', () => {
    const input = 'sk-ant-aaaaaaaaaaaaaa some other text'
    // If the generic sk- pattern ran first or last and re-matched, we would
    // get sk-*** instead of sk-ant-***. This guards against that regression.
    expect(maskApiKeys(input)).toBe('sk-ant-*** some other text')
  })

  test('Gemini AIza keys keep the AIza prefix', () => {
    const input = '?key=AIzaSyABC123def456GHI789jkl'
    expect(maskApiKeys(input)).toBe('?key=AIza***')
  })

  test('Spanlens sl_live_ keys keep the sl_live_ prefix', () => {
    const input = 'header sl_live_abcDEF123ghi456JKL789'
    expect(maskApiKeys(input)).toBe('header sl_live_***')
  })

  test('multiple keys in one string are all masked', () => {
    const input = 'first sk-abc123def456ghi second sk-ant-xyz789xyz789xyz'
    expect(maskApiKeys(input)).toBe('first sk-*** second sk-ant-***')
  })

  test('passes through bodies with no keys unchanged', () => {
    const input = 'plain prompt text with no secrets in it'
    expect(maskApiKeys(input)).toBe(input)
  })

  test('does not false-positive on short identifiers sharing the prefix', () => {
    // "sk-abc" is only 6 chars after the prefix — below the 12-char minimum
    // we use to avoid masking arbitrary `sk-…` strings in prompts.
    expect(maskApiKeys('debug code sk-short id')).toBe('debug code sk-short id')
  })

  test('handles keys inside JSON payloads', () => {
    const json = JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: 'API key: sk-abc123DEF456ghi789jkl' }],
    })
    const masked = maskApiKeys(json)
    expect(masked).toContain('sk-***')
    expect(masked).not.toContain('sk-abc123')
  })
})

describe('maskApiKeysInBody — JSON serialization wrapper', () => {
  test('null/undefined return empty string', () => {
    expect(maskApiKeysInBody(null)).toBe('')
    expect(maskApiKeysInBody(undefined)).toBe('')
  })

  test('plain string bodies are masked without re-serialization', () => {
    expect(maskApiKeysInBody('hello sk-abc123DEF456ghi789jkl')).toBe('hello sk-***')
  })

  test('object bodies are JSON-stringified before masking', () => {
    const body = { auth: 'Bearer sk-ant-aaaaaaaaaaaaaaaa' }
    expect(maskApiKeysInBody(body)).toBe('{"auth":"Bearer sk-ant-***"}')
  })

  test('non-serializable bodies return a structured error string', () => {
    const circular: { self?: unknown } = {}
    circular.self = circular
    expect(maskApiKeysInBody(circular)).toBe('{"_error":"body not JSON-serializable"}')
  })
})
