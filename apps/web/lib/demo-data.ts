/**
 * Static demo data for /demo/* pages.
 * Timestamps are computed at import time so they always appear "recent".
 */

import type {
  TraceRow,
  TraceDetail,
  SpanRow,
  RequestRow,
  RequestDetail,
  StatsOverview,
  TimeseriesPoint,
  SpendForecast,
  AlertRow,
  NotificationChannelRow,
  AlertDeliveryRow,
} from '@/lib/queries/types'
import type { ModelRecommendation } from '@/lib/queries/use-recommendations'
import type { Anomaly, AnomalyHistoryEntry } from '@/lib/queries/use-anomalies'
import type { PromptVersion } from '@/lib/queries/use-prompts'
import type { SecuritySummaryItem, FlaggedRequest } from '@/lib/queries/use-security'
import type { Evaluator, EvalRun, EvalResult } from '@/lib/queries/use-evals'
import type { Dataset, DatasetItem, DatasetWithItems } from '@/lib/queries/use-datasets'
import type { Experiment, ExperimentResult } from '@/lib/queries/use-experiments'
import type { AnnotationQueueItem, CorrelationPair } from '@/lib/queries/use-human-evals'

const N = Date.now()
const min = (m: number) => new Date(N - m * 60_000).toISOString()
const hrs = (h: number) => min(h * 60)
const day = (d: number) => hrs(d * 24)
const ts = (base: number, offsetMs: number) => new Date(base + offsetMs).toISOString()

// ── Traces ────────────────────────────────────────────────────────────────────

export const DEMO_TRACES: TraceRow[] = [
  {
    id: 'demo-trace-langgraph',
    project_id: 'demo-proj',
    name: 'multi-agent-orchestrator',
    status: 'completed',
    started_at: min(0.2),
    ended_at: ts(N - 0.2 * 60_000, 3200),
    duration_ms: 3200,
    span_count: 11,
    total_tokens: 2607,
    total_cost_usd: 0.0036,
    error_message: null,
    created_at: min(0.2),
  },
  {
    id: 'demo-trace-001',
    project_id: 'demo-proj',
    name: 'Customer Support Agent',
    status: 'running',
    started_at: min(0.5),
    ended_at: null,
    duration_ms: null,
    span_count: 2,
    total_tokens: 820,
    total_cost_usd: 0.0098,
    error_message: null,
    created_at: min(0.5),
  },
  {
    id: 'demo-trace-002',
    project_id: 'demo-proj',
    name: 'Customer Support Agent',
    status: 'completed',
    started_at: min(5),
    ended_at: ts(N - 5 * 60_000, 8240),
    duration_ms: 8240,
    span_count: 8,
    total_tokens: 3820,
    total_cost_usd: 0.0481,
    error_message: null,
    created_at: min(5),
  },
  {
    id: 'demo-trace-003',
    project_id: 'demo-proj',
    name: 'Code Review Agent',
    status: 'completed',
    started_at: min(12),
    ended_at: ts(N - 12 * 60_000, 3100),
    duration_ms: 3100,
    span_count: 6,
    total_tokens: 1640,
    total_cost_usd: 0.0215,
    error_message: null,
    created_at: min(12),
  },
  {
    id: 'demo-trace-004',
    project_id: 'demo-proj',
    name: 'Document Summarizer',
    status: 'completed',
    started_at: min(18),
    ended_at: ts(N - 18 * 60_000, 2400),
    duration_ms: 2400,
    span_count: 4,
    total_tokens: 1200,
    total_cost_usd: 0.0152,
    error_message: null,
    created_at: min(18),
  },
  {
    id: 'demo-trace-005',
    project_id: 'demo-proj',
    name: 'Data Extraction Pipeline',
    status: 'completed',
    started_at: min(28),
    ended_at: ts(N - 28 * 60_000, 22400),
    duration_ms: 22400,
    span_count: 12,
    total_tokens: 8200,
    total_cost_usd: 0.1824,
    error_message: null,
    created_at: min(28),
  },
  {
    id: 'demo-trace-006',
    project_id: 'demo-proj',
    name: 'Email Draft Agent',
    status: 'error',
    started_at: min(45),
    ended_at: ts(N - 45 * 60_000, 1240),
    duration_ms: 1240,
    span_count: 3,
    total_tokens: 620,
    total_cost_usd: 0.0082,
    error_message: 'Rate limit exceeded (429): You have exceeded your current quota for gpt-4o.',
    created_at: min(45),
  },
  {
    id: 'demo-trace-007',
    project_id: 'demo-proj',
    name: 'Customer Support Agent',
    status: 'completed',
    started_at: hrs(1.2),
    ended_at: ts(N - 1.2 * 3_600_000, 5600),
    duration_ms: 5600,
    span_count: 8,
    total_tokens: 2840,
    total_cost_usd: 0.0324,
    error_message: null,
    created_at: hrs(1.2),
  },
  {
    id: 'demo-trace-008',
    project_id: 'demo-proj',
    name: 'Report Generator',
    status: 'completed',
    started_at: hrs(1.8),
    ended_at: ts(N - 1.8 * 3_600_000, 4100),
    duration_ms: 4100,
    span_count: 5,
    total_tokens: 2200,
    total_cost_usd: 0.0291,
    error_message: null,
    created_at: hrs(1.8),
  },
  {
    id: 'demo-trace-009',
    project_id: 'demo-proj',
    name: 'Customer Support Agent',
    status: 'completed',
    started_at: hrs(2.5),
    ended_at: ts(N - 2.5 * 3_600_000, 7100),
    duration_ms: 7100,
    span_count: 8,
    total_tokens: 3100,
    total_cost_usd: 0.0392,
    error_message: null,
    created_at: hrs(2.5),
  },
  {
    id: 'demo-trace-010',
    project_id: 'demo-proj',
    name: 'Data Extraction Pipeline',
    status: 'completed',
    started_at: hrs(3.2),
    ended_at: ts(N - 3.2 * 3_600_000, 19800),
    duration_ms: 19800,
    span_count: 12,
    total_tokens: 7400,
    total_cost_usd: 0.1641,
    error_message: null,
    created_at: hrs(3.2),
  },
]

// ── Trace Detail (demo-trace-002 — fully detailed) ────────────────────────────

const T002 = N - 5 * 60_000

function span(
  id: string,
  parentId: string | null,
  name: string,
  spanType: SpanRow['span_type'],
  status: SpanRow['status'],
  offsetMs: number,
  durationMs: number,
  extras: Partial<SpanRow> = {},
): SpanRow {
  return {
    id,
    parent_span_id: parentId,
    name,
    span_type: spanType,
    status,
    started_at: ts(T002, offsetMs),
    ended_at: status === 'running' ? null : ts(T002, offsetMs + durationMs),
    duration_ms: status === 'running' ? null : durationMs,
    input: null,
    output: null,
    metadata: null,
    error_message: null,
    request_id: null,
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    cost_usd: null,
    ...extras,
  }
}

