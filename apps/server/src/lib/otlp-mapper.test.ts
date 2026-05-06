/**
 * Unit tests for the OTLP → Spanlens span mapper.
 */

import { describe, it, expect } from 'vitest'
import {
  unpackAnyValue,
  unpackAttributes,
  mapOtlpSpan,
  groupByTrace,
  inferTraceName,
  minStartTime,
  maxEndTime,
} from './otlp-mapper.js'
import type { OtlpSpan, OtlpExportRequest, OtlpAnyValue } from './otlp-mapper.js'

// ── unpackAnyValue ─────────────────────────────────────────────────────────────

describe('unpackAnyValue', () => {
  it('returns null for undefined', () => {
    expect(unpackAnyValue(undefined)).toBeNull()
  })

  it('returns null for empty object', () => {
    expect(unpackAnyValue({} as OtlpAnyValue)).toBeNull()
  })

  it('unpacks stringValue', () => {
    expect(unpackAnyValue({ stringValue: 'hello' })).toBe('hello')
  })

  it('unpacks intValue string as number', () => {
    expect(unpackAnyValue({ intValue: '42' })).toBe(42)
  })

  it('unpacks intValue number', () => {
    expect(unpackAnyValue({ intValue: 100 })).toBe(100)
  })

  it('unpacks doubleValue', () => {
    expect(unpackAnyValue({ doubleValue: 3.14 })).toBeCloseTo(3.14)
  })

  it('unpacks boolValue true', () => {
    expect(unpackAnyValue({ boolValue: true })).toBe(true)
  })

  it('unpacks boolValue false', () => {
    expect(unpackAnyValue({ boolValue: false })).toBe(false)
  })

  it('unpacks arrayValue', () => {
    const result = unpackAnyValue({
      arrayValue: {
        values: [{ stringValue: 'a' }, { stringValue: 'b' }],
      },
    })
    expect(result).toEqual(['a', 'b'])
  })

  it('unpacks empty arrayValue', () => {
    expect(unpackAnyValue({ arrayValue: {} })).toEqual([])
  })

  it('unpacks kvlistValue', () => {
    const result = unpackAnyValue({
      kvlistValue: {
        values: [
          { key: 'x', value: { intValue: 1 } },
          { key: 'y', value: { stringValue: 'z' } },
        ],
      },
    })
    expect(result).toEqual({ x: 1, y: 'z' })
  })

  it('unpacks nested arrayValue with int64 strings', () => {
    const result = unpackAnyValue({
      arrayValue: {
        values: [{ intValue: '1000' }, { intValue: '2000' }],
      },
    })
    expect(result).toEqual([1000, 2000])
  })
})

// ── unpackAttributes ───────────────────────────────────────────────────────────

describe('unpackAttributes', () => {
  it('returns empty object for undefined', () => {
    expect(unpackAttributes(undefined)).toEqual({})
  })

  it('converts key-value list to record', () => {
    const result = unpackAttributes([
      { key: 'gen_ai.operation.name', value: { stringValue: 'chat' } },
      { key: 'gen_ai.usage.input_tokens', value: { intValue: '100' } },
    ])
    expect(result['gen_ai.operation.name']).toBe('chat')
    expect(result['gen_ai.usage.input_tokens']).toBe(100)
  })
})

// ── mapOtlpSpan ────────────────────────────────────────────────────────────────

const TRACE_UUID = '550e8400-e29b-41d4-a716-446655440000'
const ORG_ID = 'org-abc123'

function makeSpan(overrides: Partial<OtlpSpan> = {}): OtlpSpan {
  return {
    traceId: 'abcdef1234567890abcdef1234567890',
    spanId: '1234567890abcdef',
    name: 'test.span',
    startTimeUnixNano: '1700000000000000000',   // 1.7e18 ns
    endTimeUnixNano:   '1700000001000000000',   // +1 s = 1000 ms
    status: { code: 0 },
    attributes: [],
    ...overrides,
  }
}

