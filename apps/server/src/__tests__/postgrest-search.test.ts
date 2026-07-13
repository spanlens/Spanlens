import { describe, expect, it } from 'vitest'
import { ilikeOrPattern } from '../lib/postgrest-search.js'

// 2026-07-13 audit: the traces search escaped only `%` and `,` — a search
// term containing `(` / `)` broke PostgREST's or() parser (500), and `_`
// acted as a LIKE single-char wildcard (wrong matches). ilikeOrPattern
// double-quotes the value (PostgREST quoting rules: `"` and `\` escaped with
// a backslash inside quotes) and LIKE-escapes `%`, `_`, `\`.

describe('ilikeOrPattern', () => {
  it('wraps a plain term in a quoted %...% pattern', () => {
    expect(ilikeOrPattern('checkout')).toBe('"%checkout%"')
  })

  it('leaves parentheses and commas literal inside the quoted value', () => {
    // Quoting is what makes these safe — PostgREST treats the whole quoted
    // string as one value, so ( ) , no longer terminate the or() clause.
    expect(ilikeOrPattern('fn(call)')).toBe('"%fn(call)%"')
    expect(ilikeOrPattern('a,b')).toBe('"%a,b%"')
  })

  it('escapes underscore so it matches literally instead of any-single-char', () => {
    // Value seen by PostgREST: %trace\\_a% → after quote-unescaping the SQL
    // pattern is %trace\_a%, i.e. a literal underscore.
    expect(ilikeOrPattern('trace_a')).toBe('"%trace\\\\_a%"')
  })

  it('escapes percent so it matches literally instead of any-substring', () => {
    expect(ilikeOrPattern('100%')).toBe('"%100\\\\%%"')
  })

  it('escapes double quotes per PostgREST quoted-value rules', () => {
    expect(ilikeOrPattern('say "hi"')).toBe('"%say \\"hi\\"%"')
  })

  it('escapes backslashes at both the LIKE and the quoting layer', () => {
    // Input a\b → LIKE-escaped a\\b → quote-escaped a\\\\b. PostgREST
    // unescapes to a\\b, and SQL LIKE unescapes to a literal a\b.
    expect(ilikeOrPattern('a\\b')).toBe('"%a\\\\\\\\b%"')
  })

  it('handles the full delimiter soup in one term', () => {
    expect(ilikeOrPattern('run(2), step_1')).toBe('"%run(2), step\\\\_1%"')
  })
})