const DEMO_SPANS_002: SpanRow[] = [
  span('s002-root', null, 'customer-support-agent', 'custom', 'completed', 0, 8240, {
    input: { query: "I can't log into my account, it keeps saying 'invalid password'", session_id: 'sess-8842' },
    output: { reply: "I've sent a password reset email to your registered address. The link expires in 30 minutes.", handled: true },
    total_tokens: 3820,
    cost_usd: 0.0481,
  }),
  span('s002-classify', 's002-root', 'classify_intent', 'llm', 'completed', 0, 520, {
    input: { messages: [{ role: 'user', content: "I can't log into my account" }], model: 'gpt-4o-mini' },
    output: { intent: 'account_access', confidence: 0.97 },
    prompt_tokens: 180,
    completion_tokens: 42,
    total_tokens: 222,
    cost_usd: 0.00014,
    metadata: { model: 'gpt-4o-mini', provider: 'openai' },
  }),
  span('s002-kb', 's002-root', 'knowledge_base_search', 'retrieval', 'completed', 560, 680, {
    input: { query: 'account access password reset login', top_k: 5 },
    output: { results: [{ id: 'kb-441', title: 'How to reset your password', score: 0.94 }, { id: 'kb-102', title: 'Login troubleshooting', score: 0.88 }] },
    metadata: { index: 'help-center-v3', retrieved: 5 },
  }),
  span('s002-tickets', 's002-root', 'fetch_ticket_history', 'tool', 'completed', 1280, 240, {
    input: { user_id: 'usr-88421', limit: 10 },
    output: { tickets: [], open_count: 0 },
  }),
  span('s002-llm', 's002-root', 'llm.claude-sonnet-4-5', 'llm', 'completed', 1560, 5640, {
    input: {
      model: 'claude-sonnet-4-5',
      messages: [
        { role: 'system', content: 'You are a helpful customer support agent for Acme Corp. Be concise and empathetic.' },
        { role: 'user', content: "I can't log into my account, it keeps saying 'invalid password'" },
      ],
    },
    output: { content: "I've sent a password reset email to your registered address. The link expires in 30 minutes. If you don't see it, check your spam folder." },
    prompt_tokens: 2800,
    completion_tokens: 680,
    total_tokens: 3480,
    cost_usd: 0.0472,
    metadata: { model: 'claude-sonnet-4-5', provider: 'anthropic', stop_reason: 'end_turn' },
  }),
  span('s002-validate', 's002-root', 'validate_response', 'custom', 'completed', 7200, 320, {
    input: { response: "I've sent a password reset email..." },
    output: { valid: true, pii_detected: false, toxicity_score: 0.01 },
  }),
  span('s002-send', 's002-root', 'send_response', 'tool', 'completed', 7560, 380, {
    input: { channel: 'chat', message_id: 'msg-99142' },
    output: { delivered: true },
  }),
  span('s002-log', 's002-root', 'log_interaction', 'tool', 'completed', 7960, 280, {
    input: { event: 'support_session_completed', outcome: 'resolved', intent: 'account_access' },
    output: { logged: true },
  }),
]

export const DEMO_TRACE_002_DETAIL: TraceDetail = {
  ...DEMO_TRACES[1]!,
  metadata: { session_id: 'sess-8842', environment: 'production', agent_version: '2.1.4' },
  api_key_id: 'demo-key-001',
  organization_id: 'demo-org-001',
  updated_at: ts(T002, 8240),
  spans: DEMO_SPANS_002,
  critical_span_ids: [],
}

function makeSimpleDetail(trace: TraceRow): TraceDetail {
  const base = new Date(trace.started_at).getTime()
  const dur = trace.duration_ms ?? 4000
  return {
    ...trace,
    metadata: { environment: 'production' },
    api_key_id: 'demo-key-001',
    organization_id: 'demo-org-001',
    updated_at: trace.ended_at ?? trace.started_at,
    critical_span_ids: [],
    spans: [
      {
        id: trace.id + '-root',
        parent_span_id: null,
        name: trace.name,
        span_type: 'custom',
        status: trace.status,
        started_at: trace.started_at,
        ended_at: trace.ended_at,
        duration_ms: trace.duration_ms,
        input: { query: 'Demo input' },
        output: trace.status === 'error' ? null : { result: 'Demo output' },
        metadata: null,
        error_message: trace.error_message,
        request_id: null,
        prompt_tokens: Math.floor(trace.total_tokens * 0.75),
        completion_tokens: Math.floor(trace.total_tokens * 0.25),
        total_tokens: trace.total_tokens,
        cost_usd: trace.total_cost_usd,
      },
      ...([1, 2, 3].map((i) => ({
        id: trace.id + '-span-' + i,
        parent_span_id: trace.id + '-root',
        name: ['classify_intent', 'llm.gpt-4o', 'format_output'][i - 1]!,
        span_type: (['llm', 'llm', 'custom'] as SpanRow['span_type'][])[i - 1]!,
        status: trace.status,
        started_at: ts(base, (i - 1) * Math.floor(dur / 4)),
        ended_at: trace.status === 'running' ? null : ts(base, i * Math.floor(dur / 4)),
        duration_ms: trace.status === 'running' ? null : Math.floor(dur / 4),
        input: null,
        output: null,
        metadata: null,
        error_message: i === 3 ? trace.error_message : null,
        request_id: null,
        prompt_tokens: Math.floor(trace.total_tokens * 0.25 / 3),
        completion_tokens: Math.floor(trace.total_tokens * 0.08 / 3),
        total_tokens: Math.floor(trace.total_tokens / 3),
        cost_usd: trace.total_cost_usd / 3,
      }))),
    ],
  }
}

// ── LangGraph demo trace ─────────────────────────────────────────────────────
//
// Shape mirrors what the Spanlens LangChain / LangGraph callback handler
// emits: a `chain.<node_name>` root + sequential nodes, a `chain.dispatch`
// node containing parallel fan-out branches (`chain.lookup_*`), each branch
// in turn wrapping its own llm / tool / retrieval children. The trace is the
// one the Graph view was designed for — toggling between Timeline and Graph
// on this trace is the demo "money shot".

const T_LANGGRAPH = N - 0.2 * 60_000

function lgSpan(
  id: string,
  parentId: string | null,
  name: string,
  spanType: SpanRow['span_type'],
  offsetMs: number,
  durationMs: number,
  extras: Partial<SpanRow> = {},
): SpanRow {
  return {
    id,
    parent_span_id: parentId,
    name,
    span_type: spanType,
    status: 'completed',
    started_at: ts(T_LANGGRAPH, offsetMs),
    ended_at: ts(T_LANGGRAPH, offsetMs + durationMs),
    duration_ms: durationMs,
    input: null,
    output: null,
    metadata: null,
    error_message: null,
    request_id: null,
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    cost_usd: null,
    ...extras,
  }
}

const DEMO_SPANS_LANGGRAPH: SpanRow[] = [
  lgSpan('lg-root', null, 'chain.agent_orchestrator', 'custom', 0, 3200, {
    input: { user_message: 'Where is my order #4421 and can I get a refund if it never arrived?' },
    output: { reply: 'Your order shipped Tuesday and is out for delivery today; let me know if it does not arrive by end of day and I will start the refund.', resolved: true },
  }),

  lgSpan('lg-classify', 'lg-root', 'chain.classify_intent', 'custom', 0, 450, {
    input: { user_message: 'Where is my order #4421 and can I get a refund if it never arrived?' },
    output: { intents: ['order_status', 'refund_policy'], confidence: 0.94 },
  }),
  lgSpan('lg-classify-llm', 'lg-classify', 'llm.ChatOpenAI', 'llm', 20, 410, {
    prompt_tokens: 280,
    completion_tokens: 24,
    total_tokens: 304,
    cost_usd: 0.0008,
    metadata: { model: 'gpt-4o-mini', provider: 'openai' },
  }),

  lgSpan('lg-dispatch', 'lg-root', 'chain.dispatch', 'custom', 450, 2700, {
    input: { intents: ['order_status', 'refund_policy'] },
    output: { branches_used: ['lookup_order', 'lookup_kb'], parallel: true },
  }),

  lgSpan('lg-order', 'lg-dispatch', 'chain.lookup_order', 'custom', 450, 1100),
  lgSpan('lg-order-tool', 'lg-order', 'tool.shopify_query', 'tool', 470, 840, {
    input: { order_id: '4421' },
    output: { status: 'out_for_delivery', shipped_at: '2026-05-30T09:21:00Z', carrier: 'UPS' },
  }),
  lgSpan('lg-order-llm', 'lg-order', 'llm.ChatOpenAI', 'llm', 1320, 220, {
    prompt_tokens: 412,
    completion_tokens: 31,
    total_tokens: 443,
    cost_usd: 0.0005,
    metadata: { model: 'gpt-4o-mini', provider: 'openai' },
  }),

  lgSpan('lg-kb', 'lg-dispatch', 'chain.lookup_kb', 'custom', 450, 2700),
  lgSpan('lg-kb-retrieval', 'lg-kb', 'retrieval.PineconeStore', 'retrieval', 470, 300, {
    input: { query: 'refund policy undelivered shipment', top_k: 5 },
    output: { docs: [{ id: 'kb-220', title: 'Refunds for undelivered orders', score: 0.93 }, { id: 'kb-118', title: 'Carrier disputes', score: 0.81 }] },
  }),
  lgSpan('lg-kb-llm', 'lg-kb', 'llm.ChatAnthropic', 'llm', 800, 2330, {
    prompt_tokens: 1320,
    completion_tokens: 540,
    total_tokens: 1860,
    cost_usd: 0.0023,
    metadata: { model: 'claude-haiku-4-5', provider: 'anthropic' },
  }),

  lgSpan('lg-compose', 'lg-root', 'chain.compose_final', 'custom', 3150, 40, {
    output: { reply: 'Your order shipped Tuesday and is out for delivery today; let me know if it does not arrive by end of day and I will start the refund.' },
  }),
]

