/**
 * Critical path computation for a span tree.
 *
 * The critical path is the sequence of spans from a root span to a leaf
 * where the accumulated wall-clock duration is longest. It answers:
 * "Which chain of spans, if made instant, would speed up the trace the most?"
 *
 * Algorithm: DAG longest-weighted-path via DFS + memoisation — O(V + E).
 *
 * Simplification: we treat parent→child as a sequential dependency chain.
 * The critical path through a node = own duration + max(children critical paths).
 * For parallel fan-out (siblings), the slowest sibling wins.
 *
 * Cycle defence: spans.parent_span_id has no FK, so malformed data could
 * create cycles. We track a `visiting` set and break cycles by treating
 * a re-visited node as a leaf.
 */

export interface SpanLike {
  id: string
  parent_span_id: string | null
  duration_ms: number | null
}

interface PathNode {
  /** Cumulative duration of this node + its critical-path descendant. */
  totalMs: number
  /** ID of the next span on the critical path (null = leaf). */
  nextSpanId: string | null
}

/**
 * Returns the IDs of spans that form the critical (longest-latency) path,
 * ordered from root to leaf. Empty array if input is empty.
 */
export function computeCriticalPath(spans: SpanLike[]): string[] {
  if (spans.length === 0) return []

  // Build parent → children index
  const childrenOf = new Map<string | null, SpanLike[]>()
  const spanById = new Map<string, SpanLike>()

  for (const s of spans) {
    spanById.set(s.id, s)
    const k = s.parent_span_id
    const bucket = childrenOf.get(k) ?? []
    bucket.push(s)
    childrenOf.set(k, bucket)
  }

  const memo = new Map<string, PathNode>()
  const visiting = new Set<string>()

  function dfs(span: SpanLike): PathNode {
    const cached = memo.get(span.id)
    if (cached) return cached

    // Cycle detection: if we're already visiting this span, treat as leaf
    if (visiting.has(span.id)) {
      return { totalMs: span.duration_ms ?? 0, nextSpanId: null }
    }

    visiting.add(span.id)

    const ownMs = span.duration_ms ?? 0
    const children = childrenOf.get(span.id) ?? []

    let bestTotalMs = 0
    let bestChildId: string | null = null

    for (const child of children) {
      const childResult = dfs(child)
      if (childResult.totalMs > bestTotalMs) {
        bestTotalMs = childResult.totalMs
        bestChildId = child.id
      }
    }

    visiting.delete(span.id)

    const result: PathNode = {
      totalMs: ownMs + bestTotalMs,
      nextSpanId: bestChildId,
    }
    memo.set(span.id, result)
    return result
  }

  // Find all root spans (no parent, or parent not in our span set)
  const knownIds = new Set(spans.map((s) => s.id))
  const roots = spans.filter(
    (s) => s.parent_span_id === null || !knownIds.has(s.parent_span_id),
  )

  if (roots.length === 0) {
    // All spans claim a parent — degenerate case. Fall back to the slowest single span.
    const slowest = [...spans].sort((a, b) => (b.duration_ms ?? 0) - (a.duration_ms ?? 0))[0]
    return slowest ? [slowest.id] : []
  }

  // Pick the root whose chain has the longest total duration
  let bestRoot = roots[0]!
  let bestRootMs = dfs(bestRoot).totalMs

  for (const root of roots.slice(1)) {
    const ms = dfs(root).totalMs
    if (ms > bestRootMs) {
      bestRoot = root
      bestRootMs = ms
    }
  }

  // Walk the chain from bestRoot to leaf
  const path: string[] = []
  let cursor: string | null = bestRoot.id
  const seen = new Set<string>()

  while (cursor !== null) {
    if (seen.has(cursor)) break // cycle safety
    seen.add(cursor)
    path.push(cursor)
    cursor = memo.get(cursor)?.nextSpanId ?? null
  }

  return path
}
