import { describe, it, expect } from 'vitest'
import * as headers from '../integrations/_headers.js'
import * as openai from '../integrations/openai.js'
import * as anthropic from '../integrations/anthropic.js'
import * as gemini from '../integrations/gemini.js'
import * as groq from '../integrations/groq.js'
import * as deepseek from '../integrations/deepseek.js'
import * as xai from '../integrations/xai.js'
import * as cohere from '../integrations/cohere.js'
import * as ollama from '../integrations/ollama.js'
import * as mistral from '../integrations/mistral.js'
import * as openrouter from '../integrations/openrouter.js'

/**
 * Every proxy integration subpath must re-export the X-Spanlens-* header
 * helpers from the canonical ./_headers.ts module, so users get single-import
 * ergonomics regardless of provider:
 *
 *   import { createGroq, withUser } from '@spanlens/sdk/groq'
 *
 * These tests pin (a) presence on every subpath and (b) reference identity
 * with the canonical implementation — a re-export, not a copy.
 */

const HELPER_NAMES = [
  'withPromptVersion',
  'withUser',
  'withSession',
  'withLogBody',
  'withCache',
  'cacheHeaderValue',
] as const

const HEADER_CONSTANTS = [
  'PROMPT_VERSION_HEADER',
  'USER_HEADER',
  'SESSION_HEADER',
  'LOG_BODY_HEADER',
  'CACHE_HEADER',
  'CACHE_DEFAULT_TTL_SECONDS',
  'CACHE_MAX_TTL_SECONDS',
] as const

const MODULES = [
  { name: 'openai', mod: openai },
  { name: 'anthropic', mod: anthropic },
  { name: 'gemini', mod: gemini },
  { name: 'groq', mod: groq },
  { name: 'deepseek', mod: deepseek },
  { name: 'xai', mod: xai },
  { name: 'cohere', mod: cohere },
  { name: 'ollama', mod: ollama },
  { name: 'mistral', mod: mistral },
  { name: 'openrouter', mod: openrouter },
] as const

describe('X-Spanlens-* header helper parity across integrations', () => {
  for (const { name, mod } of MODULES) {
    describe(`@spanlens/sdk/${name}`, () => {
      it('re-exports the canonical helper functions (same reference, no copies)', () => {
        for (const helper of HELPER_NAMES) {
          const exported = (mod as Record<string, unknown>)[helper]
          expect(exported, `${name} is missing ${helper}`).toBeTypeOf('function')
          expect(exported, `${name}.${helper} is a copy, not a re-export`).toBe(
            headers[helper],
          )
        }
      })

      it('re-exports the header-name constants', () => {
        for (const constant of HEADER_CONSTANTS) {
          expect(
            (mod as Record<string, unknown>)[constant],
            `${name} is missing ${constant}`,
          ).toBe(headers[constant])
        }
      })
    })
  }

  it('helpers emit the documented x-spanlens-* headers', () => {
    expect(headers.withPromptVersion('greeter@latest')).toEqual({
      headers: { 'x-spanlens-prompt-version': 'greeter@latest' },
    })
    expect(headers.withUser('u1')).toEqual({
      headers: { 'x-spanlens-user': 'u1' },
    })
    expect(headers.withSession('s1')).toEqual({
      headers: { 'x-spanlens-session': 's1' },
    })
    expect(headers.withLogBody('meta')).toEqual({
      headers: { 'x-spanlens-log-body': 'meta' },
    })
    expect(headers.withCache(600)).toEqual({
      headers: { 'x-spanlens-cache': '600' },
    })
  })
})
