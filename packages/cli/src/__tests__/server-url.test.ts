import { describe, it, expect } from 'vitest'
import { normalizeServerUrl, proxyEndpoints } from '../server-url.js'
import { parseFlags } from '../flags.js'

describe('normalizeServerUrl', () => {
  it('keeps a bare origin', () => {
    expect(normalizeServerUrl('https://spanlens.example.com')).toEqual({
      ok: true,
      origin: 'https://spanlens.example.com',
      droppedPath: null,
    })
  })

  it('strips every trailing slash', () => {
    const r = normalizeServerUrl('https://spanlens.example.com///')
    expect(r).toEqual({ ok: true, origin: 'https://spanlens.example.com', droppedPath: null })
  })

  it('reduces a pasted proxy URL to the server origin and reports the dropped path', () => {
    const r = normalizeServerUrl('https://spanlens.example.com/proxy/openai/v1/')
    expect(r).toEqual({
      ok: true,
      origin: 'https://spanlens.example.com',
      droppedPath: '/proxy/openai/v1/',
    })
  })

  it('keeps a non-default port and lowercases the host', () => {
    const r = normalizeServerUrl('  http://LOCALHOST:3001/ ')
    expect(r).toEqual({ ok: true, origin: 'http://localhost:3001', droppedPath: null })
  })

  it('rejects values without an http(s) scheme', () => {
    expect(normalizeServerUrl('spanlens.example.com').ok).toBe(false)
    expect(normalizeServerUrl('ftp://spanlens.example.com').ok).toBe(false)
  })

  it('rejects credentials in the URL', () => {
    expect(normalizeServerUrl('https://user:pass@spanlens.example.com').ok).toBe(false)
  })

  it('rejects an empty value', () => {
    expect(normalizeServerUrl('   ').ok).toBe(false)
  })
})

describe('proxyEndpoints', () => {
  it('builds the per-provider proxy address the SDK factories call', () => {
    expect(proxyEndpoints('https://s.example.com', ['openai', 'anthropic', 'gemini'])).toEqual([
      { provider: 'openai', url: 'https://s.example.com/proxy/openai/v1' },
      { provider: 'anthropic', url: 'https://s.example.com/proxy/anthropic' },
      { provider: 'gemini', url: 'https://s.example.com/proxy/gemini' },
    ])
  })
})

describe('parseFlags', () => {
  const argv = (...args: string[]): string[] => ['node', 'spanlens', ...args]

  it('defaults to init against the hosted service', () => {
    expect(parseFlags(argv())).toEqual({ subcommand: 'init', dryRun: false, serverUrl: null, droppedPath: null })
  })

  it('accepts --server-url <url> and normalizes it to an origin', () => {
    const flags = parseFlags(argv('init', '--server-url', 'https://s.example.com/'))
    expect(flags).toMatchObject({ serverUrl: 'https://s.example.com', droppedPath: null })
  })

  it('accepts --server-url=<url>', () => {
    const flags = parseFlags(argv('init', '--server-url=https://s.example.com/proxy/openai/v1'))
    expect(flags).toMatchObject({ serverUrl: 'https://s.example.com', droppedPath: '/proxy/openai/v1' })
  })

  it('does not swallow the next flag as the URL', () => {
    const flags = parseFlags(argv('init', '--server-url', '--dry-run'))
    expect(flags).toMatchObject({ error: expect.stringContaining('--server-url') })
  })

  it('reports a missing value instead of silently using the hosted service', () => {
    const flags = parseFlags(argv('init', '--server-url'))
    expect(flags).toMatchObject({ error: expect.stringContaining('--server-url') })
  })

  it('reports an invalid URL', () => {
    const flags = parseFlags(argv('init', '--server-url', 'spanlens.example.com'))
    expect(flags).toMatchObject({ error: expect.stringContaining('http') })
  })

  it('reads --dry-run', () => {
    expect(parseFlags(argv('init', '--dry-run'))).toMatchObject({ dryRun: true })
  })
})
