import { describe, expect, test } from 'vitest'
import { maskApiKeys, maskPii, maskPiiDeep } from './pii-mask.js'

/**
 * lib/pii-mask.ts is the client-side display masker for the /requests
 * drawer. The server (apps/server/src/lib/pii-mask.ts) handles the
 * authoritative key masking before persistence; this client copy gives
 * users an opt-in "mask PII in preview" toggle for emails/phones/cards
 * that the server intentionally never inspects.
 *
 * Pinning the patterns here so a regression in the regexes (the kind of
 * change that's easy to miss in review) breaks CI instead of silently
 * leaking secrets onto a customer's screen.
 */

describe('maskApiKeys', () => {
  test('masks Spanlens sl_live_ keys (full scope)', () => {
    const out = maskApiKeys('use key sl_live_abcdef0123456789 to call us')
    expect(out).toBe('use key sl_live_*** to call us')
  })

  test('masks Spanlens sl_live_pub_ keys via the sl_live_ pattern (CLAUDE.md scope note)', () => {
    // The CLAUDE.md note says "existing sl_live_ pattern automatically covers
    // sl_live_pub_*". Pin that here so anyone tightening the regex sees the
    // public-key case break first.
    const out = maskApiKeys('readonly sl_live_pub_xyzabc0123456789 here')
    expect(out).toContain('sl_live_***')
    expect(out).not.toContain('sl_live_pub_xyz')
  })

  test('masks Anthropic sk-ant-* keys', () => {
    const out = maskApiKeys('Authorization: Bearer sk-ant-api03-abcdef0123456789')
    expect(out).toBe('Authorization: Bearer sk-ant-***')
  })

  test('masks OpenAI sk-proj-* keys', () => {
    const out = maskApiKeys('OPENAI_API_KEY=sk-proj-abcdef0123456789xyz')
    expect(out).toContain('sk-proj-***')
  })

  test('masks generic OpenAI sk-* keys', () => {
    const out = maskApiKeys('key sk-abcdef0123456789xyz')
    expect(out).toContain('sk-***')
  })

  test('masks Google AIza-prefixed keys', () => {
    const out = maskApiKeys('GEMINI_API_KEY=AIzaSyAbcdef0123456789xyz')
    expect(out).toContain('AIza***')
  })

  test('does NOT touch innocuous strings that happen to start with a key prefix but are too short', () => {
    // KEY_MIN = 12 — a prefix alone or with <12 trailing chars stays intact
    expect(maskApiKeys('sk-short')).toBe('sk-short')
  })

  test('leaves non-key content untouched', () => {
    const input = 'hello world, no keys here, just prose'
    expect(maskApiKeys(input)).toBe(input)
  })
})

describe('maskPii — email/phone/card patterns', () => {
  test('masks emails preserving 2-char prefix + obscured local + domain head', () => {
    expect(maskPii('contact user@example.com today')).toContain('us***@***.com')
  })

  test('masks 10+ digit phone numbers (NANP with separators)', () => {
    const out = maskPii('call +1 (555) 123-4567 please')
    // 10+ digits trigger the mask; the inner digits should be hidden
    expect(out).not.toContain('5551234567')
    expect(out).not.toContain('123-4567')
    expect(out).toMatch(/\*\*\*/)
  })

  test('masks credit-card-shaped 16-digit runs (with separators)', () => {
    const out = maskPii('paid with 4111-1111-1111-1111 yesterday')
    expect(out).not.toContain('1111-1111-1111-1111')
    expect(out).toContain('4111')
    expect(out).toContain('1111') // last 4 preserved
    expect(out).toContain('****')
  })

  test('layers maskApiKeys on top — an email AND an API key both get masked', () => {
    const out = maskPii('contact ops@spanlens.io with key sl_live_abcdef0123456789')
    expect(out).toContain('op***@***.io')
    expect(out).toContain('sl_live_***')
  })

  test('innocuous text passes through unchanged', () => {
    const input = 'The quick brown fox jumps over the lazy dog.'
    expect(maskPii(input)).toBe(input)
  })
})

describe('maskPiiDeep — recursive object walking', () => {
  test('masks strings nested inside arrays', () => {
    const out = maskPiiDeep(['hello', 'sl_live_abcdef0123456789', { nested: 'sk-abcdef0123456789' }])
    expect(out[0]).toBe('hello')
    expect(out[1]).toBe('sl_live_***')
    expect((out[2] as { nested: string }).nested).toBe('sk-***')
  })

  test('masks strings nested in objects (used for OpenAI message arrays)', () => {
    const input = {
      messages: [
        { role: 'user', content: 'My email is alice@example.com' },
        { role: 'assistant', content: 'Got it.' },
      ],
      apiKey: 'sl_live_abcdef0123456789',
    }
    const out = maskPiiDeep(input)
    expect(out.messages[0]!.content).toContain('***@***.com')
    expect(out.messages[1]!.content).toBe('Got it.')
    expect(out.apiKey).toBe('sl_live_***')
  })

  test('non-string leaves (numbers, booleans, null) pass through unchanged', () => {
    const input = { count: 42, ok: true, missing: null, ratio: 0.5 }
    expect(maskPiiDeep(input)).toEqual(input)
  })

  test('preserves object key names (only values are scanned)', () => {
    const out = maskPiiDeep({ sk_proj_abcdef0123456789: 'value' })
    expect(Object.keys(out)).toEqual(['sk_proj_abcdef0123456789'])
  })
})
