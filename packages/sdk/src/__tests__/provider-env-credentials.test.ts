import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createAnthropic } from '../integrations/anthropic.js'
import { createOpenAI } from '../integrations/openai.js'

/**
 * @anthropic-ai/sdk falls back to ANTHROPIC_AUTH_TOKEN when `authToken` is
 * left undefined and sends it as `Authorization: Bearer` next to the
 * `x-api-key` Spanlens key. The Spanlens proxy reads Authorization first, so
 * the Anthropic token would reach Spanlens and the request would fail with
 * 401. createAnthropic() must pin `authToken` so only the Spanlens key is
 * sent. (openai only sends OPENAI_ADMIN_KEY on its admin endpoints, and the
 * test below guards that ordinary calls keep the Spanlens key.)
 */

const ENV_NAMES = ['SPANLENS_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_ADMIN_KEY', 'OPENAI_API_KEY'] as const
const SPANLENS_KEY = 'sl_live_test_key'

let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]))
  for (const name of ENV_NAMES) delete process.env[name]
  process.env['SPANLENS_API_KEY'] = SPANLENS_KEY
})

afterEach(() => {
  for (const name of ENV_NAMES) {
    const value = saved[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

/** A fetch that records the headers of the one request it answers. */
function recordingFetch(body: unknown) {
  const seen: Headers[] = []
  const fetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    seen.push(new Headers(init?.headers))
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return { fetch, seen }
}

const MESSAGE = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-test',
  content: [],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
}

describe('createAnthropic ignores provider credentials in the environment', () => {
  it('does not send ANTHROPIC_AUTH_TOKEN as an Authorization header', async () => {
    process.env['ANTHROPIC_AUTH_TOKEN'] = 'anthropic-oauth-token'
    const { fetch, seen } = recordingFetch(MESSAGE)
    const client = createAnthropic({ fetch, maxRetries: 0 })

    await client.messages.create({ model: 'claude-test', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] })

    expect(seen).toHaveLength(1)
    expect(seen[0]?.get('authorization')).toBeNull()
    expect(seen[0]?.get('x-api-key')).toBe(SPANLENS_KEY)
    expect(client.authToken).toBeNull()
  })

  it('still honours an authToken passed on purpose', () => {
    const client = createAnthropic({ authToken: 'explicit-token' })
    expect(client.authToken).toBe('explicit-token')
  })
})

describe('createOpenAI keeps the Spanlens key on ordinary calls', () => {
  it('does not let OPENAI_ADMIN_KEY replace the Spanlens key', async () => {
    process.env['OPENAI_ADMIN_KEY'] = 'sk-admin-test'
    const { fetch, seen } = recordingFetch({ object: 'list', data: [] })
    const client = createOpenAI({ fetch, maxRetries: 0 })

    await client.models.list()

    expect(seen).toHaveLength(1)
    expect(seen[0]?.get('authorization')).toBe(`Bearer ${SPANLENS_KEY}`)
  })
})
