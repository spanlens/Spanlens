import { describe, it, expect } from 'vitest'
import { normalizeAzureResourceUrl } from '../api/providerKeys.js'

describe('normalizeAzureResourceUrl', () => {
  describe('accepts and normalizes', () => {
    it('strips trailing slash', () => {
      const r = normalizeAzureResourceUrl('https://my-res.openai.azure.com/')
      expect(r).toEqual({ ok: true, url: 'https://my-res.openai.azure.com' })
    })

    it('preserves canonical origin without trailing slash', () => {
      const r = normalizeAzureResourceUrl('https://my-res.openai.azure.com')
      expect(r).toEqual({ ok: true, url: 'https://my-res.openai.azure.com' })
    })

    it('accepts the Foundry alternate domain (services.ai.azure.com)', () => {
      const r = normalizeAzureResourceUrl('https://my-res.services.ai.azure.com')
      expect(r).toEqual({ ok: true, url: 'https://my-res.services.ai.azure.com' })
    })

    it('lowercases the host', () => {
      // URL parser already lowercases the hostname — this just confirms behavior.
      const r = normalizeAzureResourceUrl('https://My-Resource.OpenAI.Azure.com')
      expect(r).toEqual({ ok: true, url: 'https://my-resource.openai.azure.com' })
    })

    it('strips paths/queries — only origin is kept', () => {
      const r = normalizeAzureResourceUrl(
        'https://my-res.openai.azure.com/openai/v1/?foo=bar',
      )
      expect(r).toEqual({ ok: true, url: 'https://my-res.openai.azure.com' })
    })

    it('trims surrounding whitespace', () => {
      const r = normalizeAzureResourceUrl('  https://my-res.openai.azure.com  ')
      expect(r).toEqual({ ok: true, url: 'https://my-res.openai.azure.com' })
    })
  })

  describe('rejects', () => {
    it('non-URL input', () => {
      const r = normalizeAzureResourceUrl('my-resource')
      expect(r.ok).toBe(false)
    })

    it('http (not https)', () => {
      const r = normalizeAzureResourceUrl('http://my-res.openai.azure.com')
      expect(r).toMatchObject({ ok: false })
      if (!r.ok) expect(r.error).toMatch(/https/i)
    })

    it('arbitrary domain (host hijack prevention)', () => {
      const r = normalizeAzureResourceUrl('https://evil.example.com')
      expect(r).toMatchObject({ ok: false })
      // Use substring matchers (not regex) — CodeQL's "missing regex anchor"
      // rule fires when an unanchored alternation could be confused with URL
      // validation. This is an error-message assertion, but toContain is
      // strictly clearer anyway.
      if (!r.ok) {
        expect(r.error).toContain('.openai.azure.com')
        expect(r.error).toContain('.services.ai.azure.com')
      }
    })

    it('domain that contains azure.com but is not an Azure host', () => {
      // `.azure.com` alone is not enough — the suffix has to be one of the
      // two recognized families. Prevents lookalike domains like
      // `myco-openai.azure.com.evil.org` from being accepted (URL parser
      // would identify the actual host as `evil.org`, but defense-in-depth).
      const r = normalizeAzureResourceUrl('https://something.azure.com')
      expect(r).toMatchObject({ ok: false })
    })

    it('empty string', () => {
      const r = normalizeAzureResourceUrl('')
      expect(r.ok).toBe(false)
    })
  })
})
