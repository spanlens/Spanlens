import { describe, it, expect } from 'vitest'
import { buildNextSteps } from '../next-steps.js'

describe('buildNextSteps', () => {
  it('points hosted users at the hosted dashboard', () => {
    const text = buildNextSteps({
      serverOrigin: null,
      dashboardUrl: 'https://www.spanlens.io',
      providers: ['openai'],
    }).join('\n')
    expect(text).toContain('SPANLENS_API_KEY')
    expect(text).not.toContain('SPANLENS_BASE_URL')
    expect(text).toContain('https://www.spanlens.io/requests')
  })

  it('tells self-hosted users the exact addresses their requests go to', () => {
    const text = buildNextSteps({
      serverOrigin: 'https://spanlens.example.com',
      dashboardUrl: 'https://spanlens.example.com',
      providers: ['openai', 'anthropic'],
    }).join('\n')
    expect(text).toContain('SPANLENS_BASE_URL=https://spanlens.example.com')
    expect(text).toContain('https://spanlens.example.com/proxy/openai/v1')
    expect(text).toContain('https://spanlens.example.com/proxy/anthropic')
    expect(text).not.toContain('/proxy/gemini')
    expect(text).not.toContain('api.spanlens.io')
    expect(text).not.toContain(String.fromCharCode(0x2014))
  })
})
