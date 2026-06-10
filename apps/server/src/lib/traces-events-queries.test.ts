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