export const DEMO_TRACE_LANGGRAPH_DETAIL: TraceDetail = {
  ...DEMO_TRACES[0]!,
  metadata: { user_id: 'u_demo_alice', session_id: 'sess_demo_1', environment: 'production', agent_version: '3.4.0' },
  api_key_id: 'demo-key-001',
  organization_id: 'demo-org-001',
  updated_at: ts(T_LANGGRAPH, 3200),
  spans: DEMO_SPANS_LANGGRAPH,
  // Critical path: root → classify → dispatch → lookup_kb (slowest branch)
  // → compose_final. The kb LLM call is the actual bottleneck inside the
  // branch and is highlighted alongside its chain ancestor.
  critical_span_ids: ['lg-root', 'lg-classify', 'lg-dispatch', 'lg-kb', 'lg-kb-llm', 'lg-compose'],
}

export const DEMO_TRACE_DETAILS: Record<string, TraceDetail> = {
  'demo-trace-langgraph': DEMO_TRACE_LANGGRAPH_DETAIL,
  'demo-trace-002': DEMO_TRACE_002_DETAIL,
  ...Object.fromEntries(
    DEMO_TRACES.filter((t) => t.id !== 'demo-trace-002' && t.id !== 'demo-trace-langgraph').map((t) => [t.id, makeSimpleDetail(t)]),
  ),
}

// ── Requests ──────────────────────────────────────────────────────────────────

export const DEMO_REQUESTS: RequestRow[] = [
  { id: 'req-001', provider: 'anthropic', model: 'claude-sonnet-4-5', prompt_tokens: 2800, completion_tokens: 680, total_tokens: 3480, cost_usd: 0.0472, latency_ms: 5640, status_code: 200, error_message: null, trace_id: 'demo-trace-002', span_id: 's002-llm', created_at: min(5), provider_key_name: 'Production Anthropic', user_id: 'u_alice', session_id: 'sess-aa1' },
  { id: 'req-002', provider: 'openai', model: 'gpt-4o-mini', prompt_tokens: 180, completion_tokens: 42, total_tokens: 222, cost_usd: 0.00014, latency_ms: 520, status_code: 200, error_message: null, trace_id: 'demo-trace-002', span_id: 's002-classify', created_at: min(5), provider_key_name: 'Production OpenAI', user_id: 'u_alice', session_id: 'sess-aa1' },
  { id: 'req-003', provider: 'openai', model: 'gpt-4o', prompt_tokens: 1240, completion_tokens: 380, total_tokens: 1620, cost_usd: 0.0243, latency_ms: 3100, status_code: 200, error_message: null, trace_id: 'demo-trace-003', span_id: null, created_at: min(12), provider_key_name: 'Production OpenAI', user_id: 'u_bob', session_id: 'sess-bb1' },
  { id: 'req-004', provider: 'anthropic', model: 'claude-haiku-4-5', prompt_tokens: 840, completion_tokens: 360, total_tokens: 1200, cost_usd: 0.0152, latency_ms: 2400, status_code: 200, error_message: null, trace_id: 'demo-trace-004', span_id: null, created_at: min(18), provider_key_name: 'Production Anthropic' },
  { id: 'req-005', provider: 'openai', model: 'gpt-4o', prompt_tokens: 3200, completion_tokens: 1800, total_tokens: 5000, cost_usd: 0.075, latency_ms: 8400, status_code: 200, error_message: null, trace_id: 'demo-trace-005', span_id: null, created_at: min(28), provider_key_name: 'Production OpenAI', user_id: 'u_charlie', session_id: 'sess-cc1' },
  { id: 'req-006', provider: 'openai', model: 'gpt-4o-mini', prompt_tokens: 420, completion_tokens: 200, total_tokens: 620, cost_usd: 0.00037, latency_ms: 1240, status_code: 429, error_message: 'Rate limit exceeded (429): You have exceeded your current quota for gpt-4o.', trace_id: 'demo-trace-006', span_id: null, created_at: min(45), provider_key_name: 'Production OpenAI' },
  { id: 'req-007', provider: 'anthropic', model: 'claude-sonnet-4-5', prompt_tokens: 2100, completion_tokens: 540, total_tokens: 2640, cost_usd: 0.0358, latency_ms: 4800, status_code: 200, error_message: null, trace_id: 'demo-trace-007', span_id: null, created_at: hrs(1.2), provider_key_name: 'Production Anthropic', user_id: 'u_alice', session_id: 'sess-aa2' },
  { id: 'req-008', provider: 'google', model: 'gemini-2.0-flash', prompt_tokens: 960, completion_tokens: 440, total_tokens: 1400, cost_usd: 0.00021, latency_ms: 980, status_code: 200, error_message: null, trace_id: null, span_id: null, created_at: hrs(1.5), provider_key_name: 'Production Gemini' },
  { id: 'req-009', provider: 'openai', model: 'gpt-4o', prompt_tokens: 1800, completion_tokens: 620, total_tokens: 2420, cost_usd: 0.0363, latency_ms: 5200, status_code: 200, error_message: null, trace_id: 'demo-trace-008', span_id: null, created_at: hrs(1.8), provider_key_name: 'Production OpenAI', user_id: 'u_bob', session_id: 'sess-bb1' },
  { id: 'req-010', provider: 'openai', model: 'gpt-4o-mini', prompt_tokens: 320, completion_tokens: 80, total_tokens: 400, cost_usd: 0.00024, latency_ms: 380, status_code: 200, error_message: null, trace_id: null, span_id: null, created_at: hrs(2.1), provider_key_name: 'Production OpenAI' },
  { id: 'req-011', provider: 'anthropic', model: 'claude-haiku-4-5', prompt_tokens: 640, completion_tokens: 280, total_tokens: 920, cost_usd: 0.0116, latency_ms: 1840, status_code: 200, error_message: null, trace_id: null, span_id: null, created_at: hrs(2.4), provider_key_name: 'Production Anthropic' },
  { id: 'req-012', provider: 'openai', model: 'gpt-4o', prompt_tokens: 2400, completion_tokens: 820, total_tokens: 3220, cost_usd: 0.0483, latency_ms: 6100, status_code: 200, error_message: null, trace_id: 'demo-trace-009', span_id: null, created_at: hrs(2.5), provider_key_name: 'Production OpenAI' },
  { id: 'req-013', provider: 'google', model: 'gemini-2.0-flash', prompt_tokens: 1200, completion_tokens: 480, total_tokens: 1680, cost_usd: 0.00025, latency_ms: 840, status_code: 200, error_message: null, trace_id: null, span_id: null, created_at: hrs(2.8), provider_key_name: 'Production Gemini' },
  { id: 'req-014', provider: 'openai', model: 'gpt-4o-mini', prompt_tokens: 560, completion_tokens: 140, total_tokens: 700, cost_usd: 0.00042, latency_ms: 620, status_code: 200, error_message: null, trace_id: null, span_id: null, created_at: hrs(3.0), provider_key_name: 'Production OpenAI' },
  { id: 'req-015', provider: 'anthropic', model: 'claude-sonnet-4-5', prompt_tokens: 3100, completion_tokens: 740, total_tokens: 3840, cost_usd: 0.0521, latency_ms: 7200, status_code: 200, error_message: null, trace_id: 'demo-trace-010', span_id: null, created_at: hrs(3.2), provider_key_name: 'Production Anthropic' },
  { id: 'req-016', provider: 'openai', model: 'gpt-4o', prompt_tokens: 980, completion_tokens: 340, total_tokens: 1320, cost_usd: 0.0198, latency_ms: 3800, status_code: 500, error_message: 'Internal server error', trace_id: null, span_id: null, created_at: hrs(3.6), provider_key_name: 'Production OpenAI' },
  { id: 'req-017', provider: 'openai', model: 'gpt-4o-mini', prompt_tokens: 280, completion_tokens: 68, total_tokens: 348, cost_usd: 0.00021, latency_ms: 340, status_code: 200, error_message: null, trace_id: null, span_id: null, created_at: hrs(4.0), provider_key_name: 'Production OpenAI' },
  { id: 'req-018', provider: 'anthropic', model: 'claude-haiku-4-5', prompt_tokens: 740, completion_tokens: 320, total_tokens: 1060, cost_usd: 0.0134, latency_ms: 2100, status_code: 200, error_message: null, trace_id: null, span_id: null, created_at: hrs(4.5), provider_key_name: 'Production Anthropic' },
  { id: 'req-019', provider: 'openai', model: 'gpt-4o', prompt_tokens: 1620, completion_tokens: 480, total_tokens: 2100, cost_usd: 0.0315, latency_ms: 4600, status_code: 200, error_message: null, trace_id: null, span_id: null, created_at: hrs(4.9), provider_key_name: 'Production OpenAI' },
  { id: 'req-020', provider: 'google', model: 'gemini-2.0-flash', prompt_tokens: 840, completion_tokens: 360, total_tokens: 1200, cost_usd: 0.00018, latency_ms: 720, status_code: 200, error_message: null, trace_id: null, span_id: null, created_at: hrs(5.2), provider_key_name: 'Production Gemini' },
]

