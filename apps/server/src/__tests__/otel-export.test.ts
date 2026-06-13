import { describe, expect, test } from 'vitest'
import { traceToOtlp, type SpanlensTrace, type SpanlensSpan } from '../lib/otel-export.js'

/**
 * Pin the OTLP HTTP/JSON envelope shape against the OpenTelemetry spec
 * + the gen_ai semantic conventions. A backend that rejects this output
 * is a regression — every OTLP-aware tool we care about (Datadog,
 * Honeycomb, Jaeger, Tempo, Grafana, OTel Collector) accepts it.
 */

const TRACE: SpanlensTrace = {
  id: '015a5187-d896-40b4-bef8-7d2b2d18c81d',
  name: 'support_chat',
  status: 'completed',
  started_at: '2026-06-12T10:00:00.000Z',
  ended_at: '2026-06-12T10:00:01.500Z',
  metadata: { user_id: 'u_42' },
}

const LLM_SPAN: SpanlensSpan = {
  id: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
  parent_span_id: null,
  name: 'gpt-4o.chat',
  span_type: 'llm',
  status: 'completed',
  started_at: '2026-06-12T10:00:00.500Z',
  ended_at: '2026-06-12T10:00:01.200Z',
  metadata: { provider: 'openai', model: 'gpt-4o' },
  prompt_tokens: 150,
  completion_tokens: 80,
  total_tokens: 230,
  cost_usd: 0.001175,
}

describe('traceToOtlp — envelope shape', () => {
  test('top-level structure matches OTLP HTTP/JSON spec', () => {
    const out = traceToOtlp(TRACE, [LLM_SPAN])
    expect(out.resourceSpans).toHaveLength(1)
    const rs = out.resourceSpans[0]!
    expect(rs.scopeSpans).toHaveLength(1)
    expect(rs.scopeSpans[0]!.scope).toEqual({ name: 'spanlens', version: '1.0.0' })
    expect(rs.scopeSpans[0]!.spans).toHaveLength(1)
  })

  test('resource attributes include the required service.name', () => {
    const out = traceToOtlp(TRACE, [LLM_SPAN])
    const attrs = out.resourceSpans[0]!.resource.attributes
    const serviceName = attrs.find((a) => a.key === 'service.name')
    expect(serviceName).toBeDefined()
    expect(serviceName!.value).toEqual({ stringValue: 'spanlens' })
  })
})

describe('traceToOtlp — span id encoding', () => {
  test('traceId is 32 lowercase hex chars (16 bytes) with dashes stripped', () => {
    const out = traceToOtlp(TRACE, [LLM_SPAN])
    const span = out.resourceSpans[0]!.scopeSpans[0]!.spans[0]!
    expect(span.traceId).toBe('015a5187d89640b4bef87d2b2d18c81d')
    expect(span.traceId).toMatch(/^[a-f0-9]{32}$/)
  })

  test('spanId is the leading 16 hex chars (8 bytes) of the UUID', () => {
    const out = traceToOtlp(TRACE, [LLM_SPAN])
    const span = out.resourceSpans[0]!.scopeSpans[0]!.spans[0]!
    expect(span.spanId).toBe('a1b2c3d4e5f67890')
    expect(span.spanId).toMatch(/^[a-f0-9]{16}$/)
  })

  test('parentSpanId follows the same 16-hex shape', () => {
    const childSpan: SpanlensSpan = {
      ...LLM_SPAN,
      id: 'cccccccc-dddd-eeee-ffff-000000000000',
      parent_span_id: LLM_SPAN.id,
    }
    const out = traceToOtlp(TRACE, [LLM_SPAN, childSpan])
    const ch = out.resourceSpans[0]!.scopeSpans[0]!.spans[1]!
    expect(ch.parentSpanId).toBe('a1b2c3d4e5f67890')
  })

  test('root span (no parent) omits parentSpanId entirely', () => {
    const out = traceToOtlp(TRACE, [LLM_SPAN])
    const span = out.resourceSpans[0]!.scopeSpans[0]!.spans[0]!
    expect('parentSpanId' in span).toBe(false)
  })
})

describe('traceToOtlp — timestamps', () => {
  test('startTimeUnixNano / endTimeUnixNano are stringified nanoseconds since epoch', () => {
    const out = traceToOtlp(TRACE, [LLM_SPAN])
    const span = out.resourceSpans[0]!.scopeSpans[0]!.spans[0]!
    // 2026-06-12T10:00:00.500Z = 1781258400500 ms = 1781258400500000000 ns.
    // (verified via Date.parse('2026-06-12T10:00:00.500Z') in Node)
    expect(span.startTimeUnixNano).toBe('1781258400500000000')
    expect(span.endTimeUnixNano).toBe('1781258401200000000')
  })

  test('null timestamp falls back to "0" instead of throwing', () => {
    const broken: SpanlensSpan = { ...LLM_SPAN, started_at: null, ended_at: null }
    const out = traceToOtlp(TRACE, [broken])
    const span = out.resourceSpans[0]!.scopeSpans[0]!.spans[0]!
    expect(span.startTimeUnixNano).toBe('0')
    expect(span.endTimeUnixNano).toBe('0')
  })
})

