import { describe, expect, it } from 'vitest'
import { truncateMiddle, MAX_RESPONSE_CHARS } from '../lib/eval-runners/shared.js'

describe('truncateMiddle', () => {
  it('returns text unchanged when within the cap', () => {
    const short = 'hello world'
    expect(truncateMiddle(short, 100)).toBe(short)
    expect(truncateMiddle(short, short.length)).toBe(short)
  })

  it('never exceeds the cap', () => {
    const long = 'x'.repeat(10_000)
    expect(truncateMiddle(long, 1000).length).toBeLessThanOrEqual(1000)
  })

  it('preserves BOTH the head and the tail (the conclusion is often at the end)', () => {
    const head = 'HEAD'.repeat(500) // 2000 chars
    const tail = 'TAIL'.repeat(500) // 2000 chars
    const out = truncateMiddle(head + tail, 1000)
    expect(out.startsWith('HEAD')).toBe(true)
    expect(out.endsWith('TAIL')).toBe(true)
    expect(out).toContain('truncated middle')
  })

  it('keeps more of the head than the tail (~60/40 split)', () => {
    const text = 'a'.repeat(5000) + 'b'.repeat(5000)
    const out = truncateMiddle(text, 1000)
    const aCount = (out.match(/a/g) ?? []).length
    const bCount = (out.match(/b/g) ?? []).length
    expect(aCount).toBeGreaterThan(bCount)
  })

  it('defaults to MAX_RESPONSE_CHARS', () => {
    const long = 'y'.repeat(MAX_RESPONSE_CHARS + 1000)
    expect(truncateMiddle(long).length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS)
  })

  it('falls back to a head slice when the cap is too small for both ends', () => {
    const long = 'z'.repeat(100)
    const out = truncateMiddle(long, 10)
    expect(out).toBe('z'.repeat(10))
    expect(out).not.toContain('truncated')
  })
})