export const DEMO_REQUEST_DETAILS: Record<string, RequestDetail> = {
  'req-001': {
    ...DEMO_REQUESTS[0]!,
    request_body: {
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: 'You are a helpful customer support agent for Acme Corp.' },
        { role: 'user', content: "I can't log into my account, it keeps saying 'invalid password'" },
      ],
    },
    response_body: {
      id: 'msg_01XmBDJLhV',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: "I've sent a password reset email to your registered address. The link expires in 30 minutes. If you don't see it, check your spam folder." }],
      model: 'claude-sonnet-4-5',
      stop_reason: 'end_turn',
      usage: { input_tokens: 2800, output_tokens: 680 },
    },
  },
  'req-006': {
    ...DEMO_REQUESTS[5]!,
    request_body: {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Draft a follow-up email for the Q2 sales pipeline.' }],
      temperature: 0.7,
    },
    response_body: {
      error: { type: 'requests', code: 'rate_limit_exceeded', message: 'You have exceeded your current quota for gpt-4o. Please try again in 10 seconds.' },
    },
  },
}

// Generate simple details for the rest
for (const req of DEMO_REQUESTS) {
  if (!DEMO_REQUEST_DETAILS[req.id]) {
    DEMO_REQUEST_DETAILS[req.id] = {
      ...req,
      request_body: {
        model: req.model,
        messages: [
          { role: 'system', content: 'You are a helpful AI assistant.' },
          { role: 'user', content: 'Process the following data and extract key insights.' },
        ],
        temperature: 0.3,
        max_tokens: 1024,
      },
      response_body: req.status_code >= 400
        ? { error: { type: 'error', message: req.error_message } }
        : {
            id: 'chatcmpl-' + req.id,
            object: 'chat.completion',
            choices: [{ message: { role: 'assistant', content: 'Here are the key insights extracted from the data...' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: req.prompt_tokens, completion_tokens: req.completion_tokens, total_tokens: req.total_tokens },
          },
    }
  }
}

// ── Dashboard Stats ───────────────────────────────────────────────────────────

export const DEMO_STATS_OVERVIEW: StatsOverview = {
  totalRequests: 2481,
  successRequests: 2396,
  errorRequests: 85,
  totalCostUsd: 84.21,
  totalTokens: 4_820_400,
  promptTokens: 3_614_200,
  completionTokens: 1_206_200,
  avgLatencyMs: 1840,
  errorRate: 3.43,
  requestsDelta: 18.2,
  costDelta: 22.4,
  latencyDelta: -7.8,
  errorRateDelta: 0.41,
}

function generateTimeseries(): TimeseriesPoint[] {
  const points: TimeseriesPoint[] = []
  for (let i = 23; i >= 0; i--) {
    const base = Math.round(95 + Math.sin(i * 0.4) * 20 + Math.random() * 10)
    const cost = parseFloat((base * 0.034 + Math.random() * 0.5).toFixed(3))
    points.push({
      date: new Date(N - i * 3_600_000).toISOString(),
      requests: base,
      cost,
      tokens: base * 1940,
      errors: Math.floor(base * 0.034),
    })
  }
  return points
}

export const DEMO_TIMESERIES: TimeseriesPoint[] = generateTimeseries()

export const DEMO_SPEND_FORECAST: SpendForecast = {
  monthToDate: 248.42,
  dayOfMonth: 4,
  daysInMonth: 31,
  dailyAvgUsd: 62.11,
  projectedMonthEndUsd: 1804.21,
  weeklyDeltaPct: 12.4,
  dailyTrendUsd: 2.18,
  timeseries: Array.from({ length: 31 }, (_, i) => ({
    date: new Date(N - (new Date().getDate() - 1 - i) * 86_400_000).toISOString().slice(0, 10),
    actual: i < 4 ? parseFloat((60 + i * 2.1 + Math.sin(i) * 4).toFixed(2)) : null,
    projected: i >= 3 ? parseFloat((61 + i * 2.2 + Math.sin(i) * 3).toFixed(2)) : null,
  })),
}

export const DEMO_MODELS = [
  { provider: 'openai', model: 'gpt-4o', requestCount: 842, totalCostUsd: 38.24 },
  { provider: 'anthropic', model: 'claude-sonnet-4-5', requestCount: 624, totalCostUsd: 29.84 },
  { provider: 'openai', model: 'gpt-4o-mini', requestCount: 748, totalCostUsd: 8.42 },
  { provider: 'anthropic', model: 'claude-haiku-4-5', requestCount: 182, totalCostUsd: 4.21 },
  { provider: 'google', model: 'gemini-2.0-flash', requestCount: 85, totalCostUsd: 0.98 },
]

export const DEMO_AUDIT_LOGS = [
  { id: 'al-001', action: 'alert.triggered', actor_email: 'system', created_at: min(8), metadata: { alert_name: 'Monthly Budget Alert' } },
  { id: 'al-002', action: 'anomaly.detected', actor_email: 'system', created_at: min(22), metadata: { kind: 'latency', model: 'claude-sonnet-4-5' } },
  { id: 'al-003', action: 'provider_key.created', actor_email: 'haeseong@acme.com', created_at: hrs(2.1), metadata: { provider: 'google' } },
  { id: 'al-004', action: 'prompt.created', actor_email: 'haeseong@acme.com', created_at: hrs(4.8), metadata: { name: 'email-classifier' } },
  { id: 'al-005', action: 'key.created', actor_email: 'haeseong@acme.com', created_at: day(1), metadata: {} },
  { id: 'al-006', action: 'billing.payment.succeeded', actor_email: 'system', created_at: day(3), metadata: { amount_usd: 120.00 } },
]

// ── Recommendations (Savings) ─────────────────────────────────────────────────

export const DEMO_RECOMMENDATIONS: ModelRecommendation[] = [
  {
    currentProvider: 'openai',
    currentModel: 'gpt-4o',
    sampleCount: 1240,
    avgPromptTokens: 480,
    avgCompletionTokens: 180,
    totalCostUsdLastNDays: 68.42,
    suggestedProvider: 'openai',
    suggestedModel: 'gpt-4o-mini',
    estimatedMonthlySavingsUsd: 412.10,
    reason: 'These calls average 480 prompt tokens with simple classification outputs (≤ 180 tokens). GPT-4o-mini handles this task class at ≥ 95% quality based on our benchmark suite.',
    maxPromptTokens: 500,
    maxCompletionTokens: 150,
    priorWindowCostUsd: null,
    achieved: false,
    actualMonthlySavingsUsd: null,
  },
  {
    currentProvider: 'anthropic',
    currentModel: 'claude-sonnet-4-5',
    sampleCount: 624,
    avgPromptTokens: 2800,
    avgCompletionTokens: 640,
    totalCostUsdLastNDays: 29.84,
    suggestedProvider: 'anthropic',
    suggestedModel: 'claude-haiku-4-5',
    estimatedMonthlySavingsUsd: 185.20,
    reason: 'Data extraction spans are structured (JSON output, fixed schema). Claude Haiku matches Sonnet on F1 score for this schema type while costing 5× less.',
    maxPromptTokens: 800,
    maxCompletionTokens: 250,
    priorWindowCostUsd: null,
    achieved: false,
    actualMonthlySavingsUsd: null,
  },
  {
    currentProvider: 'openai',
    currentModel: 'gpt-4o',
    sampleCount: 380,
    avgPromptTokens: 320,
    avgCompletionTokens: 85,
    totalCostUsdLastNDays: 5.48,    // post-switch spend (70% drop from prior)
    suggestedProvider: 'openai',
    suggestedModel: 'gpt-4o-mini',
    estimatedMonthlySavingsUsd: 94.80,
    reason: 'Intent classification calls are short and formulaic. Identical output distributions observed between gpt-4o and gpt-4o-mini across 380 sampled requests.',
    maxPromptTokens: 500,
    maxCompletionTokens: 150,
    priorWindowCostUsd: 18.24,      // pre-switch spend; dropPct ≈ 70%
    achieved: true,
    actualMonthlySavingsUsd: 54.70, // (18.24 - 5.48) × (30/7) ≈ 54.69
  },
  {
    currentProvider: 'openai',
    currentModel: 'gpt-4o',
    sampleCount: 210,
    avgPromptTokens: 180,
    avgCompletionTokens: 42,
    totalCostUsdLastNDays: 9.41,
    suggestedProvider: 'openai',
    suggestedModel: 'gpt-4o-mini',
    estimatedMonthlySavingsUsd: 67.30,
    reason: 'Sentiment scoring calls have consistent 1–5 integer outputs. A/B sampling on 210 requests shows identical distributions for both models on this task.',
    maxPromptTokens: 500,
    maxCompletionTokens: 150,
    priorWindowCostUsd: null,
    achieved: false,
    actualMonthlySavingsUsd: null,
  },
]

// ── Anomalies ─────────────────────────────────────────────────────────────────

export const DEMO_ANOMALIES: Anomaly[] = [
  {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    kind: 'latency',
    currentValue: 7840,
    baselineMean: 2180,
    baselineStdDev: 820,
    deviations: 6.9,
    sampleCount: 48,
    referenceCount: 1240,
    acknowledgedAt: null,
  },
  {
    provider: 'openai',
    model: 'gpt-4o',
    kind: 'cost',
    currentValue: 0.0812,
    baselineMean: 0.0341,
    baselineStdDev: 0.0084,
    deviations: 5.6,
    sampleCount: 84,
    referenceCount: 842,
    acknowledgedAt: null,
  },
  {
    provider: 'openai',
    model: 'gpt-4o-mini',
    kind: 'error_rate',
    currentValue: 0.142,
    baselineMean: 0.028,
    baselineStdDev: 0.012,
    deviations: 9.5,
    sampleCount: 120,
    referenceCount: 748,
    acknowledgedAt: null,
  },
  {
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    kind: 'cost',
    currentValue: 0.0284,
    baselineMean: 0.0198,
    baselineStdDev: 0.0041,
    deviations: 2.1,
    sampleCount: 62,
    referenceCount: 182,
    acknowledgedAt: hrs(2.4),
  },
]

export const DEMO_ANOMALY_HISTORY: AnomalyHistoryEntry[] = [
  { id: 'anh-001', detectedOn: day(2), provider: 'openai', model: 'gpt-4o', kind: 'latency', currentValue: 6200, baselineMean: 2100, baselineStdDev: 750, deviations: 5.5, sampleCount: 60, referenceCount: 920 },
  { id: 'anh-002', detectedOn: day(4), provider: 'anthropic', model: 'claude-sonnet-4-5', kind: 'cost', currentValue: 0.068, baselineMean: 0.032, baselineStdDev: 0.008, deviations: 4.5, sampleCount: 40, referenceCount: 580 },
  { id: 'anh-003', detectedOn: day(7), provider: 'openai', model: 'gpt-4o-mini', kind: 'error_rate', currentValue: 0.09, baselineMean: 0.024, baselineStdDev: 0.011, deviations: 6.0, sampleCount: 88, referenceCount: 640 },
  { id: 'anh-004', detectedOn: day(12), provider: 'google', model: 'gemini-2.0-flash', kind: 'latency', currentValue: 2800, baselineMean: 900, baselineStdDev: 280, deviations: 6.8, sampleCount: 24, referenceCount: 210 },
  { id: 'anh-005', detectedOn: day(18), provider: 'openai', model: 'gpt-4o', kind: 'cost', currentValue: 0.095, baselineMean: 0.038, baselineStdDev: 0.009, deviations: 6.3, sampleCount: 52, referenceCount: 760 },
]

// ── Alerts ────────────────────────────────────────────────────────────────────

export const DEMO_ALERTS: AlertRow[] = [
  {
    id: 'alert-001',
    name: 'Monthly Budget Alert',
    type: 'budget',
    threshold: 500,
    window_minutes: 43200,
    cooldown_minutes: 1440,
    is_active: true,
    last_triggered_at: min(8),
    project_id: null,
    created_at: day(14),
    updated_at: min(8),
  },
  {
    id: 'alert-002',
    name: 'High Error Rate',
    type: 'error_rate',
    threshold: 5,
    window_minutes: 60,
    cooldown_minutes: 30,
    is_active: true,
    last_triggered_at: hrs(3.8),
    project_id: null,
    created_at: day(10),
    updated_at: hrs(3.8),
  },
  {
    id: 'alert-003',
    name: 'Latency Degradation',
    type: 'latency_p95',
    threshold: 8000,
    window_minutes: 30,
    cooldown_minutes: 60,
    is_active: true,
    last_triggered_at: null,
    project_id: null,
    created_at: day(8),
    updated_at: day(8),
  },
  {
    id: 'alert-004',
    name: 'Daily Spend Limit',
    type: 'budget',
    threshold: 50,
    window_minutes: 1440,
    cooldown_minutes: 120,
    is_active: false,
    last_triggered_at: day(2),
    project_id: null,
    created_at: day(20),
    updated_at: day(2),
  },
]

export const DEMO_CHANNELS: NotificationChannelRow[] = [
  { id: 'ch-001', kind: 'email', target: 'haeseong@acme.com', label: null, is_active: true, created_at: day(14) },
  { id: 'ch-002', kind: 'slack', target: 'https://hooks.slack.com/services/T00000/B000000/XXXXXXXX', label: '#prod-alerts', is_active: true, created_at: day(10) },
]

export const DEMO_DELIVERIES: AlertDeliveryRow[] = [
  { id: 'del-001', alert_id: 'alert-001', channel_id: 'ch-001', status: 'sent', error_message: null, created_at: min(8) },
  { id: 'del-002', alert_id: 'alert-001', channel_id: 'ch-002', status: 'sent', error_message: null, created_at: min(8) },
  { id: 'del-003', alert_id: 'alert-002', channel_id: 'ch-001', status: 'sent', error_message: null, created_at: hrs(3.8) },
  { id: 'del-004', alert_id: 'alert-004', channel_id: 'ch-001', status: 'failed', error_message: 'Email delivery timeout', created_at: day(2) },
]

// ── Prompts ───────────────────────────────────────────────────────────────────

export const DEMO_PROMPTS: PromptVersion[] = [
  {
    id: 'pv-001',
    name: 'customer-support-v2',
    version: 7,
    versionCount: 7,
    content: 'You are a helpful customer support agent for {{company_name}}. Your goal is to resolve customer issues efficiently and empathetically.\n\nGuidelines:\n- Be concise and clear\n- Always verify the issue before suggesting solutions\n- Escalate to human if confidence < 0.8\n- Never share internal system details\n\nCustomer message: {{customer_message}}',
    variables: [
      { name: 'company_name', description: 'Company name', required: true },
      { name: 'customer_message', description: 'The customer\'s message', required: true },
    ],
    metadata: { model: 'claude-sonnet-4-5', temperature: 0.3 },
    project_id: null,
    created_at: day(5),
    created_by: 'haeseong@acme.com',
    is_archived: false,
    stats: { calls: 1240, totalCostUsd: 42.10, avgCostUsd: 0.034, avgLatencyMs: 4820, errorRate: 0.012 },
    qualityScore: 96,
    activeExperiment: null,
  },
  {
    id: 'pv-002',
    name: 'data-extraction',
    version: 3,
    versionCount: 3,
    content: 'Extract structured data from the following text and return valid JSON matching the schema.\n\nSchema: {{schema}}\n\nText to extract from:\n{{input_text}}\n\nReturn only valid JSON, no explanation.',
    variables: [
      { name: 'schema', description: 'JSON schema to extract into', required: true },
      { name: 'input_text', description: 'Raw text to extract from', required: true },
    ],
    metadata: { model: 'claude-haiku-4-5', temperature: 0.0 },
    project_id: null,
    created_at: day(12),
    created_by: 'haeseong@acme.com',
    is_archived: false,
    stats: { calls: 480, totalCostUsd: 28.40, avgCostUsd: 0.059, avgLatencyMs: 2840, errorRate: 0.058 },
    qualityScore: 88,
    activeExperiment: null,
  },
  {
    id: 'pv-003',
    name: 'email-classifier',
    version: 2,
    versionCount: 2,
    content: 'Classify the following email into one of these categories: {{categories}}\n\nReturn a JSON object with keys: category (string), confidence (0-1), reasoning (string).\n\nEmail:\n{{email_content}}',
    variables: [
      { name: 'categories', description: 'Comma-separated list of categories', required: true },
      { name: 'email_content', description: 'Email text to classify', required: true },
    ],
    metadata: { model: 'gpt-4o-mini', temperature: 0.0 },
    project_id: null,
    created_at: hrs(4.8),
    created_by: 'haeseong@acme.com',
    is_archived: false,
    stats: { calls: 840, totalCostUsd: 12.20, avgCostUsd: 0.0145, avgLatencyMs: 480, errorRate: 0.004 },
    qualityScore: 99,
    activeExperiment: { id: 'exp-001', trafficSplit: 70 },
  },
]

// ── Security ──────────────────────────────────────────────────────────────────

export const DEMO_SECURITY_SUMMARY: SecuritySummaryItem[] = [
  { type: 'pii', pattern: 'email', count: 12 },
  { type: 'pii', pattern: 'phone', count: 3 },
  { type: 'pii', pattern: 'credit-card', count: 1 },
  { type: 'injection', pattern: 'override', count: 2 },
  { type: 'injection', pattern: 'jailbreak', count: 1 },
]

export const DEMO_FLAGGED_REQUESTS: FlaggedRequest[] = [
  {
    id: 'req-flagged-001',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    status_code: 200,
    latency_ms: 4820,
    cost_usd: 0.0481,
    flags: [{ type: 'pii', pattern: 'email', sample: 'j***@example.com' }],
    response_flags: [],
    created_at: min(14),
  },
  {
    id: 'req-flagged-002',
    provider: 'openai',
    model: 'gpt-4o',
    status_code: 422,
    latency_ms: 0,
    cost_usd: null,
    flags: [{ type: 'injection', pattern: 'override', sample: 'Ignore previous instructions and...' }],
    response_flags: [],
    created_at: min(38),
  },
  {
    id: 'req-flagged-003',
    provider: 'openai',
    model: 'gpt-4o-mini',
    status_code: 200,
    latency_ms: 620,
    cost_usd: 0.00037,
    flags: [{ type: 'pii', pattern: 'phone', sample: '+82-10-****-4821' }, { type: 'pii', pattern: 'email', sample: 'k***@corp.co.kr' }],
    response_flags: [],
    created_at: hrs(1.4),
  },
  {
    id: 'req-flagged-004',
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    status_code: 422,
    latency_ms: 0,
    cost_usd: null,
    flags: [{ type: 'injection', pattern: 'jailbreak', sample: 'Act as DAN and...' }],
    response_flags: [],
    created_at: hrs(2.2),
  },
  {
    id: 'req-flagged-005',
    provider: 'openai',
    model: 'gpt-4o',
    status_code: 200,
    latency_ms: 5200,
    cost_usd: 0.0363,
    flags: [{ type: 'pii', pattern: 'credit-card', sample: '4*** **** **** 1234' }],
    response_flags: [],
    created_at: hrs(3.1),
  },
]

// ── Evals ────────────────────────────────────────────────────────────────────

const DEMO_ORG_ID = 'demo-org-001'

export const DEMO_EVALUATORS: Evaluator[] = [
  {
    id: 'ev-001',
    organization_id: DEMO_ORG_ID,
    prompt_name: 'customer-support-v2',
    name: 'Helpfulness',
    type: 'llm_judge',
    config: {
      criterion: 'Does the response clearly address the customer\'s issue and offer a concrete next step?',
      judge_provider: 'openai',
      judge_model: 'gpt-4o-mini',
      scale_min: 0,
      scale_max: 1,
    },
    created_by: 'demo-user',
    created_at: day(8),
    archived_at: null,
  },
  {
    id: 'ev-002',
    organization_id: DEMO_ORG_ID,
    prompt_name: 'customer-support-v2',
    name: 'Tone',
    type: 'llm_judge',
    config: {
      criterion: 'Is the response friendly, empathetic, and professional?',
      judge_provider: 'openai',
      judge_model: 'gpt-4o-mini',
      scale_min: 0,
      scale_max: 1,
    },
    created_by: 'demo-user',
    created_at: day(5),
    archived_at: null,
  },
  {
    id: 'ev-003',
    organization_id: DEMO_ORG_ID,
    prompt_name: 'data-extraction',
    name: 'JSON validity',
    type: 'llm_judge',
    config: {
      criterion: 'Is the output strictly valid JSON matching the requested schema?',
      judge_provider: 'anthropic',
      judge_model: 'claude-3-5-haiku-20241022',
      scale_min: 0,
      scale_max: 1,
    },
    created_by: 'demo-user',
    created_at: day(2),
    archived_at: null,
  },
]

export const DEMO_EVAL_RUNS: EvalRun[] = [
  {
    id: 'er-001',
    organization_id: DEMO_ORG_ID,
    evaluator_id: 'ev-001',
    prompt_version_id: 'pv-001',
    source: 'production',
    sample_size: 50,
    sample_from: day(7),
    sample_to: null,
    status: 'completed',
    scored_count: 48,
    avg_score: 0.81,
    total_cost_usd: 0.024,
    error: null,
    created_by: 'demo-user',
    started_at: day(1),
    completed_at: day(1),
  },
  {
    id: 'er-002',
    organization_id: DEMO_ORG_ID,
    evaluator_id: 'ev-001',
    prompt_version_id: 'pv-001',
    source: 'production',
    sample_size: 100,
    sample_from: day(3),
    sample_to: null,
    status: 'completed',
    scored_count: 96,
    avg_score: 0.84,
    total_cost_usd: 0.049,
    error: null,
    created_by: 'demo-user',
    started_at: hrs(6),
    completed_at: hrs(6),
  },
  {
    id: 'er-003',
    organization_id: DEMO_ORG_ID,
    evaluator_id: 'ev-002',
    prompt_version_id: 'pv-001',
    source: 'production',
    sample_size: 50,
    sample_from: day(7),
    sample_to: null,
    status: 'completed',
    scored_count: 50,
    avg_score: 0.92,
    total_cost_usd: 0.025,
    error: null,
    created_by: 'demo-user',
    started_at: hrs(3),
    completed_at: hrs(3),
  },
  {
    id: 'er-004',
    organization_id: DEMO_ORG_ID,
    evaluator_id: 'ev-003',
    prompt_version_id: 'pv-002',
    source: 'production',
    sample_size: 30,
    sample_from: day(2),
    sample_to: null,
    status: 'completed',
    scored_count: 28,
    avg_score: 0.71,
    total_cost_usd: 0.013,
    error: null,
    created_by: 'demo-user',
    started_at: hrs(1),
    completed_at: hrs(1),
  },
]

// Helper: generate a distribution of scores around an average.
function genScores(n: number, avg: number, spread = 0.15): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const jitter = (Math.sin(i * 1.7) + Math.cos(i * 2.3)) * spread * 0.5
    out.push(Math.max(0, Math.min(1, avg + jitter)))
  }
  return out
}

