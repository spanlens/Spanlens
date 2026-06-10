import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * R-12 Phase 3.2 — signature/contract compatibility matrix between the
 * legacy `requests` query layer and the `events` query layer. The Phase 3.3
 * cutover flips orgs between the two at runtime, so any drift between them
 * surfaces as a per-org behaviour difference that unit tests on either
 * module alone would miss.
 *
 * | requests-query.ts                  | events-query.ts                    | contract                                              |
 * |------------------------------------|------------------------------------|--------------------------------------------------------|
 * | requestsScope(orgId, opts)         | eventsScope(orgId, opts)           | identical whereScope + scopeParams + plan              |
 * | selectRequests({scope, select,...})| selectGenerationsAsRequests({...}) | shim's fixed SELECT covers every /requests list column |
 * | countRequests({scope, filters})    | countGenerations({scope, filters}) | same count contract; events side adds event_type gate  |
 * | streamRequests (CSV/JSONL exports) | (none)                             | KNOWN GAP — exports read `requests` until Phase 4      |
 * | (table: requests)                  | (view: events_as_requests)         | stats pipeline parity enforced by the view, see        |
 * |                                    |                                    | clickhouse/migrations/005_create_events_as_requests_view.sql |
 *
 * The `streamRequests` gap is deliberate: `/api/v1/exports` stays on the
 * legacy table until `events` becomes the only store (R-12 Phase 4,
 * Sprint 15). Revisit this matrix when that lands.
 */

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(async (_opts: { query: string }) => ({
    json: async () => [] as unknown[],
    stream: () => [],
    close: () => undefined,
  })),
}))

vi.mock('./clickhouse.js', () => ({
  unscopedClickhouse: () => ({ query: mockQuery }),
}))

// getOrgPlan (shared by both scope helpers) hits Supabase — pin it to 'free'.
vi.mock('./db.js', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { plan: 'free' }, error: null }),
        }),
      }),
    }),
  },
}))

import { requestsScope, selectRequests, countRequests, resetOrgPlanCache } from './requests-query.js'
import {
  eventsScope,
  selectGenerationsAsRequests,
  countGenerations,
} from './events-query.js'

const ORG = '00000000-0000-4000-8000-000000000001'

/**
 * The /api/v1/requests list contract (LIST_COLUMNS in api/requests.ts +
 * the RequestRow interface). Every name here must come back from the
 * events shim or the dashboard sees `undefined` fields when an org flips.
 */
const REQUESTS_LIST_COLUMNS = [
  'id',
  'project_id',
  'provider',
  'model',
  'prompt_tokens',
  'completion_tokens',
  'total_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
  'cost_usd',
  'latency_ms',
  'status_code',
  'error_message',
  'trace_id',
  'span_id',
  'provider_key_id',
  'user_id',
  'session_id',
  'truncated',
  'created_at',
] as const

/** Pulls the output column names out of a captured `SELECT ... FROM` SQL string. */
function selectedColumns(sql: string): Set<string> {
  const selectBody = sql.slice(sql.indexOf('SELECT') + 'SELECT'.length, sql.indexOf('FROM'))
  const cols = new Set<string>()
  for (const rawLine of selectBody.split('\n')) {
    const line = rawLine.trim().replace(/,$/, '')
    if (!line || line.startsWith('--')) continue
    const aliasMatch = /\bAS\s+(\w+)\s*$/i.exec(line)
    if (aliasMatch?.[1]) {
      cols.add(aliasMatch[1])
    } else if (/^\w+$/.test(line)) {
      cols.add(line) // bare column reference
    }
  }
  return cols
}

describe('requests-query ↔ events-query compatibility', () => {
  beforeEach(() => {
    mockQuery.mockClear()
    resetOrgPlanCache()
  })

  it('scope helpers produce identical whereScope, scopeParams, and plan', async () => {
    const r = await requestsScope(ORG)
    const e = await eventsScope(ORG)
    expect(e.whereScope).toBe(r.whereScope)
    expect(e.scopeParams).toEqual(r.scopeParams)
    expect(e.plan).toBe(r.plan)
  })

  it('scope helpers agree on the ignoreRetention escape hatch', async () => {
    const r = await requestsScope(ORG, { ignoreRetention: true })
    const e = await eventsScope(ORG, { ignoreRetention: true })
    expect(e.whereScope).toBe(r.whereScope)
    expect(e.whereScope).not.toContain('retentionDays')
  })

  it('events shim returns every /requests list column the dashboard contract needs', async () => {
    const scope = await eventsScope(ORG)
    await selectGenerationsAsRequests({ scope, limit: 1 })

    expect(mockQuery).toHaveBeenCalledTimes(1)
    const sql = mockQuery.mock.calls[0]![0]!.query
    const cols = selectedColumns(sql)
    for (const required of REQUESTS_LIST_COLUMNS) {
      expect(cols.has(required), `events shim is missing column "${required}"`).toBe(true)
    }
  })

  it('events shim and count gate on event_type=generation; requests side reads the raw table', async () => {
    const eScope = await eventsScope(ORG)
    await selectGenerationsAsRequests({ scope: eScope })
    await countGenerations({ scope: eScope })

    const rScope = await requestsScope(ORG)
    await selectRequests({ scope: rScope, select: 'id' })
    await countRequests({ scope: rScope })

    const [shimSql, countEventsSql, selectReqSql, countReqSql] = mockQuery.mock.calls.map(
      (call) => call[0]!.query,
    )
    expect(shimSql).toContain("event_type = 'generation'")
    expect(countEventsSql).toContain("event_type = 'generation'")
    expect(shimSql).toContain('FROM events')
    expect(selectReqSql).toContain('FROM requests')
    expect(selectReqSql).not.toContain('event_type')
    expect(countReqSql).toContain('FROM requests')
  })

  it('both query layers accept the same filter/order/paging surface', async () => {
    const opts = {
      filters: 'provider = {provider:String}',
      params: { provider: 'openai' },
      orderBy: 'created_at DESC',
      limit: 50,
      offset: 100,
    }
    const eScope = await eventsScope(ORG)
    await selectGenerationsAsRequests({ scope: eScope, ...opts })
    const rScope = await requestsScope(ORG)
    await selectRequests({ scope: rScope, select: 'id', ...opts })

    for (const call of mockQuery.mock.calls) {
      const { query, query_params } = call[0] as unknown as {
        query: string
        query_params: Record<string, unknown>
      }
      expect(query).toContain('provider = {provider:String}')
      expect(query).toContain('ORDER BY created_at DESC')
      expect(query).toContain('LIMIT 50')
      expect(query).toContain('OFFSET 100')
      expect(query_params['provider']).toBe('openai')
      expect(query_params['orgId']).toBe(ORG)
    }
  })
})
