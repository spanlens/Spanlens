import { describe, it, expect } from 'vitest'
import {
  withCache as withCacheOpenAI,
  withUser as withUserOpenAI,
  CACHE_HEADER as OPENAI_CACHE_HEADER,
  CACHE_DEFAULT_TTL_SECONDS as OPENAI_CACHE_DEFAULT_TTL,
  CACHE_MAX_TTL_SECONDS as OPENAI_CACHE_MAX_TTL,
} from '../integrations/openai.js'
import {
  withCache as withCacheAnthropic,
  CACHE_HEADER as ANTHROPIC_CACHE_HEADER,
  CACHE_MAX_TTL_SECONDS as ANTHROPIC_CACHE_MAX_TTL,
} from '../integrations/anthropic.js'

describe('withCache', () => {
  it('openai helper defaults to x-spanlens-cache: true', () => {
    expect(withCacheOpenAI()).toEqual({
      headers: { 'x-spanlens-cache': 'true' },
    })
    expect(withCacheOpenAI(true)).toEqual({
      headers: { 'x-spanlens-cache': 'true' },
    })
  })

  it('anthropic helper has identical shape', () => {
    expect(withCacheAnthropic()).toEqual({
      headers: { 'x-spanlens-cache': 'true' },
    })
  })

  it('emits an integer TTL in seconds', () => {
    expect(withCacheOpenAI(600)).toEqual({
      headers: { 'x-spanlens-cache': '600' },
    })
    expect(withCacheOpenAI(3600).headers['x-spanlens-cache']).toBe('3600')
  })

  it('clamps a TTL above the cap to the max (24h)', () => {
    expect(withCacheOpenAI(999_999).headers[OPENAI_CACHE_HEADER]).toBe(
      String(OPENAI_CACHE_MAX_TTL),
    )
    expect(withCacheAnthropic(999_999).headers[ANTHROPIC_CACHE_HEADER]).toBe(
      String(ANTHROPIC_CACHE_MAX_TTL),
    )
  })

  it('accepts exactly the cap without clamping past it', () => {
    expect(withCacheOpenAI(86400).headers['x-spanlens-cache']).toBe('86400')
  })

  it('emits no header for invalid values (fail-safe, matches server)', () => {
    // zero, negative, non-integer, NaN, Infinity — all "no caching"
    expect(withCacheOpenAI(0)).toEqual({ headers: {} })
    expect(withCacheOpenAI(-10)).toEqual({ headers: {} })
    expect(withCacheOpenAI(1.5)).toEqual({ headers: {} })
    expect(withCacheOpenAI(Number.NaN)).toEqual({ headers: {} })
    expect(withCacheOpenAI(Number.POSITIVE_INFINITY)).toEqual({ headers: {} })
  })

  it('header + default TTL constants are stable across both integrations', () => {
    expect(OPENAI_CACHE_HEADER).toBe('x-spanlens-cache')
    expect(ANTHROPIC_CACHE_HEADER).toBe('x-spanlens-cache')
    expect(OPENAI_CACHE_DEFAULT_TTL).toBe(3600)
    expect(OPENAI_CACHE_MAX_TTL).toBe(86400)
    expect(ANTHROPIC_CACHE_MAX_TTL).toBe(86400)
  })

  it('merges with other helpers via header spread', () => {
    const merged = {
      headers: {
        ...withCacheOpenAI(600).headers,
        ...withUserOpenAI('u1').headers,
      },
    }
    expect(merged.headers).toEqual({
      'x-spanlens-cache': '600',
      'x-spanlens-user': 'u1',
    })
  })
})