const REASONS_GOOD = [
  'Clear, actionable response with specific steps.',
  'Friendly tone, addresses the user\'s emotion appropriately.',
  'Accurate diagnosis followed by a concrete recommendation.',
  'Concise and respects the user\'s time.',
]
const REASONS_BAD = [
  'Response is vague, no concrete next step suggested.',
  'Generic apology, doesn\'t actually answer the question.',
  'Tone is too formal for the casual customer message.',
  'Response is overly long with redundant context.',
]

export const DEMO_EVAL_RESULTS: Record<string, EvalResult[]> = {
  'er-001': genScores(48, 0.81).map((score, i) => ({
    id: `eres-001-${i}`,
    eval_run_id: 'er-001',
    request_id: `req-${1000 + i}`,
    dataset_item_id: null,
    score,
    reasoning: score >= 0.65
      ? REASONS_GOOD[i % REASONS_GOOD.length] ?? null
      : REASONS_BAD[i % REASONS_BAD.length] ?? null,
    judge_cost_usd: 0.0005,
    judge_tokens: 380,
    created_at: day(1),
  })),
  'er-002': genScores(96, 0.84).map((score, i) => ({
    id: `eres-002-${i}`,
    eval_run_id: 'er-002',
    request_id: `req-${2000 + i}`,
    dataset_item_id: null,
    score,
    reasoning: score >= 0.65
      ? REASONS_GOOD[i % REASONS_GOOD.length] ?? null
      : REASONS_BAD[i % REASONS_BAD.length] ?? null,
    judge_cost_usd: 0.0005,
    judge_tokens: 410,
    created_at: hrs(6),
  })),
  'er-003': genScores(50, 0.92, 0.1).map((score, i) => ({
    id: `eres-003-${i}`,
    eval_run_id: 'er-003',
    request_id: `req-${3000 + i}`,
    dataset_item_id: null,
    score,
    reasoning: REASONS_GOOD[i % REASONS_GOOD.length] ?? null,
    judge_cost_usd: 0.0005,
    judge_tokens: 360,
    created_at: hrs(3),
  })),
  'er-004': genScores(28, 0.71, 0.2).map((score, i) => ({
    id: `eres-004-${i}`,
    eval_run_id: 'er-004',
    request_id: `req-${4000 + i}`,
    dataset_item_id: null,
    score,
    reasoning: score >= 0.65
      ? 'Output is valid JSON and matches the schema.'
      : 'Output contains markdown fences or extra commentary outside JSON.',
    judge_cost_usd: 0.0004,
    judge_tokens: 340,
    created_at: hrs(1),
  })),
}

