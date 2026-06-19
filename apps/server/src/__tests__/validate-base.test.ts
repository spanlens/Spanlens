import { describe, it, expect, afterEach } from 'vitest'
import { assertSafeProxyBase } from '../proxy/shared/validate-base.js'

// SSRF guard for operator-supplied *_API_BASE overrides. Enforced only in
// production (the https-only check would reject the dev/E2E http://localhost
// mock). Defaults are trusted constants and never validated.
describe('assertSafeProxyBase', () => {
  const ORIGINAL_ENV = { ...process.env }

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('is a no-op outside production even for an internal target', () => {
    process.env['NODE_ENV'] = 'test'
    process.env['OPENAI_API_BASE'] = 'http://169.254.169.254'
    expect(() =>
      assertSafeProxyBase('OPENAI_API_BASE', 'http://169.254.169.254'),
    ).not.toThrow()
  })

  it('is a no-op in production when the override env var is unset', () => {
    process.env['NODE_ENV'] = 'production'
    delete process.env['OPENAI_API_BASE']
    expect(() =>
      assertSafeProxyBase('OPENAI_API_BASE', 'https://api.openai.com'),
    ).not.toThrow()
  })

  it('throws in production when the override targets an internal IP', () => {
    process.env['NODE_ENV'] = 'production'
    process.env['OPENAI_API_BASE'] = 'https://169.254.169.254'
    expect(() =>
      assertSafeProxyBase('OPENAI_API_BASE', 'https://169.254.169.254'),
    ).toThrow(/SSRF/)
  })

  it('throws in production when the override is non-https', () => {
    process.env['NODE_ENV'] = 'production'
    process.env['MISTRAL_API_BASE'] = 'http://evil.example.com'
    expect(() =>
      assertSafeProxyBase('MISTRAL_API_BASE', 'http://evil.example.com'),
    ).toThrow()
  })

  it('passes in production for a legitimate https override', () => {
    process.env['NODE_ENV'] = 'production'
    process.env['OPENROUTER_API_BASE'] = 'https://openrouter.ai/api'
    expect(() =>
      assertSafeProxyBase('OPENROUTER_API_BASE', 'https://openrouter.ai/api'),
    ).not.toThrow()
  })
})