describe('traceToOtlp — gen_ai semantic conventions', () => {
  test('LLM span carries gen_ai.system + gen_ai.request.model from metadata', () => {
    const out = traceToOtlp(TRACE, [LLM_SPAN])
    const attrs = out.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.attributes
    expect(attrs).toContainEqual({ key: 'gen_ai.system', value: { stringValue: 'openai' } })
    expect(attrs).toContainEqual({ key: 'gen_ai.request.model', value: { stringValue: 'gpt-4o' } })
  })

  test('token counts emitted as gen_ai.usage.input_tokens / output_tokens / total_tokens', () => {
    const out = traceToOtlp(TRACE, [LLM_SPAN])
    const attrs = out.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.attributes
    expect(attrs).toContainEqual({ key: 'gen_ai.usage.input_tokens', value: { intValue: '150' } })
    expect(attrs).toContainEqual({ key: 'gen_ai.usage.output_tokens', value: { intValue: '80' } })
    expect(attrs).toContainEqual({ key: 'gen_ai.usage.total_tokens', value: { intValue: '230' } })
  })

  test('cost emitted as spanlens.cost_usd doubleValue (private, no semconv yet)', () => {
    const out = traceToOtlp(TRACE, [LLM_SPAN])
    const attrs = out.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.attributes
    expect(attrs).toContainEqual({ key: 'spanlens.cost_usd', value: { doubleValue: 0.001175 } })
  })

  test('null token / cost / provider values are omitted, not emitted as empty', () => {
    const sparseSpan: SpanlensSpan = {
      ...LLM_SPAN,
      prompt_tokens: null,
      completion_tokens: null,
      total_tokens: null,
      cost_usd: null,
      metadata: {}, // no provider, no model
    }
    const out = traceToOtlp(TRACE, [sparseSpan])
    const attrs = out.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.attributes
    expect(attrs.find((a) => a.key === 'gen_ai.system')).toBeUndefined()
    expect(attrs.find((a) => a.key === 'gen_ai.request.model')).toBeUndefined()
    expect(attrs.find((a) => a.key === 'gen_ai.usage.input_tokens')).toBeUndefined()
    expect(attrs.find((a) => a.key === 'spanlens.cost_usd')).toBeUndefined()
  })
})

describe('traceToOtlp — span kind + status', () => {
  test('llm span_type → SPAN_KIND_CLIENT (3)', () => {
    const out = traceToOtlp(TRACE, [LLM_SPAN])
    expect(out.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.kind).toBe(3)
  })

  test('tool span_type → SPAN_KIND_CLIENT (3)', () => {
    const tool: SpanlensSpan = { ...LLM_SPAN, span_type: 'tool', name: 'web.search' }
    const out = traceToOtlp(TRACE, [tool])
    expect(out.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.kind).toBe(3)
  })

  test('non-llm / non-tool span → SPAN_KIND_INTERNAL (1)', () => {
    const internal: SpanlensSpan = { ...LLM_SPAN, span_type: 'custom', name: 'parse_input' }
    const out = traceToOtlp(TRACE, [internal])
    expect(out.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.kind).toBe(1)
  })

  test('status="completed" → STATUS_CODE_OK (1)', () => {
    const out = traceToOtlp(TRACE, [LLM_SPAN])
    expect(out.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.status.code).toBe(1)
  })

  test('status="error" + error_message → STATUS_CODE_ERROR (2) + message attached', () => {
    const errSpan: SpanlensSpan = {
      ...LLM_SPAN,
      status: 'error',
      error_message: 'rate_limit_exceeded',
    }
    const out = traceToOtlp(TRACE, [errSpan])
    const status = out.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.status
    expect(status.code).toBe(2)
    expect(status.message).toBe('rate_limit_exceeded')
  })

  test('null status → STATUS_CODE_UNSET (0)', () => {
    const unset: SpanlensSpan = { ...LLM_SPAN, status: null }
    const out = traceToOtlp(TRACE, [unset])
    expect(out.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.status.code).toBe(0)
  })
})

describe('traceToOtlp — edge cases', () => {
  test('empty span list still produces a valid envelope (no spans field empty)', () => {
    const out = traceToOtlp(TRACE, [])
    expect(out.resourceSpans[0]!.scopeSpans[0]!.spans).toEqual([])
  })

  test('multiple spans are preserved in input order', () => {
    const a: SpanlensSpan = { ...LLM_SPAN, id: '11111111-1111-1111-1111-111111111111', name: 'a' }
    const b: SpanlensSpan = { ...LLM_SPAN, id: '22222222-2222-2222-2222-222222222222', name: 'b' }
    const c: SpanlensSpan = { ...LLM_SPAN, id: '33333333-3333-3333-3333-333333333333', name: 'c' }
    const out = traceToOtlp(TRACE, [a, b, c])
    const names = out.resourceSpans[0]!.scopeSpans[0]!.spans.map((s) => s.name)
    expect(names).toEqual(['a', 'b', 'c'])
  })
})
