import { describe, expect, test } from 'vitest'
import { runJsonSchema, runRegex } from '../lib/eval-runner.js'

/**
 * R-7 Phase 1: pure functions for the two deterministic evaluator types.
 * No DB / network — these tests pin the per-sample scoring contract:
 *
 *   - score is exactly 0 or 1 (not 0.5, not "true")
 *   - value_boolean mirrors the score
 *   - reasoning carries actionable detail (pattern / Ajv message / parse
 *     error), never just "failed" — the operator needs to know whether
 *     the prompt regressed or the schema is wrong
 */

describe('runRegex', () => {
  test('match: simple literal pattern', () => {
    const r = runRegex({ pattern: 'hello' }, 'hello world')
    expect(r.score).toBe(1)
    expect(r.value_boolean).toBe(true)
    expect(r.reasoning).toContain('regex matched')
    expect(r.reasoning).toContain('hello')
  })

  test('no match: pattern absent from output', () => {
    const r = runRegex({ pattern: 'xyz' }, 'hello world')
    expect(r.score).toBe(0)
    expect(r.value_boolean).toBe(false)
    expect(r.reasoning).toContain('no match')
    expect(r.reasoning).toContain('xyz')
  })

  test('invalid pattern throws SyntaxError (caller writes failing sample)', () => {
    // Unbalanced parens — the runEvalRun wrapper catches this and
    // surfaces it as a failing sample with the syntax error in
    // reasoning. The pure function itself must throw so the wrapper
    // can distinguish "the pattern is broken" from "no match."
    expect(() => runRegex({ pattern: '[unclosed' }, 'irrelevant')).toThrow()
  })

  test('flags: case-insensitive match', () => {
    const r = runRegex({ pattern: 'HELLO', flags: 'i' }, 'hello world')
    expect(r.score).toBe(1)
    expect(r.value_boolean).toBe(true)
  })

  test('flags: multiline anchor', () => {
    // Without /m the `^line2` anchor would need to be at the very start.
    const r = runRegex({ pattern: '^line2', flags: 'm' }, 'line1\nline2\nline3')
    expect(r.score).toBe(1)
  })
})

describe('runJsonSchema', () => {
  test('valid: matches a simple object schema', () => {
    const r = runJsonSchema(
      { schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
      JSON.stringify({ name: 'Alice' }),
    )
    expect(r.score).toBe(1)
    expect(r.value_boolean).toBe(true)
    expect(r.reasoning).toBe('valid')
  })

  test('invalid: missing required property', () => {
    const r = runJsonSchema(
      { schema: { type: 'object', required: ['name'] } },
      JSON.stringify({ age: 30 }),
    )
    expect(r.score).toBe(0)
    expect(r.value_boolean).toBe(false)
    // Ajv's default error text mentions the missing property.
    expect(r.reasoning).toContain('name')
  })

  test('invalid: wrong type', () => {
    const r = runJsonSchema(
      { schema: { type: 'object', properties: { count: { type: 'number' } }, required: ['count'] } },
      JSON.stringify({ count: 'not-a-number' }),
    )
    expect(r.score).toBe(0)
    // Ajv error mentions the type mismatch.
    expect(r.reasoning).toMatch(/number|type/)
  })

  test('parse error: response is not JSON', () => {
    const r = runJsonSchema(
      { schema: { type: 'object' } },
      'this is not json',
    )
    expect(r.score).toBe(0)
    expect(r.value_boolean).toBe(false)
    expect(r.reasoning).toContain('not JSON')
  })

  test('nested oneOf: one branch matches', () => {
    const r = runJsonSchema(
      {
        schema: {
          oneOf: [
            { type: 'object', properties: { kind: { const: 'a' } }, required: ['kind'] },
            { type: 'object', properties: { kind: { const: 'b' } }, required: ['kind'] },
          ],
        },
      },
      JSON.stringify({ kind: 'b' }),
    )
    expect(r.score).toBe(1)
    expect(r.value_boolean).toBe(true)
  })
})
