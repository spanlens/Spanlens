import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * R-12 Phase 3.2 — dedupe contract for the traces events read path.
 *
 * `events` is append-only: a trace/span accrues one row per lifecycle
 * write (create, PATCH update, backfill re-insert), all sharing the
 * same event_id. The 2026-06-10 dogfood flip surfaced the symptom:
 * the /traces list rendered the same trace once per lifecycle row.
 * Every query against traces_view / spans_view must therefore collapse
 * to the latest snapshot per id (`ORDER BY created_at DESC LIMIT 1 BY id`)
 * BEFORE filters, joins, or aggregates run.
 */

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(async (_opts: { query: string }) => ({
    json: async () => [] as unknown[],
  })),
}))

vi.mock('./clickhouse.js', () => ({
  unscopedClickhouse: () => ({ query: mockQuery }),
  // Real implementation is a pure string transform — inline it so the
  // timestamp-conversion assertions test actual behaviour.
  fromClickhouseTimestamp: (s: string | null | undefined) =>
    s ? s.replace(' ', 'T') + 'Z' : null,
}))

import { listTracesFromEvents, getTraceWithSpansFromEvents } from './traces-events-queries.js'

const ORG = '00000000-0000-4000-8000-000000000001'
const TRACE = '00000000-0000-4000-8000-00000000000a'

const DEDUPE = /ORDER BY created_at DESC\s+LIMIT 1 BY id/g

function countDedupes(sql: string): number {
  return sql.match(DEDUPE)?.length ?? 0
}

describe('traces-events-queries dedupe', () => {
  beforeEach(() => {
    mockQuery.mockClear()
  })

  it('list query dedupes BOTH the trace rows and the span aggregate input', async () => {
    await listTracesFromEvents({ organizationId: ORG, limit: 50, offset: 0 })
    const [listSql, countSql] = mockQuery.mock.calls.map((c) => c[0]!.query)
    expect(countDedupes(listSql!)).toBe(2) // traces_view subquery + spans_view subquery
    expect(countDedupes(countSql!)).toBe(1)
  })

  it('count applies status filters AFTER the dedupe (latest snapshot wins)', async () => {
    await listTracesFromEvents({
      organizationId: ORG,
      status: 'completed',
      limit: 50,
      offset: 0,
    })
    const countSql = mockQuery.mock.calls[1]![0]!.query
    // The dedupe subquery must close before the status condition appears,
    // otherwise a stale 'running' snapshot of a completed trace would
    // still match the filter.
    const dedupeIdx = countSql.search(DEDUPE)
    const statusIdx = countSql.indexOf('t.status = {status:String}')
    expect(dedupeIdx).toBeGreaterThan(-1)
    expect(statusIdx).toBeGreaterThan(dedupeIdx)
  })

  it('detail queries dedupe the trace row, the span aggregate, and the span list', async () => {
    await getTraceWithSpansFromEvents(TRACE, ORG)
    const [traceSql, spansSql] = mockQuery.mock.calls.map((c) => c[0]!.query)
    expect(countDedupes(traceSql!)).toBe(2) // trace subquery + span aggregate subquery
    expect(countDedupes(spansSql!)).toBe(1)
    // Display order is still chronological — the dedupe must not leak
    // its created_at ordering into the rendered span tree.
    expect(spansSql!.trim().endsWith('ORDER BY started_at ASC')).toBe(true)
  })

  it('converts ClickHouse timestamps to ISO UTC at the API boundary (gotcha #18)', async () => {
    // ClickHouse DateTime64 has no T/Z — without conversion a KST browser
    // parses it as local time and renders every trace "9 hours ago".
    mockQuery.mockResolvedValueOnce({
      json: async () => [
        {
          id: TRACE,
          project_id: '00000000-0000-4000-8000-00000000000b',
          name: 'agent_run',
          status: 'completed',
          started_at: '2026-06-10 12:36:41.452',
          ended_at: '2026-06-10 12:37:01.465',
          duration_ms: '20013',
          span_count: '1',
          total_tokens: '100',
          total_cost_usd: '0.001',
          error_message: null,
          created_at: '2026-06-10 12:36:41.452',
        },
      ],
    })
    mockQuery.mockResolvedValueOnce({ json: async () => [{ c: '1' }] })

    const result = await listTracesFromEvents({ organizationId: ORG, limit: 50, offset: 0 })
    const row = result.rows[0]!
    expect(row.started_at).toBe('2026-06-10T12:36:41.452Z')
    expect(row.ended_at).toBe('2026-06-10T12:37:01.465Z')
    expect(row.created_at).toBe('2026-06-10T12:36:41.452Z')
    // null ended_at stays null, not the string 'null'
    mockQuery.mockResolvedValueOnce({
      json: async () => [
        {
          id: TRACE,
          name: 'running_trace',
          status: 'running',
          started_at: '2026-06-10 12:36:41.452',
          ended_at: null,
          created_at: '2026-06-10 12:36:41.452',
        },
      ],
    })
    mockQuery.mockResolvedValueOnce({ json: async () => [{ c: '1' }] })
    const running = await listTracesFromEvents({ organizationId: ORG, limit: 50, offset: 0 })
    expect(running.rows[0]!.ended_at).toBeNull()
  })

  it('detail path converts trace and span timestamps too', async () => {
    mockQuery.mockResolvedValueOnce({
      json: async () => [
        {
          id: TRACE,
          organization_id: ORG,
          name: 'agent_run',
          status: 'completed',
          started_at: '2026-06-10 12:36:41.452',
          ended_at: '2026-06-10 12:37:01.465',
          created_at: '2026-06-10 12:36:41.452',
          updated_at: '2026-06-10 12:37:01.465',
          duration_ms: '20013',
          span_count: '1',
          total_tokens: '100',
          total_cost_usd: '0.001',
        },
      ],
    })
    mockQuery.mockResolvedValueOnce({
      json: async () => [
        {
          id: '00000000-0000-4000-8000-00000000000c',
          name: 'llm_call',
          started_at: '2026-06-10 12:36:42.000',
          ended_at: null,
          duration_ms: null,
          prompt_tokens: '10',
          completion_tokens: '5',
          total_tokens: '15',
          cost_usd: null,
        },
      ],
    })

    const { trace, spans } = await getTraceWithSpansFromEvents(TRACE, ORG)
    expect(trace?.started_at).toBe('2026-06-10T12:36:41.452Z')
    expect(trace?.ended_at).toBe('2026-06-10T12:37:01.465Z')
    expect(trace?.updated_at).toBe('2026-06-10T12:37:01.465Z')
    expect(spans[0]!.started_at).toBe('2026-06-10T12:36:42.000Z')
    expect(spans[0]!.ended_at).toBeNull()
  })

  it('every subquery stays org-scoped (no RLS in ClickHouse)', async () => {
    await listTracesFromEvents({ organizationId: ORG, limit: 50, offset: 0 })
    await getTraceWithSpansFromEvents(TRACE, ORG)
    for (const call of mockQuery.mock.calls) {
      const { query, query_params } = call[0] as unknown as {
        query: string
        query_params: Record<string, unknown>
      }
      expect(query).toContain('organization_id = {orgId:UUID}')
      expect(query_params['orgId']).toBe(ORG)
    }
  })
})
