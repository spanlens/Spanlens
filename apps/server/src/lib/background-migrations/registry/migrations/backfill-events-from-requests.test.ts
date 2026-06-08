import { afterEach, describe, expect, it, vi } from 'vitest'

// Stub ClickHouse before importing the migration. Each test installs
// its own query/insert mocks via vi.mocked() handles.
const queryMock = vi.fn()
const insertMock = vi.fn().mockResolvedValue(undefined)

vi.mock('../../../clickhouse.js', () => ({
  unscopedClickhouse: () => ({ query: queryMock, insert: insertMock }),
  toClickhouseTimestamp: (d: Date = new Date()) =>
    d.toISOString().replace('T', ' ').replace('Z', ''),
}))

import { backfillEventsFromRequests, mapRequestToEventRow } from './backfill-events-from-requests.js'
import type { ChunkState } from '../../index.js'

afterEach(() => {
  queryMock.mockReset()
  insertMock.mockClear()
})

function makeRequestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    organization_id: 'org-1',
    project_id: 'prj-1',
    api_key_id: 'key-1',
    provider: 'openai',
    model: 'gpt-4o-mini',
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 150,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost_usd: '0.0010',
    latency_ms: 1200,
    status_code: 200,
    request_body: '{"messages":[]}',
    response_body: '{"choices":[]}',
    error_message: null,
    trace_id: '00000000-0000-0000-0000-000000000000',
    span_id: '00000000-0000-0000-0000-000000000000',
    prompt_version_id: '00000000-0000-0000-0000-000000000000',
    provider_key_id: '00000000-0000-0000-0000-000000000000',
    user_id: null,
    session_id: null,
    service_tier: '',
    created_at: '2026-01-01 00:00:00.000',
    ...overrides,
  }
}

function jsonRes<T>(rows: T[]) {
  return { json: async () => rows as unknown }
}

describe('mapRequestToEventRow', () => {
  it('maps the historical token columns into usage_details', () => {
    const row = mapRequestToEventRow(makeRequestRow({ trace_id: 'trc-x' }) as never)
    expect(row['usage_details']).toEqual({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    })
  })

  it('tags backfilled rows in metadata so they are distinguishable from live writes', () => {
    const row = mapRequestToEventRow(makeRequestRow() as never)
    expect(row['metadata']).toMatchObject({ source: 'backfill_requests' })
  })

  it('treats a missing trace_id as the event itself so the events table never has null trace_id', () => {
    const row = mapRequestToEventRow(makeRequestRow({ trace_id: null }) as never)
    expect(row['trace_id']).toBe('req-1') // event_id fallback
  })

  it('sets cost_details only when cost is present and finite', () => {
    const withCost = mapRequestToEventRow(makeRequestRow() as never)
    expect(withCost['cost_details']).toEqual({ total_cost_usd: 0.001 })
    expect(withCost['total_cost_usd']).toBe(0.001)

    const noCost = mapRequestToEventRow(makeRequestRow({ cost_usd: null }) as never)
    expect(noCost['cost_details']).toEqual({})
    expect(noCost['total_cost_usd']).toBeNull()
  })
})