// ── Datasets ─────────────────────────────────────────────────────────────────

export const DEMO_DATASETS: Dataset[] = [
  {
    id: 'ds-001',
    organization_id: DEMO_ORG_ID,
    name: 'Support golden set',
    description: '30 previously-failed customer support cases + 20 typical interactions',
    created_by: 'demo-user',
    created_at: day(14),
    archived_at: null,
    item_count: 50,
  },
  {
    id: 'ds-002',
    organization_id: DEMO_ORG_ID,
    name: 'Extraction edge cases',
    description: 'Malformed inputs that previously broke JSON extraction',
    created_by: 'demo-user',
    created_at: day(6),
    archived_at: null,
    item_count: 24,
  },
  {
    id: 'ds-003',
    organization_id: DEMO_ORG_ID,
    name: 'Email triage smoke test',
    description: 'Quick sanity check before deploying classifier changes',
    created_by: 'demo-user',
    created_at: day(2),
    archived_at: null,
    item_count: 15,
  },
]

const SUPPORT_ITEMS: DatasetItem[] = [
  {
    id: 'di-001',
    organization_id: DEMO_ORG_ID,
    dataset_id: 'ds-001',
    input: { messages: [{ role: 'user', content: 'I was charged twice for the same order #ORD-4521.' }] },
    expected_output: 'I see two charges for order #ORD-4521. I\'ve refunded the duplicate charge, it should appear in 3–5 business days. Sorry for the inconvenience!',
    source_request_id: 'req-1042',
    created_at: day(14),
  },
  {
    id: 'di-002',
    organization_id: DEMO_ORG_ID,
    dataset_id: 'ds-001',
    input: { messages: [{ role: 'user', content: 'Reset my password please' }] },
    expected_output: 'I can send you a password reset link. What email address is associated with your account?',
    source_request_id: null,
    created_at: day(14),
  },
  {
    id: 'di-003',
    organization_id: DEMO_ORG_ID,
    dataset_id: 'ds-001',
    input: { messages: [{ role: 'user', content: 'Your product is terrible and your support is even worse' }] },
    expected_output: 'I\'m really sorry to hear about your experience. Could you share what went wrong? I want to make sure we fix this for you.',
    source_request_id: 'req-1019',
    created_at: day(12),
  },
  {
    id: 'di-004',
    organization_id: DEMO_ORG_ID,
    dataset_id: 'ds-001',
    input: { variables: { customer_message: 'How do I cancel my subscription?', company_name: 'Acme Corp' } },
    expected_output: 'You can cancel anytime from Settings → Billing → Cancel subscription. Need help finding it?',
    source_request_id: null,
    created_at: day(10),
  },
  {
    id: 'di-005',
    organization_id: DEMO_ORG_ID,
    dataset_id: 'ds-001',
    input: { messages: [{ role: 'user', content: 'Where is my order?' }] },
    expected_output: 'Could you share your order number? I\'ll check the shipping status for you right away.',
    source_request_id: null,
    created_at: day(9),
  },
]