describe('mapOtlpSpan', () => {
  it('maps a basic LLM chat span correctly', () => {
    const span = makeSpan({
      attributes: [
        { key: 'gen_ai.operation.name',      value: { stringValue: 'chat' } },
        { key: 'gen_ai.provider.name',       value: { stringValue: 'openai' } },
        { key: 'gen_ai.request.model',       value: { stringValue: 'gpt-4o' } },
        { key: 'gen_ai.usage.input_tokens',  value: { intValue: '100' } },
        { key: 'gen_ai.usage.output_tokens', value: { intValue: '50' } },
      ],
    })
    const row = mapOtlpSpan(span, TRACE_UUID, ORG_ID)

    expect(row.span_type).toBe('llm')
    expect(row.prompt_tokens).toBe(100)
    expect(row.completion_tokens).toBe(50)
    expect(row.total_tokens).toBe(150)
    expect(row.duration_ms).toBe(1000)
    expect(row.status).toBe('completed')
    expect(row.name).toBe('test.span')
    expect(row.external_span_id).toBe('1234567890abcdef')
    expect(row.organization_id).toBe(ORG_ID)
    expect(row.trace_id).toBe(TRACE_UUID)
  })

  it('infers span_type=tool for execute_tool operation', () => {
    const span = makeSpan({
      attributes: [{ key: 'gen_ai.operation.name', value: { stringValue: 'execute_tool' } }],
    })
    expect(mapOtlpSpan(span, TRACE_UUID, ORG_ID).span_type).toBe('tool')
  })

  it('infers span_type=embedding for embeddings operation', () => {
    const span = makeSpan({
      attributes: [{ key: 'gen_ai.operation.name', value: { stringValue: 'embeddings' } }],
    })
    expect(mapOtlpSpan(span, TRACE_UUID, ORG_ID).span_type).toBe('embedding')
  })

  it('infers span_type=retrieval for retrieval operation', () => {
    const span = makeSpan({
      attributes: [{ key: 'gen_ai.operation.name', value: { stringValue: 'retrieval' } }],
    })
    expect(mapOtlpSpan(span, TRACE_UUID, ORG_ID).span_type).toBe('retrieval')
  })

  it('infers span_type=custom for unknown operation', () => {
    const span = makeSpan({
      attributes: [{ key: 'gen_ai.operation.name', value: { stringValue: 'unknown_op' } }],
    })
    expect(mapOtlpSpan(span, TRACE_UUID, ORG_ID).span_type).toBe('custom')
  })

  it('marks status=error for OTel status code 2', () => {
    const span = makeSpan({ status: { code: 2, message: 'LLM call failed' } })
    const row = mapOtlpSpan(span, TRACE_UUID, ORG_ID)
    expect(row.status).toBe('error')
    expect(row.error_message).toBe('LLM call failed')
  })

  it('marks status=completed for OTel status code 0 (UNSET)', () => {
    const span = makeSpan({ status: { code: 0 } })
    expect(mapOtlpSpan(span, TRACE_UUID, ORG_ID).status).toBe('completed')
  })

  it('marks status=completed for OTel status code 1 (OK)', () => {
    const span = makeSpan({ status: { code: 1 } })
    expect(mapOtlpSpan(span, TRACE_UUID, ORG_ID).status).toBe('completed')
  })

  it('error_message is null when status is not error', () => {
    const span = makeSpan({ status: { code: 0 } })
    expect(mapOtlpSpan(span, TRACE_UUID, ORG_ID).error_message).toBeNull()
  })

  it('handles snake_case proto JSON field names', () => {
    const span: OtlpSpan = {
      trace_id: 'abcdef1234567890abcdef1234567890',
      span_id:  '1234567890abcdef',
      parent_span_id: 'aabbccdd11223344',
      name: 'snake.span',
      start_time_unix_nano: '1700000000000000000',
      end_time_unix_nano:   '1700000000500000000',  // +500 ms
      attributes: [],
    }
    const row = mapOtlpSpan(span, TRACE_UUID, ORG_ID)
    expect(row.external_span_id).toBe('1234567890abcdef')
    expect(row.external_parent_span_id).toBe('aabbccdd11223344')
    expect(row.duration_ms).toBe(500)
  })

  it('sets external_parent_span_id to null when parentSpanId is empty string', () => {
    const span = makeSpan({ parentSpanId: '' })
    expect(mapOtlpSpan(span, TRACE_UUID, ORG_ID).external_parent_span_id).toBeNull()
  })

  it('sets external_parent_span_id to null when no parent fields present', () => {
    // Build a span manually without any parent fields
    const span: OtlpSpan = {
      traceId: 'abcdef1234567890abcdef1234567890',
      spanId: '1234567890abcdef',
      name: 'no-parent.span',
      startTimeUnixNano: '1700000000000000000',
      endTimeUnixNano:   '1700000001000000000',
      status: { code: 0 },
      attributes: [],
    }
    expect(mapOtlpSpan(span, TRACE_UUID, ORG_ID).external_parent_span_id).toBeNull()
  })

  it('stores input from gen_ai.input.messages', () => {
    const inputMsg = '[{"role":"user","content":"hi"}]'
    const span = makeSpan({
      attributes: [{ key: 'gen_ai.input.messages', value: { stringValue: inputMsg } }],
    })
    expect(mapOtlpSpan(span, TRACE_UUID, ORG_ID).input).toBe(inputMsg)
  })

  it('stores output from gen_ai.output.messages', () => {
    const outputMsg = '[{"role":"assistant","content":"hello"}]'
    const span = makeSpan({
      attributes: [{ key: 'gen_ai.output.messages', value: { stringValue: outputMsg } }],
    })
    expect(mapOtlpSpan(span, TRACE_UUID, ORG_ID).output).toBe(outputMsg)
  })

  it('stores tool call arguments as input', () => {
    const args = '{"query":"openai pricing"}'
    const span = makeSpan({
      attributes: [{ key: 'gen_ai.tool.call.arguments', value: { stringValue: args } }],
    })
    expect(mapOtlpSpan(span, TRACE_UUID, ORG_ID).input).toBe(args)
  })

  it('builds metadata from known gen_ai attrs', () => {
    const span = makeSpan({
      attributes: [
        { key: 'gen_ai.operation.name',    value: { stringValue: 'chat' } },
        { key: 'gen_ai.provider.name',     value: { stringValue: 'openai' } },
        { key: 'gen_ai.request.model',     value: { stringValue: 'gpt-4o' } },
        { key: 'gen_ai.request.temperature', value: { doubleValue: 0.7 } },
      ],
    })
    const row = mapOtlpSpan(span, TRACE_UUID, ORG_ID)
    expect(row.metadata).not.toBeNull()
    expect(row.metadata!['model']).toBe('gpt-4o')
    expect(row.metadata!['provider']).toBe('openai')
    expect(row.metadata!['temperature']).toBeCloseTo(0.7)
  })

  it('returns null metadata when no known gen_ai attrs present', () => {
    const span = makeSpan({ attributes: [] })
    expect(mapOtlpSpan(span, TRACE_UUID, ORG_ID).metadata).toBeNull()
  })

  it('computes duration_ms = null when timestamps missing', () => {
    // Build span manually without any time fields
    const span: OtlpSpan = {
      traceId: 'abcdef1234567890abcdef1234567890',
      spanId: '1234567890abcdef',
      name: 'notimestamp.span',
      attributes: [],
    }
    expect(mapOtlpSpan(span, TRACE_UUID, ORG_ID).duration_ms).toBeNull()
  })

  it('falls back to unknown for missing span name', () => {
    // Build span manually without name field
    const span: OtlpSpan = {
      traceId: 'abcdef1234567890abcdef1234567890',
      spanId: '1234567890abcdef',
      startTimeUnixNano: '1700000000000000000',
      attributes: [],
    }
    expect(mapOtlpSpan(span, TRACE_UUID, ORG_ID).name).toBe('unknown')
  })

  it('total_tokens defaults to 0 when no token attrs', () => {
    const row = mapOtlpSpan(makeSpan(), TRACE_UUID, ORG_ID)
    expect(row.prompt_tokens).toBe(0)
    expect(row.completion_tokens).toBe(0)
    expect(row.total_tokens).toBe(0)
  })
})

