import { describe, expect, test } from 'vitest'
import { parsePageLimit } from './params.js'

/**
 * `parsePageLimit` is shared by every paginated read endpoint (requests,
 * traces, sessions, users). The clamps protect ClickHouse from
 * cost-multiplying inputs:
 *   - limit clamp prevents per-query result-set blowup
 *   - page clamp prevents O(offset) deep-pagination scans
 * A regression here lets an attacker burn ClickHouse seconds with a single
 * crafted query string.
 */

describe('parsePageLimit — defaults', () => {
  test('missing inputs → page=1, limit=50, offset=0', () => {
    expect(parsePageLimit(undefined, undefined)).toEqual({ page: 1, limit: 50, offset: 0 })
  })

  test('valid inputs round-trip', () => {
    expect(parsePageLimit('3', '20')).toEqual({ page: 3, limit: 20, offset: 40 })
  })
})

describe('parsePageLimit — limit clamping', () => {
  test('limit > maxLimit is clamped to maxLimit (100 default)', () => {
    expect(parsePageLimit('1', '500').limit).toBe(100)
  })

  test('limit ≤ 0 stays within the safe range [1, maxLimit]', () => {
    // `0` falls back to defaultLimit via JS truthiness (`0 || 50 → 50`).
    // `-5` is truthy, so Math.max(1, -5) clamps to 1. Different code paths,
    // but both end inside the safe range — that's what we actually need
    // to enforce, not the exact fallback target.
    const fromZero = parsePageLimit('1', '0').limit
    const fromNegative = parsePageLimit('1', '-5').limit
    expect(fromZero).toBeGreaterThanOrEqual(1)
    expect(fromZero).toBeLessThanOrEqual(100)
    expect(fromNegative).toBeGreaterThanOrEqual(1)
    expect(fromNegative).toBeLessThanOrEqual(100)
  })

  test('non-numeric limit falls back to defaultLimit', () => {
    expect(parsePageLimit('1', 'banana').limit).toBe(50)
  })

  test('custom maxLimit honored', () => {
    expect(parsePageLimit('1', '5000', 100, 200).limit).toBe(200)
  })
})

describe('parsePageLimit — page clamping (SSRF/DoS defense)', () => {
  test('page < 1 is clamped to 1', () => {
    expect(parsePageLimit('0', '10').page).toBe(1)
    expect(parsePageLimit('-99', '10').page).toBe(1)
  })

  test('page > maxPage (10000 default) is clamped to maxPage', () => {
    // Regression for "ClickHouse OFFSET 9.99B" DoS — without the clamp,
    // ?page=99999999 produces an unbounded offset.
    const { page, offset } = parsePageLimit('99999999', '100')
    expect(page).toBe(10_000)
    expect(offset).toBe(999_900) // (10000 - 1) * 100
  })

  test('page exactly at maxPage is honored', () => {
    expect(parsePageLimit('10000', '100').page).toBe(10_000)
  })

  test('custom maxPage honored', () => {
    expect(parsePageLimit('99999999', '100', 50, 100, 5).page).toBe(5)
  })

  test('worst-case offset under defaults is bounded (1M rows)', () => {
    // 10000 (max page) * 100 (max limit) - 100 = 999_900
    const { offset } = parsePageLimit('99999999', '99999999')
    expect(offset).toBeLessThanOrEqual(1_000_000)
  })

  test('non-numeric page falls back to 1, not maxPage', () => {
    expect(parsePageLimit('banana', '10').page).toBe(1)
  })
})