export const DEMO_DATASET_DETAILS: Record<string, DatasetWithItems> = {
  'ds-001': { ...DEMO_DATASETS[0]!, items: SUPPORT_ITEMS },
  'ds-002': {
    ...DEMO_DATASETS[1]!,
    items: [
      {
        id: 'di-101',
        organization_id: DEMO_ORG_ID,
        dataset_id: 'ds-002',
        input: { variables: { schema: '{"name": "string"}', input_text: 'Name: 田中 太郎\nEmail: not@an@email' } },
        expected_output: '{"name": "田中 太郎"}',
        source_request_id: null,
        created_at: day(6),
      },
      {
        id: 'di-102',
        organization_id: DEMO_ORG_ID,
        dataset_id: 'ds-002',
        input: { variables: { schema: '{"price": "number"}', input_text: 'about $19.99 maybe more' } },
        expected_output: '{"price": 19.99}',
        source_request_id: null,
        created_at: day(5),
      },
    ],
  },
  'ds-003': {
    ...DEMO_DATASETS[2]!,
    items: [
      {
        id: 'di-201',
        organization_id: DEMO_ORG_ID,
        dataset_id: 'ds-003',
        input: { variables: { categories: 'spam,sales,support,billing', email_content: 'CONGRATS!! You won...' } },
        expected_output: '{"category": "spam", "confidence": 0.98, "reasoning": "All caps + reward language"}',
        source_request_id: null,
        created_at: day(2),
      },
    ],
  },
}

// ── Experiments ──────────────────────────────────────────────────────────────

