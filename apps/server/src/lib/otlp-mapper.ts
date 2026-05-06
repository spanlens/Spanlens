/**
 * OTLP/HTTP JSON → Spanlens spans mapper.
 *
 * Supports the gen_ai.* semantic convention family (OpenTelemetry GenAI SemConv).
 * OTel JSON serialises fixed64 (nanoseconds) as strings, so we parse them carefully.
 *
 * JSON field names: OTel SDK exporters typically use camelCase
 * (startTimeUnixNano, spanId, …), but the proto JSON mapping spec also
 * allows snake_case (start_time_unix_nano). We accept both.
 *
 * Reference:
 *   https://opentelemetry.io/docs/specs/otlp/
 *   https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/
 */

import { calculateCost } from './cost.js'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface OtlpSpan {
  // Proto3 camelCase (most SDKs)
  traceId?: string
  spanId?: string
  parentSpanId?: string
  name?: string
  kind?: number
  startTimeUnixNano?: string | number
  endTimeUnixNano?: string | number
  attributes?: OtlpKeyValue[]
  status?: { code?: number; message?: string }
  // Proto JSON snake_case alternative
  trace_id?: string
  span_id?: string
  parent_span_id?: string
  start_time_unix_nano?: string | number
  end_time_unix_nano?: string | number
}

export interface OtlpKeyValue {
  key: string
  value: OtlpAnyValue
}

export interface OtlpAnyValue {
  stringValue?: string
  intValue?: string | number
  doubleValue?: number
  boolValue?: boolean
  arrayValue?: { values?: OtlpAnyValue[] }
  kvlistValue?: { values?: OtlpKeyValue[] }
}

export interface OtlpResource {
  attributes?: OtlpKeyValue[]
}

export interface OtlpScopeSpans {
  scope?: { name?: string; version?: string }
  spans?: OtlpSpan[]
}

export interface OtlpResourceSpans {
  resource?: OtlpResource
  scopeSpans?: OtlpScopeSpans[]
  scope_spans?: OtlpScopeSpans[]
}

export interface OtlpExportRequest {
  resourceSpans?: OtlpResourceSpans[]
  resource_spans?: OtlpResourceSpans[]
}

