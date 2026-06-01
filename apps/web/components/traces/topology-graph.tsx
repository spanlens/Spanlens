'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  Background,
  BaseEdge,
  Handle,
  Position,
  useInternalNode,
  useReactFlow,
  useNodesInitialized,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { cn } from '@/lib/utils'
import type { SpanRow, SpanType } from '@/lib/queries/types'
import { buildTopology, type Topology, type TopologyNode } from '@/lib/topology'

/* ── Formatting helpers ─────────────────────────────────────────────────── */

function fmtMs(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function fmtCost(usd: number | null): string {
  if (usd == null || usd === 0) return '—'
  if (usd < 0.001) return `<$0.001`
  if (usd < 1) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

const CHILD_GLYPH: Record<SpanType, string> = {
  llm: '◆',
  tool: '⚙',
  retrieval: '⌕',
  embedding: '~',
  custom: '·',
}

const CHILD_LABEL: Record<SpanType, string> = {
  llm: 'LLM',
  tool: 'tool',
  retrieval: 'ret',
  embedding: 'embd',
  custom: 'span',
}

/* ── Custom node ────────────────────────────────────────────────────────── */

interface TopologyNodeData {
  node: TopologyNode
  isSelected: boolean
  onSelect: (span: SpanRow) => void
  [key: string]: unknown
}

function TopologyNodeView({ data }: NodeProps<Node<TopologyNodeData>>) {
  const { node, isSelected } = data
  const errored = node.status === 'error'
  const running = node.status === 'running'

  // Pick single most "interesting" child category for the chip row.
  const childChips: Array<{ type: SpanType; count: number }> = []
  for (const type of ['llm', 'tool', 'retrieval', 'embedding', 'custom'] as SpanType[]) {
    const count = node.childCounts[type]
    if (count > 0) childChips.push({ type, count })
  }

  return (
    <div
      className={cn(
        'group relative flex flex-col items-stretch text-left rounded-md border bg-bg-elev w-full h-full px-3 py-2 transition-colors cursor-pointer pointer-events-auto',
        'hover:border-border-strong',
        isSelected && 'ring-2 ring-accent ring-offset-1 ring-offset-bg',
        node.isCritical
          ? 'border-accent'
          : errored
          ? 'border-bad'
          : 'border-border',
        node.isRoot && 'bg-bg',
      )}
      style={{ width: node.width, height: node.height }}
    >
      {/* Top row: name + critical badge */}
      <div className="flex items-center gap-1.5 min-w-0">
        {node.isRoot && (
          <span className="font-mono text-[8.5px] uppercase tracking-[0.06em] text-text-faint shrink-0">
            graph
          </span>
        )}
        <span
          className={cn(
            'text-[12.5px] font-medium truncate flex-1',
            node.isCritical ? 'text-accent' : 'text-text',
          )}
        >
          {node.label}
        </span>
        {node.isCritical && (
          <span
            className="font-mono text-[8.5px] uppercase tracking-[0.06em] text-accent shrink-0"
            title="On critical path"
          >
            CP
          </span>
        )}
        {errored && (
          <span className="font-mono text-[8.5px] uppercase tracking-[0.06em] text-bad shrink-0">
            ERR
          </span>
        )}
        {running && (
          <span className="font-mono text-[8.5px] uppercase tracking-[0.06em] text-accent animate-pulse shrink-0">
            ●
          </span>
        )}
      </div>

      {/* Mid row: duration + cost */}
      <div className="flex items-center gap-3 mt-1.5 font-mono text-[10.5px] text-text-muted">
        <span className="truncate">{fmtMs(node.durationMs)}</span>
        <span className="text-text-faint">·</span>
        <span className="truncate">{fmtCost(node.costUsd)}</span>
        {node.totalTokens > 0 && (
          <>
            <span className="text-text-faint">·</span>
            <span className="truncate">{node.totalTokens.toLocaleString()}t</span>
          </>
        )}
      </div>

      {/* Bottom row: child-type chips */}
      {childChips.length > 0 && (
        <div className="flex items-center gap-1 mt-1.5 flex-wrap">
          {childChips.map((c) => (
            <span
              key={c.type}
              className="inline-flex items-center gap-0.5 font-mono text-[9.5px] text-text-faint px-1 py-[1px] rounded-[3px] border border-border bg-bg"
            >
              <span>{CHILD_GLYPH[c.type]}</span>
              <span>{c.count}</span>
              <span className="opacity-70">{CHILD_LABEL[c.type]}</span>
            </span>
          ))}
        </div>
      )}

      {/* Handles (invisible but required for edges to attach).
          Explicit ids force every edge to attach at the same point on the
          node (center-top for incoming, center-bottom for outgoing), which
          stops React Flow from auto-spreading multiple outgoing edges
          across an invisible source band. */}
      <Handle
        id="t"
        type="target"
        position={Position.Top}
        className="!w-2 !h-2 !bg-border !border-0 opacity-0"
      />
      <Handle
        id="s"
        type="source"
        position={Position.Bottom}
        className="!w-2 !h-2 !bg-border !border-0 opacity-0"
      />
    </div>
  )
}

const NODE_TYPES = { topology: TopologyNodeView }

/* ── Custom step edge ───────────────────────────────────────────────────────
 *
 * React Flow's built-in step edge computes endpoint X coordinates from the
 * source/target node's MEASURED DOM width (getBoundingClientRect). When the
 * browser applies any scaling that makes measured width disagree with the
 * width we passed in the node spec (HiDPI quirks, OS display scaling, browser
 * zoom, custom CSS), the edge anchors at the wrong horizontal position.
 *
 * This component bypasses that by reading the source/target node's authoritative
 * `position.x` (which is the node centre because we use nodeOrigin=[0.5, 0])
 * and routing the path through those coordinates directly. The Y coordinates
 * come from React Flow as-is since vertical alignment was never the problem.
 */
function CustomStepEdge(props: EdgeProps) {
  const sourceNode = useInternalNode(props.source)
  const targetNode = useInternalNode(props.target)
  const { style, markerEnd, markerStart, id, interactionWidth } = props

  if (!sourceNode || !targetNode) return null

  // With nodeOrigin=[0.5, 0], position.x is the node's centre and position.y
  // is its TOP. Anchor 2px outside the source's bottom edge and the target's
  // top edge so the line reads as a connector touching the box rather than
  // bleeding into the border.
  const EDGE_GAP = 2
  const sourceX = sourceNode.position.x
  const targetX = targetNode.position.x
  const sourceHeight = sourceNode.measured?.height ?? sourceNode.height ?? 78
  const sourceY = sourceNode.position.y + sourceHeight + EDGE_GAP
  const targetY = targetNode.position.y - EDGE_GAP

  // Step routing: down from source centre, horizontal to target column, down
  // into target centre. When source and target share a column the horizontal
  // segment degenerates to length 0 (clean vertical line).
  const midY = (sourceY + targetY) / 2
  const path = `M ${sourceX} ${sourceY} L ${sourceX} ${midY} L ${targetX} ${midY} L ${targetX} ${targetY}`

  // BaseEdge has `exactOptionalPropertyTypes`-strict props, so only spread
  // the values we actually have rather than forwarding `undefined` for any.
  const baseProps: Parameters<typeof BaseEdge>[0] = { id, path, style }
  if (markerEnd !== undefined) baseProps.markerEnd = markerEnd
  if (markerStart !== undefined) baseProps.markerStart = markerStart
  if (interactionWidth !== undefined) baseProps.interactionWidth = interactionWidth

  return <BaseEdge {...baseProps} />
}

const EDGE_TYPES = { 'custom-step': CustomStepEdge }

/* ── Main component ─────────────────────────────────────────────────────── */

export interface TopologyGraphProps {
  spans: SpanRow[]
  criticalSpanIds: readonly string[]
  onSelectSpan: (span: SpanRow) => void
  selectedSpanId: string | null
}

function TopologyGraphInner({
  spans,
  criticalSpanIds,
  onSelectSpan,
  selectedSpanId,
}: TopologyGraphProps) {
  const topology: Topology | null = useMemo(
    () => buildTopology(spans, criticalSpanIds),
    [spans, criticalSpanIds],
  )

  const { nodes, edges } = useMemo(() => {
    if (!topology) return { nodes: [] as Node[], edges: [] as Edge[] }
    const flowNodes: Node[] = topology.nodes.map((n) => ({
      id: n.id,
      type: 'topology',
      position: { x: n.x, y: n.y },
      // width/height on the node spec is the single source of truth for
      // both layout AND React Flow's internal handle/edge math. We
      // deliberately do NOT also pass `style.width/height`, because that
      // creates two sources React Flow can drift between (manifesting as
      // edges anchoring at ~62% of the node instead of at the centre).
      // The custom node component reads width/height directly via NodeProps
      // and sizes itself.
      width: n.width,
      height: n.height,
      data: {
        node: n,
        isSelected: n.id === selectedSpanId,
        onSelect: onSelectSpan,
      } satisfies TopologyNodeData,
      draggable: false,
      selectable: false,
    }))
    const flowEdges: Edge[] = topology.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: 's',
      targetHandle: 't',
      // Use our custom edge component that anchors at the source/target
      // node's authoritative `position.x` (centre), not React Flow's
      // DOM-measured handle position.
      type: 'custom-step',
      animated: false,
      style: {
        stroke: e.isCritical
          ? 'var(--accent)'
          : e.isParallel
          ? 'var(--text-faint)'
          : 'var(--border-strong)',
        strokeWidth: e.isCritical ? 2 : 1.25,
        strokeDasharray: e.isParallel ? '4 3' : undefined,
      },
    }))
    return { nodes: flowNodes, edges: flowEdges }
  }, [topology, selectedSpanId, onSelectSpan])

  const { fitView } = useReactFlow()
  const nodesInitialized = useNodesInitialized()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [hasFittedFor, setHasFittedFor] = useState<string | null>(null)
  const topologyKey = topology
    ? `${topology.nodes.length}:${topology.width}:${topology.height}`
    : null

  // Robust fit: wait for BOTH nodes to be measured AND the container to have
  // a non-trivial height. Watching the container with a ResizeObserver covers
  // the flex-layout race where height transitions from 0 → final on mount.
  useEffect(() => {
    if (!nodesInitialized || !topology || !topologyKey) return
    if (hasFittedFor === topologyKey) return
    const el = containerRef.current
    if (!el) return

    const tryFit = () => {
      if (el.clientHeight > 80 && el.clientWidth > 80) {
        fitView({ padding: 0.18, duration: 0 })
        setHasFittedFor(topologyKey)
        return true
      }
      return false
    }

    if (tryFit()) return

    const ro = new ResizeObserver(() => tryFit())
    ro.observe(el)
    return () => ro.disconnect()
  }, [nodesInitialized, topology, topologyKey, hasFittedFor, fitView])

  if (!topology) {
    return (
      <div className="flex h-full items-center justify-center text-center px-8">
        <div className="max-w-md">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-text-faint mb-2">
            No graph topology
          </div>
          <p className="text-[13px] text-text-muted leading-relaxed">
            This trace does not contain enough <code>chain.*</code> spans to render a
            graph view. Use the Timeline tab to inspect the Gantt waterfall.
          </p>
          <p className="mt-3 text-[12px] text-text-faint leading-relaxed">
            The graph view is populated automatically when you instrument with the
            Spanlens LangChain / LangGraph callback handler.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="h-full w-full bg-bg">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        // nodeOrigin=[0.5, 0] means node.position refers to the top-CENTER
        // (not top-left) of the node. Our layout writes centre coordinates,
        // so this puts our coordinate system and React Flow's in lockstep.
        nodeOrigin={[0.5, 0]}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        zoomOnDoubleClick={false}
        onNodeClick={(_, node) => {
          const d = node.data as TopologyNodeData | undefined
          if (d) d.onSelect(d.node.span)
        }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        maxZoom={2}
        defaultEdgeOptions={{ type: 'step' }}
      >
        <Background gap={20} size={1} color="var(--border)" />
        <Controls
          showInteractive={false}
          position="bottom-right"
          className="!bg-bg-elev !border !border-border !rounded-md !shadow-none [&>button]:!bg-bg-elev [&>button]:!border-border [&>button]:!text-text-muted [&>button:hover]:!bg-bg-muted"
        />
      </ReactFlow>
    </div>
  )
}

export function TopologyGraph(props: TopologyGraphProps) {
  return (
    <ReactFlowProvider>
      <TopologyGraphInner {...props} />
    </ReactFlowProvider>
  )
}