export const DEMO_EXPERIMENTS: Experiment[] = [
  {
    id: 'exp-001',
    organization_id: DEMO_ORG_ID,
    name: 'Support v6 vs v7',
    prompt_name: 'customer-support-v2',
    version_a_id: 'pv-001-v6',
    version_b_id: 'pv-001',
    dataset_id: 'ds-001',
    evaluator_id: 'ev-001',
    run_provider: 'openai',
    run_model: 'gpt-4o-mini',
    status: 'completed',
    total_items: 50,
    completed_items: 50,
    avg_score_a: 0.76,
    avg_score_b: 0.84,
    total_cost_usd: 0.18,
    error: null,
    created_by: 'demo-user',
    started_at: day(2),
    completed_at: day(2),
  },
  {
    id: 'exp-002',
    organization_id: DEMO_ORG_ID,
    name: 'Extraction haiku vs sonnet',
    prompt_name: 'data-extraction',
    version_a_id: 'pv-002',
    version_b_id: 'pv-002-v4',
    dataset_id: 'ds-002',
    evaluator_id: 'ev-003',
    run_provider: 'anthropic',
    run_model: 'claude-3-5-haiku-20241022',
    status: 'completed',
    total_items: 24,
    completed_items: 24,
    avg_score_a: 0.68,
    avg_score_b: 0.71,
    total_cost_usd: 0.09,
    error: null,
    created_by: 'demo-user',
    started_at: hrs(8),
    completed_at: hrs(8),
  },
  {
    id: 'exp-003',
    organization_id: DEMO_ORG_ID,
    name: 'Classifier prompt tweak',
    prompt_name: 'email-classifier',
    version_a_id: 'pv-003',
    version_b_id: 'pv-003-v3',
    dataset_id: 'ds-003',
    evaluator_id: null,
    run_provider: 'openai',
    run_model: 'gpt-4o-mini',
    status: 'running',
    total_items: 15,
    completed_items: 8,
    avg_score_a: null,
    avg_score_b: null,
    total_cost_usd: 0.011,
    error: null,
    created_by: 'demo-user',
    started_at: min(4),
    completed_at: null,
  },
]

export const DEMO_EXPERIMENT_RESULTS: Record<string, ExperimentResult[]> = {
  'exp-001': SUPPORT_ITEMS.map((item, i) => {
    const scoreA = Math.max(0, Math.min(1, 0.76 + Math.sin(i * 2.1) * 0.18))
    const scoreB = Math.max(0, Math.min(1, 0.84 + Math.cos(i * 1.5) * 0.12))
    return {
      id: `eres-exp-${i}`,
      experiment_id: 'exp-001',
      dataset_item_id: item.id,
      output_a: i === 0
        ? 'I\'m sorry to hear that. Please contact billing@acme.com with your order number and we\'ll look into the duplicate charge.'
        : `[v6 response to "${item.input.messages?.[0]?.content?.slice(0, 40)}…"]`,
      output_b: i === 0
        ? 'I see two charges for order #ORD-4521 on your account. I\'ve initiated a refund for the duplicate charge, it should appear in 3-5 business days. Anything else I can help with?'
        : `[v7 response to "${item.input.messages?.[0]?.content?.slice(0, 40)}…"]`,
      cost_a_usd: 0.0015,
      cost_b_usd: 0.0019,
      latency_a_ms: 1850,
      latency_b_ms: 2240,
      tokens_a: 180,
      tokens_b: 240,
      score_a: scoreA,
      score_b: scoreB,
      reasoning_a: 'Generic acknowledgment without taking action.',
      reasoning_b: 'Acknowledges issue + concrete refund action.',
      error_a: null,
      error_b: null,
      created_at: day(2),
      dataset_items: { input: item.input, expected_output: item.expected_output },
    }
  }),
}

// ── Annotation (human evals) ─────────────────────────────────────────────────

const QUEUE_BASE_REQUESTS = [
  {
    id: 'req-anno-001',
    prompt_version_id: 'pv-001',
    prompt_name: 'customer-support-v2',
    prompt_version: 7,
    model: 'claude-sonnet-4-5',
    user_msg: 'Hi, I\'ve been charged twice for the same subscription this month. Can you help?',
    response: 'I see two charges on your account from yesterday. I\'ve refunded the duplicate, it should reflect in your bank within 3-5 business days. Sorry for the trouble!',
    llm_judge_score: 0.92,
    human_score: 0.75,
    human_raw: 4,
    human_comment: 'Friendly and direct. Could mention if the customer needs to do anything.',
    age_min: 12,
  },
  {
    id: 'req-anno-002',
    prompt_version_id: 'pv-001',
    prompt_name: 'customer-support-v2',
    prompt_version: 7,
    model: 'claude-sonnet-4-5',
    user_msg: 'Your support is useless, I want a refund NOW',
    response: 'I\'m really sorry to hear about your experience. Could you tell me what went wrong so I can make it right? I\'ll personally make sure we resolve this.',
    llm_judge_score: 0.88,
    human_score: null,
    human_raw: null,
    human_comment: null,
    age_min: 28,
  },
  {
    id: 'req-anno-003',
    prompt_version_id: 'pv-002',
    prompt_name: 'data-extraction',
    prompt_version: 3,
    model: 'claude-haiku-4-5',
    user_msg: 'Extract: "John Smith, $4,200.50, due 2025-01-15"',
    response: '```json\n{"name": "John Smith", "amount": 4200.50, "due_date": "2025-01-15"}\n```',
    llm_judge_score: 0.42,
    human_score: 0.0,
    human_raw: 1,
    human_comment: 'Has markdown fences, instructions were "return only valid JSON, no explanation". Fence breaks downstream parsers.',
    age_min: 45,
  },
  {
    id: 'req-anno-004',
    prompt_version_id: 'pv-003',
    prompt_name: 'email-classifier',
    prompt_version: 2,
    model: 'gpt-4o-mini',
    user_msg: 'Subject: 50% OFF EVERYTHING, Last chance!',
    response: '{"category": "spam", "confidence": 0.94, "reasoning": "Promotional language + urgency"}',
    llm_judge_score: 0.95,
    human_score: 1.0,
    human_raw: 5,
    human_comment: 'Spot on.',
    age_min: 90,
  },
  {
    id: 'req-anno-005',
    prompt_version_id: 'pv-001',
    prompt_name: 'customer-support-v2',
    prompt_version: 7,
    model: 'claude-sonnet-4-5',
    user_msg: 'How do I delete my account?',
    response: 'You can delete your account from Settings → Account → Delete account. Note that this action is irreversible and all your data will be permanently removed.',
    llm_judge_score: 0.78,
    human_score: null,
    human_raw: null,
    human_comment: null,
    age_min: 180,
  },
  {
    id: 'req-anno-006',
    prompt_version_id: 'pv-002',
    prompt_name: 'data-extraction',
    prompt_version: 3,
    model: 'claude-haiku-4-5',
    user_msg: 'Extract amount from: "approximately 19 bucks"',
    response: '{"amount": null, "note": "amount is ambiguous"}',
    llm_judge_score: 0.35,
    human_score: 0.75,
    human_raw: 4,
    human_comment: 'Actually correct behavior, "approximately" is vague. Judge undervalued this.',
    age_min: 240,
  },
]

export const DEMO_ANNOTATION_QUEUE: AnnotationQueueItem[] = QUEUE_BASE_REQUESTS.map((q) => ({
  id: q.id,
  prompt_version_id: q.prompt_version_id,
  prompt_name: q.prompt_name,
  prompt_version: q.prompt_version,
  model: q.model,
  created_at: min(q.age_min),
  request_body: { messages: [{ role: 'user', content: q.user_msg }] } as Record<string, unknown>,
  response_body: { choices: [{ message: { content: q.response } }] } as Record<string, unknown>,
  llm_judge_score: q.llm_judge_score,
  human_eval: q.human_score != null
    ? { score: q.human_score, raw_score: q.human_raw, comment: q.human_comment }
    : null,
}))

// Correlation pairs derived from queue items that have BOTH scores.
export const DEMO_CORRELATION_PAIRS: Record<string, CorrelationPair[]> = {
  'customer-support-v2': QUEUE_BASE_REQUESTS
    .filter((q) => q.prompt_name === 'customer-support-v2' && q.human_score != null)
    .map((q) => ({ requestId: q.id, judgeScore: q.llm_judge_score ?? 0, humanScore: q.human_score ?? 0 })),
  'data-extraction': QUEUE_BASE_REQUESTS
    .filter((q) => q.prompt_name === 'data-extraction' && q.human_score != null)
    .map((q) => ({ requestId: q.id, judgeScore: q.llm_judge_score ?? 0, humanScore: q.human_score ?? 0 })),
  'email-classifier': QUEUE_BASE_REQUESTS
    .filter((q) => q.prompt_name === 'email-classifier' && q.human_score != null)
    .map((q) => ({ requestId: q.id, judgeScore: q.llm_judge_score ?? 0, humanScore: q.human_score ?? 0 })),
}
