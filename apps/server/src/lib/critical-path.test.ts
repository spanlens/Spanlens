import { describe, expect, test } from 'vitest'
import { computeCriticalPath, type SpanLike } from './critical-path.js'

function s(id: string, parent: string | null, durationMs: number | null = 100): SpanLike {
  return { id, parent_span_id: parent, duration_ms: durationMs }
}

describe('computeCriticalPath', () => {
  test('returns [] for empty input', () => {
    expect(computeCriticalPath([])).toEqual([])
  })

  test('single root span', () => {
    expect(computeCriticalPath([s('a', null, 100)])).toEqual(['a'])
  })

  test('linear chain: root → child → grandchild', () => {
    // root(100) → child(200) → grand(50)  => longest = root→child→grand = 350
    const spans = [s('root', null, 100), s('child', 'root', 200), s('grand', 'child', 50)]
    expect(computeCriticalPath(spans)).toEqual(['root', 'child', 'grand'])
  })

  test('parallel fan-out: picks the slowest branch', () => {
    // root → [a(200), b(50), c(150)]  => critical = root→a
    const spans = [
      s('root', null, 10),
      s('a', 'root', 200),
      s('b', 'root', 50),
      s('c', 'root', 150),
    ]
    const path = computeCriticalPath(spans)
    expect(path[0]).toBe('root')
    expect(path[1]).toBe('a')
    expect(path).toHaveLength(2)
  })

  test('multiple roots: picks the longest root chain', () => {
    // r1(100) → r1c(200) = 300
    // r2(500)            = 500  ← winner
    const spans = [s('r1', null, 100), s('r1c', 'r1', 200), s('r2', null, 500)]
    expect(computeCriticalPath(spans)).toEqual(['r2'])
  })

  test('handles null duration_ms (running span) — treated as 0', () => {
    const spans = [s('a', null, null), s('b', 'a', 100)]
    expect(computeCriticalPath(spans)).toEqual(['a', 'b'])
  })

  test('orphan span (parent not in list) is treated as a root', () => {
    // 'a' is a real root (100ms). 'orphan' has parent 'missing' (not in list), so also root.
    // orphan(999) > a(100) → orphan wins
    const spans = [s('a', null, 100), s('orphan', 'missing', 999)]
    expect(computeCriticalPath(spans)).toEqual(['orphan'])
  })

  test('cycle defence: does not infinite-loop', () => {
    // a → b → a (cycle)
    const spans = [
      { id: 'a', parent_span_id: 'b', duration_ms: 100 },
      { id: 'b', parent_span_id: 'a', duration_ms: 200 },
    ]
    // Should return some non-empty path without hanging
    const path = computeCriticalPath(spans)
    expect(Array.isArray(path)).toBe(true)
    expect(path.length).toBeGreaterThan(0)
  })

  test('deep chain is handled correctly', () => {
    const spans: SpanLike[] = []
    const DEPTH = 20
    for (let i = 0; i < DEPTH; i++) {
      spans.push(s(`span_${i}`, i === 0 ? null : `span_${i - 1}`, 10))
    }
    const path = computeCriticalPath(spans)
    expect(path).toHaveLength(DEPTH)
    expect(path[0]).toBe('span_0')
    expect(path[DEPTH - 1]).toBe(`span_${DEPTH - 1}`)
  })

  test('sibling with deeper sub-tree wins over shallower but individually longer sibling', () => {
    // root(10) → [a(100), b(30)→c(30)→d(30)]
    // a total = 100, b chain total = 30+30+30 = 90  → a wins
    const spans = [
      s('root', null, 10),
      s('a', 'root', 100),
      s('b', 'root', 30),
      s('c', 'b', 30),
      s('d', 'c', 30),
    ]
    const path = computeCriticalPath(spans)
    expect(path[0]).toBe('root')
    expect(path[1]).toBe('a')
    expect(path).toHaveLength(2)
  })
})
