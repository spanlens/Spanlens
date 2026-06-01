/**
 * Dev-only mock trace fixtures used to validate the trace UI (topology graph,
 * Gantt) without needing real backend data. Only consumed by `useTrace` when
 * NODE_ENV === 'development' and the trace id matches a known mock slug.
 */
import type { SpanRow, TraceDetail } from '@/lib/queries/types'

const BASE = new Date('2026-06-01T08:00:00.000Z').getTime()

function span(
  id: string,
  parent: string | null,
  name: string,
  type: SpanRow['span_type'],
  startMs: number,
  durationMs: number,
  opts: Partial<SpanRow> = {},
): SpanRow {
  const started = new Date(BASE + startMs).toISOString()
  const ended = new Date(BASE + startMs + durationMs).toISOString()
  return {
    id,
    parent_span_id: parent,
    name,
    span_type: type,
    status: 'completed',
    started_at: started,
    ended_at: ended,
    duration_ms: durationMs,
    input: opts.input ?? null,
    output: opts.output ?? null,
    metadata: opts.metadata ?? null,
    error_message: null,
    request_id: opts.request_id ?? null,
    prompt_tokens: opts.prompt_tokens ?? 0,
    completion_tokens: opts.completion_tokens ?? 0,
    total_tokens: opts.total_tokens ?? 0,
    cost_usd: opts.cost_usd ?? null,
  }
}

/**
 * Mirrors the example from /docs/integrations/langgraph:
 *   customer-support-agent
 *   └── chain.agent_orchestrator
 *       ├── chain.classify_intent (sequential)
 *       ├── chain.dispatch (parallel fan-out inside)
 *       │   ├── chain.lookup_order
 *       │   └── chain.lookup_kb       ← critical
 *       └── chain.compose_final
 */
export function mockLangGraphTrace(): TraceDetail {
  const spans: SpanRow[] = [
    // Root LangGraph wrapper
    span('s_root', null, 'chain.agent_orchestrator', 'custom', 0, 3200),

    // Sequential: classify
    span('s_classify', 's_root', 'chain.classify_intent', 'custom', 0, 450),
    span('s_classify_llm', 's_classify', 'llm.ChatOpenAI', 'llm', 20, 410, {
      prompt_tokens: 280,
      completion_tokens: 24,
      total_tokens: 304,
      cost_usd: 0.0008,
    }),

    // Dispatcher node containing parallel fan-out
    span('s_dispatch', 's_root', 'chain.dispatch', 'custom', 450, 2700),

    // Parallel branch A: lookup_order
    span('s_order', 's_dispatch', 'chain.lookup_order', 'custom', 450, 1100),
    span('s_order_tool', 's_order', 'tool.shopify_query', 'tool', 470, 840),
    span('s_order_llm', 's_order', 'llm.ChatOpenAI', 'llm', 1320, 220, {
      prompt_tokens: 412,
      completion_tokens: 31,
      total_tokens: 443,
      cost_usd: 0.0005,
    }),

    // Parallel branch B: lookup_kb (critical path passes through here)
    span('s_kb', 's_dispatch', 'chain.lookup_kb', 'custom', 450, 2700),
    span('s_kb_retrieval', 's_kb', 'retrieval.PineconeStore', 'retrieval', 470, 300),
    span('s_kb_llm', 's_kb', 'llm.ChatAnthropic', 'llm', 800, 2330, {
      prompt_tokens: 1320,
      completion_tokens: 540,
      total_tokens: 1860,
      cost_usd: 0.0023,
    }),

    // Sequential: compose_final after dispatch
    span('s_compose', 's_root', 'chain.compose_final', 'custom', 3150, 40),
  ]

  return {
    id: '__demo_langgraph__',
    project_id: 'mock_project',
    organization_id: 'mock_org',
    api_key_id: null,
    name: 'customer-support-agent',
    status: 'completed',
    started_at: new Date(BASE).toISOString(),
    ended_at: new Date(BASE + 3200).toISOString(),
    duration_ms: 3200,
    span_count: spans.length,
    total_tokens: 2607,
    total_cost_usd: 0.0036,
    error_message: null,
    created_at: new Date(BASE).toISOString(),
    updated_at: new Date(BASE + 3200).toISOString(),
    metadata: { user_id: 'u_demo', session_id: 's_demo' },
    spans,
    critical_span_ids: ['s_root', 's_classify', 's_dispatch', 's_kb', 's_kb_llm', 's_compose'],
  }
}
