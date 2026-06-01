import type { SpanRow, SpanType, TraceStatus } from '@/lib/queries/types'

/**
 * One node in the LangGraph topology view.
 * Built from a single `chain.*` span; rolls up cost / tokens from descendants.
 */
export interface TopologyNode {
  id: string
  /** Display label (chain name stripped of "chain." prefix). */
  label: string
  /** True for the synthetic graph-root chain span. */
  isRoot: boolean
  status: TraceStatus
  durationMs: number | null
  /** Rolled up from this node's descendants (including non-chain LLM/tool/retrieval spans). */
  costUsd: number | null
  /** Rolled up token total. */
  totalTokens: number
  /** Direct non-chain child span counts (LLM / tool / retrieval / embedding / custom). */
  childCounts: Record<SpanType, number>
  /** Whether this chain node is on the critical path. */
  isCritical: boolean
  /** Original span for drawer / inspection. */
  span: SpanRow
  /** Layout (filled in by dagre). */
  x: number
  y: number
  width: number
  height: number
}

export interface TopologyEdge {
  id: string
  source: string
  target: string
  isCritical: boolean
  /** True when source.end > target.start (siblings that overlapped in time). */
  isParallel: boolean
}

export interface Topology {
  nodes: TopologyNode[]
  edges: TopologyEdge[]
  width: number
  height: number
  /** Fraction of spans that are chain.* — used to decide whether graph view is worth showing. */
  chainShare: number
}

const NODE_WIDTH = 220
const NODE_HEIGHT = 78
/** Two siblings count as sequential if there is at most this much overlap in ms. */
const SEQUENTIAL_TOLERANCE_MS = 2

function ms(d: Date): number {
  return d.getTime()
}

function spanStart(s: SpanRow): number {
  return ms(new Date(s.started_at))
}

function spanEnd(s: SpanRow): number {
  if (s.ended_at) return ms(new Date(s.ended_at))
  if (s.duration_ms != null) return spanStart(s) + s.duration_ms
  return spanStart(s)
}

function isChain(s: SpanRow): boolean {
  return s.name.startsWith('chain.')
}

function stripChain(name: string): string {
  return name.replace(/^chain\./, '')
}

/**
 * Walk down from `rootId` and accumulate cost / tokens across every descendant.
 * Cost on chain spans themselves is generally null (they are wrapper spans);
 * the LLM / tool children carry the real numbers.
 */
function rollup(
  rootId: string,
  childrenByParent: Map<string | null, SpanRow[]>,
): { costUsd: number | null; totalTokens: number } {
  let cost = 0
  let hasCost = false
  let tokens = 0
  const stack: string[] = [rootId]
  while (stack.length > 0) {
    const id = stack.pop()!
    const kids = childrenByParent.get(id) ?? []
    for (const k of kids) {
      if (k.cost_usd != null) {
        cost += k.cost_usd
        hasCost = true
      }
      tokens += k.total_tokens
      stack.push(k.id)
    }
  }
  return { costUsd: hasCost ? cost : null, totalTokens: tokens }
}

/**
 * Build a LangGraph-style topology from a flat list of spans.
 *
 * Topology rules:
 *   - Nodes = every `chain.*` span.
 *   - For each non-root chain span X with a chain parent P:
 *       * If a previous chain-sibling Y exists with Y.end <= X.start (within
 *         SEQUENTIAL_TOLERANCE_MS), draw a sequential edge Y → X.
 *       * Otherwise X is a fan-out head from P: draw an entry edge P → X.
 *   - Edge is marked `isCritical` when both endpoints are on the critical path.
 *   - Edge is marked `isParallel` only for entry edges P → X where X has a
 *     concurrent sibling (used purely for styling).
 *
 * Returns null if the trace has fewer than 2 chain spans (graph view would be empty / pointless).
 */
