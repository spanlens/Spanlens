import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { logError, logWarn } from './structured-logger.js'

/**
 * Locks the structured-logger contract:
 *   1. Output line starts with LEVEL[CODE] for grep-ability.
 *   2. JSON payload contains the context fields verbatim.
 *   3. String values pass through maskApiKeys (no plaintext sl_live_* or
 *      sk-* in logs that get indexed by Sentry).
 *   4. Error instances are serialized as {name, message, stack}.
 */

let consoleErrorSpy: ReturnType<typeof vi.spyOn>
let consoleWarnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
  consoleWarnSpy.mockRestore()
})

function lastErrorLine(): string {
  expect(consoleErrorSpy).toHaveBeenCalled()
  return consoleErrorSpy.mock.calls.at(-1)![0] as string
}

function lastErrorPayload(): Record<string, unknown> {
  const line = lastErrorLine()
  // Format: `ERROR[CODE] {json}` — split on the first " {"
  const jsonStart = line.indexOf(' {')
  return JSON.parse(line.slice(jsonStart + 1)) as Record<string, unknown>
}

describe('logError — output shape', () => {
  test('starts with ERROR[CODE] prefix for grep', () => {
    logError('CH_INSERT_FAILED', { orgId: 'org_1' })
    expect(lastErrorLine()).toMatch(/^ERROR\[CH_INSERT_FAILED\] \{/)
  })

  test('payload contains level + code + ts + context fields', () => {
    logError('CRON_JOB_FAILED', { jobName: 'aggregate-usage', orgId: 'org_2' })
    const p = lastErrorPayload()
    expect(p['level']).toBe('ERROR')
    expect(p['code']).toBe('CRON_JOB_FAILED')
    expect(p['jobName']).toBe('aggregate-usage')
    expect(p['orgId']).toBe('org_2')
    expect(typeof p['ts']).toBe('string')
  })
})

describe('logError — PII masking', () => {
  test('sl_live_* API keys in context strings are masked', () => {
    logError('UPSTREAM_FETCH_FAILED', {
      orgId: 'org_1',
      hint: 'used key sl_live_abcdef0123456789 to call upstream',
    })
    const line = lastErrorLine()
    expect(line).not.toContain('sl_live_abcdef0123456789')
    expect(line).toContain('sl_live_***')
  })

  test('sk-ant-* keys are masked', () => {
    logError('UNCATEGORIZED', { hint: 'sk-ant-api03-abcdef0123456789' })
    expect(lastErrorLine()).toContain('sk-ant-***')
    expect(lastErrorLine()).not.toContain('sk-ant-api03-abcdef')
  })

  test('keys nested in arrays/objects are masked', () => {
    logError('UNCATEGORIZED', {
      messages: [
        { role: 'system', content: 'sl_live_abcdef0123456789' },
      ],
    })
    expect(lastErrorLine()).not.toContain('sl_live_abcdef0123456789')
    expect(lastErrorLine()).toContain('sl_live_***')
  })

  test('non-string values pass through untouched', () => {
    logError('UNCATEGORIZED', {
      count: 42,
      flag: true,
      nullable: null,
    })
    const p = lastErrorPayload()
    expect(p['count']).toBe(42)
    expect(p['flag']).toBe(true)
    expect(p['nullable']).toBeNull()
  })
})

describe('logError — Error serialization', () => {
  test('Error instance serialized as {name, message, stack}', () => {
    const err = new TypeError('boom')
    logError('UPSTREAM_FETCH_FAILED', { provider: 'openai' }, err)
    const p = lastErrorPayload()
    const errPayload = p['err'] as { name: string; message: string; stack: string }
    expect(errPayload.name).toBe('TypeError')
    expect(errPayload.message).toBe('boom')
    expect(typeof errPayload.stack).toBe('string')
  })

  test('Error message itself is PII-masked', () => {
    const err = new Error('failed with key sl_live_abcdef0123456789')
    logError('UPSTREAM_FETCH_FAILED', {}, err)
    const p = lastErrorPayload()
    expect((p['err'] as { message: string }).message).toContain('sl_live_***')
  })

  test('string error becomes { message }', () => {
    logError('UNCATEGORIZED', {}, 'string error path')
    const p = lastErrorPayload()
    expect((p['err'] as { message: string }).message).toBe('string error path')
  })
})

describe('logWarn — same shape, lower severity', () => {
  test('uses console.warn and WARN[CODE] prefix', () => {
    logWarn('CRON_PARTIAL_FAILURE', { jobName: 'replay-fallback', count: 3 })
    expect(consoleErrorSpy).not.toHaveBeenCalled()
    expect(consoleWarnSpy).toHaveBeenCalled()
    const line = consoleWarnSpy.mock.calls.at(-1)![0] as string
    expect(line).toMatch(/^WARN\[CRON_PARTIAL_FAILURE\] \{/)
  })
})