// Mapped row ready for Supabase INSERT
export interface MappedSpanRow {
  trace_id: string           // our UUID (set after trace upsert)
  organization_id: string
  name: string
  span_type: string
  status: string
  started_at: string
  ended_at: string | null
  duration_ms: number | null
  input: unknown
  output: unknown
  error_message: string | null
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cost_usd: number | null
  metadata: Record<string, unknown> | null
  external_span_id: string | null
  external_parent_span_id: string | null
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Unpack OTel AnyValue to a plain JS value. */
export function unpackAnyValue(v: OtlpAnyValue | undefined): unknown {
  if (v == null) return null
  if (v.stringValue !== undefined) return v.stringValue
  // intValue comes as a string in JSON (int64 → string to avoid precision loss)
  if (v.intValue !== undefined) return Number(v.intValue)
  if (v.doubleValue !== undefined) return v.doubleValue
  if (v.boolValue !== undefined) return v.boolValue
  if (v.arrayValue !== undefined) {
    return (v.arrayValue.values ?? []).map(unpackAnyValue)
  }
  if (v.kvlistValue !== undefined) {
    return Object.fromEntries(
      (v.kvlistValue.values ?? []).map((kv) => [kv.key, unpackAnyValue(kv.value)]),
    )
  }
  return null
}

/** Unpack OTel KeyValue[] into a plain Record. */
export function unpackAttributes(attrs: OtlpKeyValue[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const kv of attrs ?? []) {
    out[kv.key] = unpackAnyValue(kv.value)
  }
  return out
}

/** Convert nanosecond timestamp (string | number) to ISO string. */
function nanoToIso(nano: string | number | undefined): string | null {
  if (nano == null) return null
  const ms = Number(nano) / 1_000_000
  if (!isFinite(ms) || ms <= 0) return null
  return new Date(ms).toISOString()
}

/** Compute duration_ms from start/end nano timestamps. */
function nanoDuration(span: OtlpSpan): number | null {
  const startNano = span.startTimeUnixNano ?? span.start_time_unix_nano
  const endNano   = span.endTimeUnixNano   ?? span.end_time_unix_nano
  if (startNano == null || endNano == null) return null
  const ms = (Number(endNano) - Number(startNano)) / 1_000_000
  return ms > 0 ? Math.round(ms) : null
}

/** Map gen_ai.operation.name → Spanlens span_type. */
function inferSpanType(attrs: Record<string, unknown>): string {
  const op = attrs['gen_ai.operation.name']
  if (op === 'chat' || op === 'text_completion' || op === 'generate_content') return 'llm'
  if (op === 'execute_tool') return 'tool'
  if (op === 'embeddings') return 'embedding'
  if (op === 'retrieval') return 'retrieval'
  return 'custom'
}

/** Map known gen_ai.* attrs to metadata — only keep known keys, rest in a nested 'extra'. */
function buildMetadata(attrs: Record<string, unknown>): Record<string, unknown> | null {
  const known: Record<string, string> = {
    'gen_ai.operation.name': 'operation',
    'gen_ai.provider.name': 'provider',
    'gen_ai.request.model': 'model',
    'gen_ai.response.model': 'response_model',
    'gen_ai.request.temperature': 'temperature',
    'gen_ai.request.max_tokens': 'max_tokens',
    'gen_ai.request.top_p': 'top_p',
    'gen_ai.response.finish_reasons': 'finish_reasons',
    'gen_ai.response.id': 'response_id',
    'gen_ai.tool.name': 'tool_name',
    'gen_ai.tool.call.id': 'tool_call_id',
    'gen_ai.tool.type': 'tool_type',
    'gen_ai.tool.description': 'tool_description',
    'gen_ai.system_instructions': 'system_instructions',
    'gen_ai.conversation.id': 'conversation_id',
  }
  const meta: Record<string, unknown> = {}
  for (const [attrKey, metaKey] of Object.entries(known)) {
    if (attrs[attrKey] != null) meta[metaKey] = attrs[attrKey]
  }
  return Object.keys(meta).length > 0 ? meta : null
}

// ── Main mapper ────────────────────────────────────────────────────────────────

export function mapOtlpSpan(
  span: OtlpSpan,
  traceUuid: string,
  orgId: string,
): MappedSpanRow {
  const attrs = unpackAttributes(span.attributes)

  const spanType = inferSpanType(attrs)
  const statusCode = span.status?.code ?? 0
  // OTel status: 0=UNSET, 1=OK, 2=ERROR
  const spanStatus = statusCode === 2 ? 'error' : 'completed'

  const startNano = span.startTimeUnixNano ?? span.start_time_unix_nano
  const endNano   = span.endTimeUnixNano   ?? span.end_time_unix_nano
  const startedAt = nanoToIso(startNano) ?? new Date().toISOString()
  const endedAt   = nanoToIso(endNano)

  const promptTokens     = typeof attrs['gen_ai.usage.input_tokens']  === 'number' ? attrs['gen_ai.usage.input_tokens']  : 0
  const completionTokens = typeof attrs['gen_ai.usage.output_tokens'] === 'number' ? attrs['gen_ai.usage.output_tokens'] : 0
  const totalTokens      = promptTokens + completionTokens

  // Attempt cost calculation using provider + model
  const provider = typeof attrs['gen_ai.provider.name'] === 'string' ? attrs['gen_ai.provider.name'] : ''
  const model    = typeof attrs['gen_ai.request.model'] === 'string'  ? attrs['gen_ai.request.model']  :
                   typeof attrs['gen_ai.response.model'] === 'string' ? attrs['gen_ai.response.model'] : ''
  let costUsd: number | null = null
  if (model && (promptTokens > 0 || completionTokens > 0)) {
    const result = calculateCost(
      provider as 'openai' | 'anthropic' | 'gemini',
      model,
      { promptTokens, completionTokens },
    )
    costUsd = result?.totalCost ?? null
  }

  // input/output from gen_ai attributes
  const input  = attrs['gen_ai.input.messages']      ?? attrs['gen_ai.tool.call.arguments'] ?? null
  const output = attrs['gen_ai.output.messages']     ?? attrs['gen_ai.tool.call.result']    ?? null

  const externalSpanId       = span.spanId       ?? span.span_id       ?? null
  const externalParentSpanId = (span.parentSpanId ?? span.parent_span_id ?? '') || null

  return {
    trace_id:    traceUuid,
    organization_id: orgId,
    name:        span.name ?? 'unknown',
    span_type:   spanType,
    status:      spanStatus,
    started_at:  startedAt,
    ended_at:    endedAt,
    duration_ms: nanoDuration(span),
    input:       input as unknown,
    output:      output as unknown,
    error_message: spanStatus === 'error' ? (span.status?.message ?? 'error') : null,
    prompt_tokens:     promptTokens,
    completion_tokens: completionTokens,
    total_tokens:      totalTokens,
    cost_usd:    costUsd,
    metadata:    buildMetadata(attrs),
    external_span_id:        externalSpanId,
    external_parent_span_id: externalParentSpanId,
  }
}

// ── Batch extraction ───────────────────────────────────────────────────────────

/** Extract all spans from an OTLP ExportTraceServiceRequest body grouped by external trace ID. */
export function groupByTrace(
  body: OtlpExportRequest,
): Map<string, OtlpSpan[]> {
  const groups = new Map<string, OtlpSpan[]>()

  const resourceSpans = body.resourceSpans ?? body.resource_spans ?? []
  for (const rs of resourceSpans) {
    const scopeSpans = rs.scopeSpans ?? rs.scope_spans ?? []
    for (const ss of scopeSpans) {
      for (const span of ss.spans ?? []) {
        const traceId = span.traceId ?? span.trace_id
        if (!traceId) continue
        const bucket = groups.get(traceId) ?? []
        bucket.push(span)
        groups.set(traceId, bucket)
      }
    }
  }

  return groups
}

/** Derive a trace name from the root span (no parentSpanId) or fallback. */
export function inferTraceName(spans: OtlpSpan[]): string {
  const knownSpanIds = new Set(spans.map((s) => s.spanId ?? s.span_id).filter(Boolean))
  const root = spans.find((s) => {
    const parentId = s.parentSpanId ?? s.parent_span_id
    return !parentId || !knownSpanIds.has(parentId)
  })
  return root?.name ?? 'otel-trace'
}

/** Find minimum start time across spans (ISO string). */
export function minStartTime(spans: OtlpSpan[]): string {
  let min = Infinity
  for (const s of spans) {
    const n = Number(s.startTimeUnixNano ?? s.start_time_unix_nano ?? 0)
    if (n > 0 && n < min) min = n
  }
  return min === Infinity ? new Date().toISOString() : new Date(min / 1_000_000).toISOString()
}

/** Find maximum end time across spans (ISO string or null). */
export function maxEndTime(spans: OtlpSpan[]): string | null {
  let max = 0
  for (const s of spans) {
    const n = Number(s.endTimeUnixNano ?? s.end_time_unix_nano ?? 0)
    if (n > max) max = n
  }
  return max > 0 ? new Date(max / 1_000_000).toISOString() : null
}