export function buildTopology(
  spans: SpanRow[],
  criticalSpanIds: readonly string[],
): Topology | null {
  const chainSpans = spans.filter(isChain)
  if (chainSpans.length < 2) return null

  const chainIdSet = new Set(chainSpans.map((s) => s.id))
  const criticalSet = new Set(criticalSpanIds)
  const spanById = new Map(spans.map((s) => [s.id, s] as const))

  // Build parent → children map (across the whole span set, not just chains).
  const childrenByParent = new Map<string | null, SpanRow[]>()
  for (const s of spans) {
    const arr = childrenByParent.get(s.parent_span_id)
    if (arr) arr.push(s)
    else childrenByParent.set(s.parent_span_id, [s])
  }

  // Walk up from each chain span to find its nearest chain ancestor.
  function chainParent(s: SpanRow): SpanRow | null {
    let cur = s.parent_span_id
    while (cur) {
      const p = spanById.get(cur)
      if (!p) return null
      if (isChain(p)) return p
      cur = p.parent_span_id
    }
    return null
  }

  // Build nodes.
  const nodeMap = new Map<string, TopologyNode>()
  for (const s of chainSpans) {
    const directChildren = childrenByParent.get(s.id) ?? []
    const childCounts: Record<SpanType, number> = {
      llm: 0,
      tool: 0,
      retrieval: 0,
      embedding: 0,
      custom: 0,
    }
    for (const c of directChildren) {
      if (!chainIdSet.has(c.id)) childCounts[c.span_type]++
    }
    const { costUsd, totalTokens } = rollup(s.id, childrenByParent)
    const parentChain = chainParent(s)
    nodeMap.set(s.id, {
      id: s.id,
      label: stripChain(s.name),
      isRoot: parentChain === null,
      status: s.status,
      durationMs: s.duration_ms,
      costUsd,
      totalTokens,
      childCounts,
      isCritical: criticalSet.has(s.id),
      span: s,
      x: 0,
      y: 0,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })
  }

  // Build edges by sibling time ordering.
  const edges: TopologyEdge[] = []
  // Group chain spans by their nearest chain parent (null for the synthetic graph root group).
  const byParent = new Map<string | null, SpanRow[]>()
  for (const s of chainSpans) {
    const p = chainParent(s)
    const key = p?.id ?? null
    const arr = byParent.get(key)
    if (arr) arr.push(s)
    else byParent.set(key, [s])
  }

  for (const [parentId, group] of byParent) {
    const sorted = [...group].sort((a, b) => spanStart(a) - spanStart(b))
    for (let i = 0; i < sorted.length; i++) {
      const cur = sorted[i]!
      // Find latest previous sibling that finished before `cur` started.
      let pred: SpanRow | null = null
      for (let j = i - 1; j >= 0; j--) {
        const prev = sorted[j]!
        if (spanEnd(prev) - spanStart(cur) <= SEQUENTIAL_TOLERANCE_MS) {
          pred = prev
          break
        }
      }
      if (pred) {
        edges.push({
          id: `${pred.id}->${cur.id}`,
          source: pred.id,
          target: cur.id,
          isCritical: criticalSet.has(pred.id) && criticalSet.has(cur.id),
          isParallel: false,
        })
      } else if (parentId) {
        // Fan-out / entry edge from the parent chain.
        const hasParallelTwin = sorted.some(
          (other) =>
            other.id !== cur.id &&
            Math.abs(spanStart(other) - spanStart(cur)) <= SEQUENTIAL_TOLERANCE_MS,
        )
        edges.push({
          id: `${parentId}->${cur.id}`,
          source: parentId,
          target: cur.id,
          isCritical: criticalSet.has(parentId) && criticalSet.has(cur.id),
          isParallel: hasParallelTwin,
        })
      }
    }
  }

  // Layout: recursive subtree-width tree layout.
  //
  // Our edge inference guarantees each node has at most one incoming edge
  // (either parent-chain entry, or sequential-predecessor sibling), so the
  // result is always a tree (possibly a forest if multiple roots exist).
  // dagre's general DAG layout left parents a few pixels off-centre above
  // their children — visible whenever a fan-out had ≥3 branches. A simple
  // bottom-up subtree-width pass gives perfectly symmetric placement.
  const RANK_SEP = 64
  const NODE_SEP = 36
  const MARGIN = 24

  const childrenAdj = new Map<string, string[]>()
  const hasParentEdge = new Set<string>()
  for (const e of edges) {
    const arr = childrenAdj.get(e.source)
    if (arr) arr.push(e.target)
    else childrenAdj.set(e.source, [e.target])
    hasParentEdge.add(e.target)
  }
  const roots: string[] = []
  for (const id of nodeMap.keys()) if (!hasParentEdge.has(id)) roots.push(id)

  const subWidthCache = new Map<string, number>()
  function subtreeWidth(id: string): number {
    const cached = subWidthCache.get(id)
    if (cached !== undefined) return cached
    const kids = childrenAdj.get(id) ?? []
    if (kids.length === 0) {
      subWidthCache.set(id, NODE_WIDTH)
      return NODE_WIDTH
    }
    let total = 0
    for (const k of kids) total += subtreeWidth(k) + NODE_SEP
    total -= NODE_SEP
    const w = Math.max(NODE_WIDTH, total)
    subWidthCache.set(id, w)
    return w
  }

  // Sort each node's children by execution start time so visual reading
  // order matches what happened.
  function kidsSorted(id: string): string[] {
    const kids = childrenAdj.get(id) ?? []
    return [...kids].sort((a, b) => {
      const sa = nodeMap.get(a)?.span.started_at ?? ''
      const sb = nodeMap.get(b)?.span.started_at ?? ''
      return sa.localeCompare(sb)
    })
  }

  function place(id: string, centerX: number, rank: number): void {
    const node = nodeMap.get(id)
    if (!node) return
    // Store node CENTER (not top-left); combined with React Flow's
    // nodeOrigin=[0.5, 0], React Flow renders the node anchored at this
    // centre point. This eliminates the off-by-half-width drift between
    // our authoritative layout coordinates and React Flow's edge endpoint
    // calculations, which had been anchoring edges at ~62% of node width
    // when the two coordinate conventions disagreed.
    node.x = centerX
    node.y = MARGIN + rank * (NODE_HEIGHT + RANK_SEP)
    const kids = kidsSorted(id)
    if (kids.length === 0) return
    let totalKidsWidth = 0
    for (const k of kids) totalKidsWidth += subtreeWidth(k) + NODE_SEP
    totalKidsWidth -= NODE_SEP
    let cursor = centerX - totalKidsWidth / 2
    for (const k of kids) {
      const w = subtreeWidth(k)
      place(k, cursor + w / 2, rank + 1)
      cursor += w + NODE_SEP
    }
  }

  let rootCursor = MARGIN
  for (const r of roots) {
    const w = subtreeWidth(r)
    place(r, rootCursor + w / 2, 0)
    rootCursor += w + NODE_SEP
  }

  let maxX = 0
  let maxY = 0
  for (const n of nodeMap.values()) {
    maxX = Math.max(maxX, n.x + n.width)
    maxY = Math.max(maxY, n.y + n.height)
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges,
    width: maxX,
    height: maxY,
    chainShare: spans.length > 0 ? chainSpans.length / spans.length : 0,
  }
}

/**
 * Heuristic: is this trace "graph-shaped" enough to warrant the topology view?
 * Looks for at least 2 chain spans AND ≥20% of all spans being chains.
 * Tuned so simple two-call RAG traces stay on the Gantt by default.
 */
export function shouldShowGraphView(spans: SpanRow[]): boolean {
  if (spans.length === 0) return false
  const chains = spans.filter(isChain).length
  if (chains < 2) return false
  return chains / spans.length >= 0.2
}
