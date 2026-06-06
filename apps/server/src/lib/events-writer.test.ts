import { afterEach, describe, expect, it, vi } from 'vitest'

// Mock the ClickHouse client BEFORE importing events-writer so the
// mock is in place when the module wires its imports.
const insertMock = vi.fn().mockResolvedValue(undefined)
vi.mock('./clickhouse.js', () => ({
  getClickhouse: () => ({ insert: insertMock }),
  // Strip 'T' / 'Z' the way the real toClickhouseTimestamp does so
  // assertions stay deterministic.
  toClickhouseTimestamp: (d: Date = new Date()) =>
    d.toISOString().replace('T', ' ').replace('Z', ''),
}))

import { writeRequestAsEvent, writeTraceAsEvent, writeSpanAsEvent } from './events-writer.js'

afterEach(() => insertMock.mockClear())

describe('writeRequestAsEvent', () => {
  const baseData = {
    organizationId: 'org-1',
    projectId: 'prj-1',
    provider: 'openai',
    model: 'gpt-4o-mini',
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    costUsd: 0.001,
    latencyMs: 1200,
    statusCode: 200,
    requestBody: null,
    responseBody: null,
    errorMessage: null,
    traceId: null,
    spanId: null,
  } as const

  const requestRow = {
    id: 'evt-1',
    cost_usd: 0.001,
    created_at: '2026-06-06 00:00:00.000',
    request_body: '{"messages":[]}',
    response_body: '{"choices":[]}',
    error_message: null,
  }

  it('inserts an event_type=generation row into events', async () => {
    await writeRequestAsEvent(baseData, requestRow)
    expect(insertMock).toHaveBeenCalledTimes(1)
    const call = insertMock.mock.calls[0]?.[0]
    expect(call.table).toBe('events')
    expect(call.values).toHaveLength(1)
    const row = call.values[0]
    expect(row.event_id).toBe('evt-1')
    expect(row.event_type).toBe('generation')
    expect(row.provider).toBe('openai')
    expect(row.model).toBe('gpt-4o-mini')
  })

  it('synthesises trace_id when caller did not supply one', async () => {
    await writeRequestAsEvent(baseData, requestRow)
    const row = insertMock.mock.calls[0]?.[0].values[0]
    // UUID v4 shape; not equal to event_id when no traceId provided.
    expect(row.trace_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(row.trace_id).not.toBe(row.event_id)
  })

  it('preserves caller trace_id and parent span_id', async () => {
    await writeRequestAsEvent(
      { ...baseData, traceId: 'trc-7', spanId: 'spn-9' },
      requestRow,
    )
    const row = insertMock.mock.calls[0]?.[0].values[0]
    expect(row.trace_id).toBe('trc-7')
    expect(row.parent_event_id).toBe('spn-9')
  })

  it('writes the usage map with historical keys + optional cache tokens', async () => {
    await writeRequestAsEvent(
      { ...baseData, cacheReadTokens: 7, cacheWriteTokens: 3 },
      requestRow,
    )
    const row = insertMock.mock.calls[0]?.[0].values[0]
    expect(row.usage_details).toEqual({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      cache_read_tokens: 7,
      cache_write_tokens: 3,
    })
  })

  it('writes cost_details only when costUsd is present', async () => {
    await writeRequestAsEvent({ ...baseData, costUsd: null }, requestRow)
    const row = insertMock.mock.calls[0]?.[0].values[0]
    expect(row.cost_details).toEqual({})
    expect(row.total_cost_usd).toBeNull()
  })
})

describe('writeTraceAsEvent', () => {
  it('writes a trace row with event_type=trace and equal event_id/trace_id', async () => {
    await writeTraceAsEvent({
      traceId: 'trc-1',
      organizationId: 'org-1',
      projectId: 'prj-1',
      name: 'eval_run',
      startedAt: '2026-06-06T00:00:00.000Z',
      metadata: { evaluator_id: 'evl-1', source: 'production' },
    })
    expect(insertMock).toHaveBeenCalledTimes(1)
    const row = insertMock.mock.calls[0]?.[0].values[0]
    expect(row.event_id).toBe('trc-1')
    expect(row.trace_id).toBe('trc-1')
    expect(row.parent_event_id).toBeNull()
    expect(row.event_type).toBe('trace')
    expect(row.metadata['evaluator_id']).toBe('evl-1')
    expect(row.metadata['source']).toBe('production')
  })
})

describe('writeSpanAsEvent', () => {
  it('writes a span row with parent_event_id pointing at the parent', async () => {
    await writeSpanAsEvent({
      spanId: 'spn-1',
      traceId: 'trc-1',
      parentSpanId: 'spn-0',
      organizationId: 'org-1',
      projectId: 'prj-1',
      name: 'llm_judge',
      spanType: 'llm',
      startedAt: '2026-06-06T00:00:00.000Z',
      promptTokens: 200,
      completionTokens: 75,
      totalTokens: 275,
      costUsd: 0.0008,
    })
    expect(insertMock).toHaveBeenCalledTimes(1)
    const row = insertMock.mock.calls[0]?.[0].values[0]
    expect(row.event_id).toBe('spn-1')
    expect(row.trace_id).toBe('trc-1')
    expect(row.parent_event_id).toBe('spn-0')
    expect(row.event_type).toBe('span')
    expect(row.metadata['span_type']).toBe('llm')
    expect(row.usage_details).toEqual({
      prompt_tokens: 200,
      completion_tokens: 75,
      total_tokens: 275,
    })
    expect(row.cost_details).toEqual({ total_cost_usd: 0.0008 })
    expect(row.total_tokens).toBe(275)
  })
})