// ── groupByTrace ───────────────────────────────────────────────────────────────

describe('groupByTrace', () => {
  it('groups spans by traceId across scopeSpans', () => {
    const body: OtlpExportRequest = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                { traceId: 'trace1', spanId: 'span1', name: 'a' },
                { traceId: 'trace1', spanId: 'span2', name: 'b' },
                { traceId: 'trace2', spanId: 'span3', name: 'c' },
              ],
            },
          ],
        },
      ],
    }
    const groups = groupByTrace(body)
    expect(groups.size).toBe(2)
    expect(groups.get('trace1')).toHaveLength(2)
    expect(groups.get('trace2')).toHaveLength(1)
  })

  it('handles snake_case resource_spans / scope_spans', () => {
    const body: OtlpExportRequest = {
      resource_spans: [
        {
          scope_spans: [
            { spans: [{ trace_id: 'traceX', span_id: 'spanX', name: 'x' }] },
          ],
        },
      ],
    }
    const groups = groupByTrace(body)
    expect(groups.size).toBe(1)
    expect(groups.has('traceX')).toBe(true)
  })

  it('merges spans from multiple resourceSpans into same group', () => {
    const body: OtlpExportRequest = {
      resourceSpans: [
        { scopeSpans: [{ spans: [{ traceId: 'T', spanId: 's1', name: '1' }] }] },
        { scopeSpans: [{ spans: [{ traceId: 'T', spanId: 's2', name: '2' }] }] },
      ],
    }
    expect(groupByTrace(body).get('T')).toHaveLength(2)
  })

  it('skips spans without traceId', () => {
    const body: OtlpExportRequest = {
      resourceSpans: [
        {
          scopeSpans: [
            { spans: [{ spanId: 'orphan', name: 'no-trace' }] },
          ],
        },
      ],
    }
    expect(groupByTrace(body).size).toBe(0)
  })

  it('returns empty map for empty body', () => {
    expect(groupByTrace({}).size).toBe(0)
    expect(groupByTrace({ resourceSpans: [] }).size).toBe(0)
  })
})