describe('backfillEventsFromRequests.runChunk', () => {
  it('counts the total on first run and stores it in state', async () => {
    // First call: SELECT count() returns 42.
    queryMock.mockResolvedValueOnce(jsonRes([{ c: '42' }]))
    // Second call: SELECT … FROM requests returns 1 row.
    queryMock.mockResolvedValueOnce(jsonRes([makeRequestRow({ id: 'req-1' })]))

    const result = await backfillEventsFromRequests.runChunk({})
    expect(result.done).toBe(false)
    if (result.done) return
    expect((result.state as { total_estimate?: number }).total_estimate).toBe(42)
    expect((result.state as { rows_processed?: number }).rows_processed).toBe(1)
    expect(result.progressTotal).toBe(42)
    expect(result.progressCurrent).toBe(1)
  })

  it('skips the count() on subsequent runs by reading total_estimate from state', async () => {
    queryMock.mockResolvedValueOnce(jsonRes([makeRequestRow({ id: 'req-2' })]))

    const state: ChunkState = {
      last_created_at: '2026-01-01 00:00:00.000',
      last_id: 'req-1',
      rows_processed: 100,
      total_estimate: 42,
    }
    await backfillEventsFromRequests.runChunk(state)

    // Only the SELECT … FROM requests, no count().
    expect(queryMock).toHaveBeenCalledTimes(1)
  })

  it('returns done when SELECT yields zero rows', async () => {
    // total_estimate already in state so we go straight to the SELECT.
    queryMock.mockResolvedValueOnce(jsonRes([]))
    const result = await backfillEventsFromRequests.runChunk({
      last_created_at: '2026-01-01 00:00:00.000',
      last_id: 'req-1',
      rows_processed: 100,
      total_estimate: 42,
    } as ChunkState)
    expect(result.done).toBe(true)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('advances the cursor to the last row of the chunk', async () => {
    queryMock.mockResolvedValueOnce(
      jsonRes([
        makeRequestRow({ id: 'req-1', created_at: '2026-01-01 00:00:00.000' }),
        makeRequestRow({ id: 'req-2', created_at: '2026-01-01 00:00:01.000' }),
        makeRequestRow({ id: 'req-3', created_at: '2026-01-01 00:00:02.000' }),
      ]),
    )

    const result = await backfillEventsFromRequests.runChunk({
      last_created_at: '1970-01-01 00:00:00.000',
      last_id: '00000000-0000-0000-0000-000000000000',
      rows_processed: 0,
      total_estimate: 100,
    } as ChunkState)

    if (result.done) throw new Error('expected continuation')
    expect((result.state as { last_id?: string }).last_id).toBe('req-3')
    expect((result.state as { last_created_at?: string }).last_created_at).toBe(
      '2026-01-01 00:00:02.000',
    )
    expect((result.state as { rows_processed?: number }).rows_processed).toBe(3)
  })

  it('writes the mapped rows into the events table', async () => {
    queryMock.mockResolvedValueOnce(
      jsonRes([
        makeRequestRow({ id: 'req-1', trace_id: 'trc-1', span_id: 'spn-1' }),
      ]),
    )
    await backfillEventsFromRequests.runChunk({
      last_created_at: '1970-01-01 00:00:00.000',
      last_id: '00000000-0000-0000-0000-000000000000',
      rows_processed: 0,
      total_estimate: 1,
    } as ChunkState)

    expect(insertMock).toHaveBeenCalledTimes(1)
    const call = insertMock.mock.calls[0]?.[0]
    expect(call.table).toBe('events')
    const row = call.values[0]
    expect(row.event_id).toBe('req-1')
    expect(row.event_type).toBe('generation')
    expect(row.trace_id).toBe('trc-1')
    expect(row.parent_event_id).toBe('spn-1')
  })

  it('normalises empty UUIDs in the SELECT result back to null before mapping', async () => {
    queryMock.mockResolvedValueOnce(
      jsonRes([
        makeRequestRow({
          id: 'req-1',
          trace_id: '00000000-0000-0000-0000-000000000000',
          span_id: '00000000-0000-0000-0000-000000000000',
        }),
      ]),
    )
    await backfillEventsFromRequests.runChunk({
      last_created_at: '1970-01-01 00:00:00.000',
      last_id: '00000000-0000-0000-0000-000000000000',
      rows_processed: 0,
      total_estimate: 1,
    } as ChunkState)

    const row = insertMock.mock.calls[0]?.[0].values[0]
    // trace_id falls back to event_id (because the null was normalised
    // inside the migration before mapRequestToEventRow ran).
    expect(row.trace_id).toBe('req-1')
    expect(row.parent_event_id).toBeNull()
  })

  it('returns done if the cursor would not advance — protects against an infinite loop', async () => {
    // Pathological case: ClickHouse returned the SAME row again. The
    // cursor would equal itself; the migration must short-circuit.
    queryMock.mockResolvedValueOnce(
      jsonRes([
        makeRequestRow({
          id: 'req-1',
          created_at: '2026-01-01 00:00:00.000',
        }),
      ]),
    )

    const result = await backfillEventsFromRequests.runChunk({
      last_created_at: '2026-01-01 00:00:00.000',
      last_id: 'req-1',
      rows_processed: 1,
      total_estimate: 1,
    } as ChunkState)

    expect(result.done).toBe(true)
  })
})
