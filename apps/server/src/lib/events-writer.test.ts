import { afterEach, describe, expect, it, vi } from 'vitest'

// Mock the ClickHouse client BEFORE importing events-writer so the
// mock is in place when the module wires its imports.
const insertMock = vi.fn().mockResolvedValue(undefined)
vi.mock('./clickhouse.js', () => ({
  unscopedClickhouse: () => ({ insert: insertMock }),
  // Strip 'T' / 'Z' the way the real toClickhouseTimestamp does so
  // assertions stay deterministic.
  toClickhouseTimestamp: (d: Date = new Date()) =>
    d.toISOString().replace('T', ' ').replace('Z', ''),
}))

// Mock the Supabase admin client too so the fallback enqueue path can
// be exercised without a network call.
const fallbackInsertMock = vi.fn().mockResolvedValue({ error: null })
vi.mock('./db.js', () => ({
  supabaseAdmin: {
    from: (_table: string) => ({
      insert: fallbackInsertMock,
    }),
  },
}))

import { writeRequestAsEvent, writeTraceAsEvent, writeSpanAsEvent } from './events-writer.js'

afterEach(() => {
  insertMock.mockClear()
  fallbackInsertMock.mockClear()
  insertMock.mockResolvedValue(undefined)
})

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

describe('writeTraceAsEvent — lifecycle update events (eventTime)', () => {
  it('defaults created_at to start_time when no eventTime is given (create event)', async () => {
    await writeTraceAsEvent({
      traceId: 'trc-2',
      organizationId: 'org-1',
      projectId: 'prj-1',
      name: 'agent_run',
      startedAt: '2026-06-06T00:00:00.000Z',
    })
    const row = insertMock.mock.calls[0]?.[0].values[0]
    expect(row.created_at).toBe(row.start_time)
  })

  it('stamps created_at with eventTime while start_time keeps startedAt (update event)', async () => {
    await writeTraceAsEvent({
      traceId: 'trc-2',
      organizationId: 'org-1',
      projectId: 'prj-1',
      name: 'agent_run',
      startedAt: '2026-06-06T00:00:00.000Z',
      endedAt: '2026-06-06T00:00:05.000Z',
      status: 'completed',
      eventTime: '2026-06-06T00:00:05.100Z',
    })
    const row = insertMock.mock.calls[0]?.[0].values[0]
    expect(row.start_time).toBe('2026-06-06 00:00:00.000')
    // created_at later than start_time → the LIMIT 1 BY id dedupe in
    // traces-events-queries picks this snapshot over the create event.
    expect(row.created_at).toBe('2026-06-06 00:00:05.100')
    expect(row.metadata['status']).toBe('completed')
  })
})

describe('writeSpanAsEvent', () => {
  it('stamps created_at with eventTime on update events (same contract as traces)', async () => {
    await writeSpanAsEvent({
      spanId: 'spn-2',
      traceId: 'trc-1',
      organizationId: 'org-1',
      projectId: 'prj-1',
      name: 'llm_call',
      startedAt: '2026-06-06T00:00:00.000Z',
      eventTime: '2026-06-06T00:00:09.000Z',
    })
    const row = insertMock.mock.calls[0]?.[0].values[0]
    expect(row.start_time).toBe('2026-06-06 00:00:00.000')
    expect(row.created_at).toBe('2026-06-06 00:00:09.000')
  })

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

describe('insertEventOrQueue — 5.3 lite fallback path', () => {
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
    id: 'evt-99',
    cost_usd: 0.001,
    created_at: '2026-06-06 00:00:00.000',
    request_body: '',
    response_body: '',
    error_message: null,
  }

  it('enqueues the row into events_fallback when ClickHouse throws', async () => {
    insertMock.mockRejectedValueOnce(new Error('CH cold start'))

    // The writer itself should still resolve — failure is contained.
    await expect(writeRequestAsEvent(baseData, requestRow)).resolves.toBeUndefined()

    expect(fallbackInsertMock).toHaveBeenCalledTimes(1)
    const enqueued = fallbackInsertMock.mock.calls[0]?.[0] as {
      payload: { event_id: string; event_type: string }
      event_type: string
      last_error: string
    }
    expect(enqueued.event_type).toBe('generation')
    expect(enqueued.payload.event_id).toBe('evt-99')
    expect(enqueued.last_error).toContain('CH cold start')
  })

  it('still resolves quietly when the Supabase enqueue itself fails (last-resort log)', async () => {
    insertMock.mockRejectedValueOnce(new Error('CH down'))
    fallbackInsertMock.mockRejectedValueOnce(new Error('supabase down too'))

    await expect(writeRequestAsEvent(baseData, requestRow)).resolves.toBeUndefined()
    // Row really is lost at this point — no further backstop. Test
    // exists so a future regression that throws here is caught.
  })

  it('queues trace shadow writes when CH throws', async () => {
    insertMock.mockRejectedValueOnce(new Error('CH unreachable'))

    await writeTraceAsEvent({
      traceId: 'trc-x',
      organizationId: 'org-1',
      projectId: 'prj-1',
      name: 'eval_run',
      startedAt: '2026-06-06T00:00:00.000Z',
    })

    expect(fallbackInsertMock).toHaveBeenCalledTimes(1)
    expect(fallbackInsertMock.mock.calls[0]?.[0].event_type).toBe('trace')
  })

  it('queues span shadow writes when CH throws', async () => {
    insertMock.mockRejectedValueOnce(new Error('CH unreachable'))

    await writeSpanAsEvent({
      spanId: 'spn-x',
      traceId: 'trc-x',
      organizationId: 'org-1',
      projectId: 'prj-1',
      name: 'llm_call',
      startedAt: '2026-06-06T00:00:00.000Z',
    })

    expect(fallbackInsertMock).toHaveBeenCalledTimes(1)
    expect(fallbackInsertMock.mock.calls[0]?.[0].event_type).toBe('span')
  })

  it('does NOT touch events_fallback on the happy path', async () => {
    // insertMock default = resolves(undefined). No CH error.
    await writeRequestAsEvent(baseData, requestRow)
    expect(fallbackInsertMock).not.toHaveBeenCalled()
  })
})
