import { describe, expect, test } from 'vitest'
import { cn, formatDate, formatDateTime, formatTime } from './utils.js'

/**
 * lib/utils.ts owns the en-US-pinned date formatters that defend the
 * dashboard against React #418 hydration mismatches (CLAUDE.md gotcha #22).
 * Any drift in the locale, options, or null handling re-opens that bug
 * across every page that renders timestamps. Tests pin the output shape.
 */

describe('cn — class merger', () => {
  test('joins truthy class names', () => {
    expect(cn('a', 'b')).toBe('a b')
  })

  test('drops falsy / undefined / null inputs', () => {
    expect(cn('a', undefined, null, false, '', 'b')).toBe('a b')
  })

  test('tailwind-merge collapses conflicting utilities (last wins)', () => {
    // text-sm and text-lg are mutually exclusive in tailwind — tailwind-merge
    // must pick the last one declared.
    expect(cn('text-sm', 'text-lg')).toBe('text-lg')
  })

  test('preserves non-conflicting classes through conflict resolution', () => {
    expect(cn('px-2 text-sm', 'text-lg')).toBe('px-2 text-lg')
  })
})

describe('formatDate — en-US locale lock', () => {
  test('null input renders the placeholder em-dash-substitute', () => {
    expect(formatDate(null)).toBe('—')
  })

  test('formats a known ISO timestamp as "Mon D, YYYY"', () => {
    // 2026-05-18 (May 18, 2026) — chose a non-ambiguous date so test fails
    // loudly if someone switches the locale to anything that swaps day/month.
    // We pick a noon-UTC time so any reasonable runner TZ still lands on
    // the 18th — defending the test from the same TZ flakiness that broke
    // earlier date-rendering attempts in /demo (gotcha #22 history).
    const out = formatDate('2026-05-18T12:00:00.000Z')
    expect(out).toBe('May 18, 2026')
  })

  test('output is locale-stable: no "5/18/2026" en-US numeric or "2026. 5. 18." ko-KR shape', () => {
    const out = formatDate('2026-05-18T12:00:00.000Z')
    expect(out).not.toMatch(/^\d+\/\d+\/\d+$/)
    expect(out).not.toContain('. ')
  })
})

describe('formatDateTime — en-US locale + 12h clock', () => {
  test('null input renders the em-dash', () => {
    expect(formatDateTime(null)).toBe('—')
  })

  test('output includes month, day, year, time, and AM/PM marker', () => {
    const out = formatDateTime('2026-05-18T15:24:00.000Z')
    expect(out).toContain('2026')
    expect(out).toContain('May')
    expect(out).toMatch(/\d{1,2}:\d{2}/)
    expect(out).toMatch(/AM|PM/)
  })
})

describe('formatTime — 24h en-US clock', () => {
  test('null input renders the em-dash', () => {
    expect(formatTime(null)).toBe('—')
  })

  test('output is HH:mm with no AM/PM (hour12 disabled)', () => {
    const out = formatTime('2026-05-18T15:24:00.000Z')
    expect(out).toMatch(/^\d{2}:\d{2}$/)
    expect(out).not.toMatch(/AM|PM/)
  })
})