// ── inferTraceName ─────────────────────────────────────────────────────────────

describe('inferTraceName', () => {
  it('picks the root span (no parentSpanId)', () => {
    const spans: OtlpSpan[] = [
      { spanId: 'root', name: 'root.operation' },
      { spanId: 'child', parentSpanId: 'root', name: 'child.operation' },
    ]
    expect(inferTraceName(spans)).toBe('root.operation')
  })

  it('picks root when parent references an unknown span', () => {
    const spans: OtlpSpan[] = [
      { spanId: 'child', parentSpanId: 'ghost-parent', name: 'child.operation' },
    ]
    // parentSpanId is set but 'ghost-parent' is not in the list → treated as root
    expect(inferTraceName(spans)).toBe('child.operation')
  })

  it('falls back to otel-trace when all spans have known parents', () => {
    const spans: OtlpSpan[] = [
      { spanId: 'a', parentSpanId: 'b', name: 'op-a' },
      { spanId: 'b', parentSpanId: 'a', name: 'op-b' },
    ]
    expect(inferTraceName(spans)).toBe('otel-trace')
  })

  it('returns otel-trace for empty span list', () => {
    expect(inferTraceName([])).toBe('otel-trace')
  })
})

// ── minStartTime / maxEndTime ──────────────────────────────────────────────────

describe('minStartTime', () => {
  it('returns the earliest start time', () => {
    const spans: OtlpSpan[] = [
      { startTimeUnixNano: '1000000000' },   // 1 000 ms after epoch
      { startTimeUnixNano:  '500000000' },   //   500 ms after epoch
      { startTimeUnixNano: '2000000000' },   // 2 000 ms after epoch
    ]
    const result = minStartTime(spans)
    expect(new Date(result).getTime()).toBe(500)
  })

  it('handles snake_case start_time_unix_nano', () => {
    const spans: OtlpSpan[] = [{ start_time_unix_nano: '750000000' }]
    expect(new Date(minStartTime(spans)).getTime()).toBe(750)
  })

  it('returns current time when all nanos are 0 or missing', () => {
    const before = Date.now()
    const result = minStartTime([{ startTimeUnixNano: '0' }, {}])
    const after = Date.now()
    const ts = new Date(result).getTime()
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })
})

describe('maxEndTime', () => {
  it('returns the latest end time', () => {
    const spans: OtlpSpan[] = [
      { endTimeUnixNano: '3000000000' },   // 3 000 ms
      { endTimeUnixNano: '1000000000' },   // 1 000 ms
    ]
    expect(new Date(maxEndTime(spans)!).getTime()).toBe(3000)
  })

  it('handles snake_case end_time_unix_nano', () => {
    const spans: OtlpSpan[] = [{ end_time_unix_nano: '2500000000' }]
    expect(new Date(maxEndTime(spans)!).getTime()).toBe(2500)
  })

  it('returns null when all end nanos are 0 or missing', () => {
    expect(maxEndTime([{ endTimeUnixNano: '0' }, {}])).toBeNull()
  })

  it('returns null for empty list', () => {
    expect(maxEndTime([])).toBeNull()
  })
})
