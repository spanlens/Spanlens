import { describe, it, expect } from 'vitest'
import {
  withPromptVersion as withPromptVersionOpenAI,
  PROMPT_VERSION_HEADER as OPENAI_HEADER,
} from '../integrations/openai.js'
import {
  withPromptVersion as withPromptVersionAnthropic,
  PROMPT_VERSION_HEADER as ANTHROPIC_HEADER,
} from '../integrations/anthropic.js'

describe('withPromptVersion', () => {
  it('openai helper returns RequestOptions with the tagging header', () => {
    const opts = withPromptVersionOpenAI('chatbot-system@3')
    expect(opts).toEqual({
      headers: { 'x-spanlens-prompt-version': 'chatbot-system@3' },
    })
  })

  it('anthropic helper returns the same shape', () => {
    const opts = withPromptVersionAnthropic('greeter@latest')
    expect(opts).toEqual({
      headers: { 'x-spanlens-prompt-version': 'greeter@latest' },
    })
  })

  it('exported header constant is stable across modules', () => {
    expect(OPENAI_HEADER).toBe('x-spanlens-prompt-version')
    expect(ANTHROPIC_HEADER).toBe('x-spanlens-prompt-version')
  })

  it('accepts a raw UUID', () => {
    const uuid = 'ae1c3c1e-99eb-2b98-5f05-012345678901'
    expect(withPromptVersionOpenAI(uuid).headers[OPENAI_HEADER]).toBe(uuid)
  })
})
