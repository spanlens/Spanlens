import { describe, it, expect } from 'vitest'
import {
  withLogBody as withLogBodyOpenAI,
  withUser as withUserOpenAI,
  LOG_BODY_HEADER as OPENAI_LOG_BODY_HEADER,
} from '../integrations/openai.js'
import {
  withLogBody as withLogBodyAnthropic,
  LOG_BODY_HEADER as ANTHROPIC_LOG_BODY_HEADER,
} from '../integrations/anthropic.js'

describe('withLogBody', () => {
  it('openai helper emits x-spanlens-log-body header', () => {
    expect(withLogBodyOpenAI('meta')).toEqual({
      headers: { 'x-spanlens-log-body': 'meta' },
    })
  })

  it('anthropic helper has identical shape', () => {
    expect(withLogBodyAnthropic('none')).toEqual({
      headers: { 'x-spanlens-log-body': 'none' },
    })
  })

  it('accepts all three modes', () => {
    expect(withLogBodyOpenAI('full').headers['x-spanlens-log-body']).toBe('full')
    expect(withLogBodyOpenAI('meta').headers['x-spanlens-log-body']).toBe('meta')
    expect(withLogBodyOpenAI('none').headers['x-spanlens-log-body']).toBe('none')
  })

  it('header constant is stable across both integrations', () => {
    expect(OPENAI_LOG_BODY_HEADER).toBe('x-spanlens-log-body')
    expect(ANTHROPIC_LOG_BODY_HEADER).toBe('x-spanlens-log-body')
  })

  it('merges with other helpers via header spread', () => {
    const merged = {
      headers: {
        ...withLogBodyOpenAI('meta').headers,
        ...withUserOpenAI('u1').headers,
      },
    }
    expect(merged.headers).toEqual({
      'x-spanlens-log-body': 'meta',
      'x-spanlens-user': 'u1',
    })
  })
})
