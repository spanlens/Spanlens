import { describe, it, expect } from 'vitest'
import {
  withUser as withUserOpenAI,
  withSession as withSessionOpenAI,
  USER_HEADER as OPENAI_USER_HEADER,
  SESSION_HEADER as OPENAI_SESSION_HEADER,
} from '../integrations/openai.js'
import {
  withUser as withUserAnthropic,
  withSession as withSessionAnthropic,
  USER_HEADER as ANTHROPIC_USER_HEADER,
  SESSION_HEADER as ANTHROPIC_SESSION_HEADER,
} from '../integrations/anthropic.js'

describe('withUser', () => {
  it('openai helper sets x-spanlens-user', () => {
    expect(withUserOpenAI('user_42')).toEqual({
      headers: { 'x-spanlens-user': 'user_42' },
    })
  })

  it('anthropic helper has identical shape', () => {
    expect(withUserAnthropic('user_42')).toEqual({
      headers: { 'x-spanlens-user': 'user_42' },
    })
  })

  it('header constants are stable across both integrations', () => {
    expect(OPENAI_USER_HEADER).toBe('x-spanlens-user')
    expect(ANTHROPIC_USER_HEADER).toBe('x-spanlens-user')
  })
})

describe('withSession', () => {
  it('openai helper sets x-spanlens-session', () => {
    expect(withSessionOpenAI('sess_abc')).toEqual({
      headers: { 'x-spanlens-session': 'sess_abc' },
    })
  })

  it('anthropic helper has identical shape', () => {
    expect(withSessionAnthropic('sess_abc')).toEqual({
      headers: { 'x-spanlens-session': 'sess_abc' },
    })
  })

  it('header constants are stable across both integrations', () => {
    expect(OPENAI_SESSION_HEADER).toBe('x-spanlens-session')
    expect(ANTHROPIC_SESSION_HEADER).toBe('x-spanlens-session')
  })
})

describe('helpers can be merged', () => {
  it('combining withUser + withSession headers via spread works', () => {
    const merged = {
      headers: {
        ...withUserOpenAI('u1').headers,
        ...withSessionOpenAI('s1').headers,
      },
    }
    expect(merged.headers).toEqual({
      'x-spanlens-user': 'u1',
      'x-spanlens-session': 's1',
    })
  })
})
